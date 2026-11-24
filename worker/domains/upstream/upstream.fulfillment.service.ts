import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { type QueuedMailResult, sendQueuedOrderEmails } from '../../infra/mail.outbox';
import { dispatchOpsNotification } from '../../infra/notify';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { settleRecursiveOrderProfits } from '../agent/settlement.service';
import { findActiveAgentByUserIdForOrder } from '../orders/orders.repo';
import { decrementBindingCachedStockRepo } from './upstream.bindings.repo';
import {
  hasCompleteUpstreamUnits,
  isSupplierProcurementEnabled,
  placeUpstreamOrder,
} from './upstream.order.adapter';
import {
  claimUpstreamOrderRepo,
  countUpstreamAttemptsForOrderRepo,
  finalizeOrderDeliveredCasRepo,
  findBlockingUpstreamAttemptRepo,
  findCandidateBindingRowsRepo,
  findOrderWithProductWarrantyRepo,
  isUpstreamOnlySpecRepo,
  updateOrderCommissionAmountRepo,
  updateUpstreamOrderRepo,
} from './upstream.orders.repo';
import { findUpstreamSourceById } from './upstream.repo';
import type { UpstreamSourceRow } from './upstream.types';

export { pollSingleUpstreamOrder, runScheduledUpstreamOrderPoll } from './upstream.poll.service';

export interface ActiveBindingWithSource {
  binding_id: number;
  product_id: number;
  spec_id: string;
  source_id: number;
  upstream_item_id: string;
  upstream_spec_id: string;
  fulfillment_mode: 'upstream_only' | 'local_first' | string;
  routing_strategy: 'priority' | 'lowest_cost' | string;
  priority: number;
  cached_cost: number;
  cached_stock: number;
  is_enabled: number;
  circuit_broken_reason: string;
  source: UpstreamSourceRow;
}

export interface UpstreamFulfillmentOutcome {
  status: 'delivered' | 'upstream_pending' | 'failed';
  cards: string[];
  upstreamSourceId: number | null;
  upstreamSourceName: string;
  upstreamOrderNo: string;
  upstreamCostTotal: number;
  errorMessage: string;
  upstreamOrderRowId: number | null;
}

/**
 * 加载某商品规格下所有启用、未熔断且余额可覆盖本单的上游候选路由，
 * 并按 routing_strategy（最低成本或优先级）排序。
 */
export async function getCandidateBindingsForSpec(
  env: Env,
  productId: number,
  specId: string,
  qty = 1,
  opts?: { includeZeroStock?: boolean; specificSourceId?: number }
): Promise<ActiveBindingWithSource[]> {
  const db = createDb(env.DB);
  const rows = await findCandidateBindingRowsRepo(db, productId, specId);
  const upstreamOnly = await isUpstreamOnlySpecRepo(db, productId, specId);

  const list: ActiveBindingWithSource[] = [];
  for (const { binding: b, source } of rows) {
    if (!isSupplierProcurementEnabled(env, source)) continue;
    if (upstreamOnly && b.fulfillmentMode !== 'upstream_only') continue;
    if (opts?.specificSourceId && b.sourceId !== opts.specificSourceId) continue;
    const cachedCost = Number(b.cachedCost || 0);
    const cachedStock = Number(b.cachedStock || 0);
    const cachedBal =
      source.cached_balance !== null && source.cached_balance !== undefined
        ? Number(source.cached_balance)
        : null;

    if (!opts?.includeZeroStock && cachedStock < qty) continue;
    if (cachedBal !== null && cachedCost > 0 && cachedBal + 0.001 < cachedCost * qty) continue;

    list.push({
      binding_id: b.id,
      product_id: b.productId,
      spec_id: b.specId,
      source_id: b.sourceId,
      upstream_item_id: b.upstreamItemId,
      upstream_spec_id: b.upstreamSpecId || '',
      fulfillment_mode: b.fulfillmentMode || 'local_first',
      routing_strategy: b.routingStrategy || 'priority',
      priority: Number(b.priority ?? 10),
      cached_cost: cachedCost,
      cached_stock: cachedStock,
      is_enabled: b.isEnabled,
      circuit_broken_reason: b.circuitBrokenReason || '',
      source,
    });
  }

  const useLowestCost = list.some((b) => b.routing_strategy === 'lowest_cost');
  list.sort((a, b) => {
    if (useLowestCost && a.cached_cost !== b.cached_cost) return a.cached_cost - b.cached_cost;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.cached_cost - b.cached_cost;
  });

  return list;
}

/** 实时向上游多源采购（支持明确失败自动切源，超时/异步态严禁切源以防双重采购） */
export async function executeUpstreamProcurement(
  env: Env,
  params: {
    localOrderNo: string;
    productId: number;
    specId: string;
    quantity: number;
    contactEmail: string;
    originUrl: string;
    purpose?: 'order_fulfill' | 'manual_retry' | 'restock_pull' | 'after_sale_replace';
    specificSourceId?: number;
    customInputs?: Record<string, string>;
    guard?: import('drizzle-orm').SQL;
    renewLease?: () => Promise<void>;
  }
): Promise<UpstreamFulfillmentOutcome> {
  const db = createDb(env.DB);
  const replay = async (): Promise<UpstreamFulfillmentOutcome | null> => {
    const attempt = await findBlockingUpstreamAttemptRepo(db, params.localOrderNo);
    if (!attempt) return null;
    return {
      status: 'upstream_pending',
      cards: [],
      upstreamSourceId: attempt.sourceId,
      upstreamSourceName: attempt.sourceName,
      upstreamOrderNo: attempt.upstreamOrderNo,
      upstreamCostTotal: attempt.upstreamCost,
      errorMessage: attempt.errorMessage || '已有采购待核对，使用原采购记录查单',
      upstreamOrderRowId: attempt.id,
    };
  };
  // 先记录当前序号，再查活动采购。并发调用会争用唯一采购号，不能各开一单。
  let attemptSeq = await countUpstreamAttemptsForOrderRepo(db, params.localOrderNo);
  const existing = await replay();
  if (existing) return existing;
  const candidates = await getCandidateBindingsForSpec(
    env,
    params.productId,
    params.specId,
    params.quantity,
    { specificSourceId: params.specificSourceId }
  );

  if (candidates.length === 0) {
    return {
      status: 'failed',
      cards: [],
      upstreamSourceId: null,
      upstreamSourceName: '',
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      errorMessage: '所有绑定的上游货源当前均无库存、已熔断或上游余额不足',
      upstreamOrderRowId: null,
    };
  }

  const errors: string[] = [];

  for (const cand of candidates) {
    await params.renewLease?.();
    attemptSeq += 1;
    const outTradeNo = `${params.localOrderNo}-A${attemptSeq}`;
    const webhookUrl = `${params.originUrl.replace(/\/$/, '')}/api/webhooks/upstream/${cand.source_id}`;

    const upOrderRowId = await claimUpstreamOrderRepo(
      db,
      {
        localOrderNo: params.localOrderNo,
        attemptNo: attemptSeq,
        idempotencyOutTradeNo: outTradeNo,
        sourceId: cand.source_id,
        sourceName: cand.source.name,
        bindingId: cand.binding_id,
        productId: params.productId,
        specId: params.specId,
        upstreamItemId: cand.upstream_item_id,
        upstreamSpecId: cand.upstream_spec_id,
        quantity: params.quantity,
        upstreamCost: Number((cand.cached_cost * params.quantity).toFixed(2)),
        status: 'pending',
        purpose: params.purpose || 'order_fulfill',
      },
      params.guard
    );
    if (!upOrderRowId) {
      const current = await replay();
      if (current) return current;
      return {
        status: 'upstream_pending',
        cards: [],
        upstreamSourceId: null,
        upstreamSourceName: '',
        upstreamOrderNo: '',
        upstreamCostTotal: 0,
        errorMessage: '采购正在核对，请使用原单查单',
        upstreamOrderRowId: null,
      };
    }

    const res = await placeUpstreamOrder(env, cand.source, {
      upstreamItemId: cand.upstream_item_id,
      upstreamSpecId: cand.upstream_spec_id || undefined,
      quantity: params.quantity,
      outTradeNo,
      contactEmail: params.contactEmail,
      webhookUrl,
      unitCostHint: cand.cached_cost,
      customInputs: params.customInputs,
    }).catch(() => ({
      status: 'timeout_unknown' as const,
      upstreamOrderNo: '',
      cards: [],
      actualCost: Number((cand.cached_cost * params.quantity).toFixed(2)),
      errorMessage: '供应商受理状态待核对',
      rawResponse: {},
    }));

    if (res.status === 'succeeded' && hasCompleteUpstreamUnits(res.cards, params.quantity)) {
      const recorded = await updateUpstreamOrderRepo(env, upOrderRowId, {
        status: 'succeeded',
        upstreamOrderNo: res.upstreamOrderNo,
        upstreamCost: res.actualCost,
        cardsJson: JSON.stringify(res.cards),
        rawResponseJson: JSON.stringify(res.rawResponse),
      });
      if (recorded) await decrementBindingCachedStockRepo(db, cand.binding_id, params.quantity);
      else {
        const current = await replay();
        if (current) return current;
      }

      const freshSrc = await findUpstreamSourceById(db, cand.source_id);
      if (
        freshSrc?.cached_balance !== null &&
        freshSrc?.cached_balance !== undefined &&
        freshSrc.low_balance_threshold > 0 &&
        freshSrc.cached_balance < freshSrc.low_balance_threshold
      ) {
        void dispatchOpsNotification(env, 'upstream_alert', '上游出卡后余额低位预警', [
          `货源：${cand.source.name}`,
          `扣款后余额：¥${Number(freshSrc.cached_balance).toFixed(2)}（预警线 ¥${freshSrc.low_balance_threshold}）`,
          `关联订单：${params.localOrderNo}（上游单号 ${res.upstreamOrderNo}）`,
        ]);
      }

      return {
        status: 'delivered',
        cards: res.cards,
        upstreamSourceId: cand.source_id,
        upstreamSourceName: cand.source.name,
        upstreamOrderNo: res.upstreamOrderNo,
        upstreamCostTotal: res.actualCost,
        errorMessage: '',
        upstreamOrderRowId: upOrderRowId,
      };
    }

    if (res.status !== 'failed') {
      await updateUpstreamOrderRepo(env, upOrderRowId, {
        status: res.status === 'timeout_unknown' ? res.status : 'pending',
        upstreamOrderNo: res.upstreamOrderNo,
        upstreamCost: res.actualCost,
        errorMessage: res.errorMessage,
        rawResponseJson: JSON.stringify(res.rawResponse),
      });
      return {
        status: 'upstream_pending',
        cards: [],
        upstreamSourceId: cand.source_id,
        upstreamSourceName: cand.source.name,
        upstreamOrderNo: res.upstreamOrderNo,
        upstreamCostTotal: res.actualCost,
        errorMessage: res.errorMessage,
        upstreamOrderRowId: upOrderRowId,
      };
    }

    const rejected = await updateUpstreamOrderRepo(env, upOrderRowId, {
      status: 'failed',
      upstreamOrderNo: res.upstreamOrderNo,
      errorMessage: res.errorMessage,
      rawResponseJson: JSON.stringify(res.rawResponse),
    });
    if (!rejected) {
      const current = await replay();
      if (current) return current;
    }
    errors.push(`[${cand.source.name}] ${res.errorMessage}`);
  }

  return {
    status: 'failed',
    cards: [],
    upstreamSourceId: null,
    upstreamSourceName: '',
    upstreamOrderNo: '',
    upstreamCostTotal: 0,
    errorMessage: errors.join('；') || '上游采购失败',
    upstreamOrderRowId: null,
  };
}

/** 幂等完结上游交付订单（CAS 防覆盖已退款订单 + 触发分站白标交付邮件） */
export async function finalizeOrderDeliveryWithCards(
  env: Env,
  params: {
    localOrderNo: string;
    cards: string[];
    upstreamSourceId?: number | null;
    upstreamOrderNo?: string;
    upstreamCostTotal?: number;
    upstreamOrderRowId?: number | null;
    originUrl?: string;
  }
): Promise<{ ok: boolean; alreadyDelivered?: boolean; mail_status?: QueuedMailResult['mail_status'] }> {
  const db = createDb(env.DB);
  const found = await findOrderWithProductWarrantyRepo(db, params.localOrderNo);
  if (!found) return { ok: false };

  const order = found.order;
  if (order.status === 'delivered' && order.upstreamStatus === 'delivered') {
    return { ok: true, alreadyDelivered: true };
  }
  if (
    !['paid', 'processing', 'upstream_pending', 'fulfillment_failed'].includes(order.status) ||
    !hasCompleteUpstreamUnits(params.cards, order.quantity)
  ) {
    return { ok: false };
  }

  const payload = params.cards.join('\n');
  const updated = await finalizeOrderDeliveredCasRepo(db, {
    localOrderNo: params.localOrderNo,
    payload: await sealDeliveryPayload(env, params.localOrderNo, payload),
    upstreamSourceId: params.upstreamSourceId,
    upstreamOrderNo: params.upstreamOrderNo,
    upstreamCostTotal: params.upstreamCostTotal,
  });
  if (!updated) return { ok: false };

  if (params.upstreamOrderRowId) {
    await updateUpstreamOrderRepo(env, params.upstreamOrderRowId, {
      status: 'succeeded',
      ...(params.upstreamOrderNo ? { upstreamOrderNo: params.upstreamOrderNo } : {}),
      cardsJson: JSON.stringify(params.cards),
      errorMessage: '',
    });
  }

  // S8 延迟分润收口：仅首次从 upstream_pending/processing 真正交付出卡时补结算代理分润与推客返佣
  if (Number(order.commissionAmount || 0) === 0 && order.agentId && Number(order.agentId) > 0) {
    const qty = Math.max(1, Number(order.quantity || 1));
    const specs = safeJsonParse<ProductSpec[]>(found.prodSpecsJson || '[]', []);
    const matchedSpec = specs.find((s) => s.id === order.specId);
    const mainUnitPrice = Number(matchedSpec?.price ?? order.unitPrice ?? 0);
    const baseMainTotal = Number((mainUnitPrice * qty).toFixed(2));
    const totalAmount = Number(order.totalAmount || 0);

    let mode: 'retail' | 'b2b_api' = order.channel === 'reseller_api' ? 'b2b_api' : 'retail';
    let sellingAgentId = Number(order.agentId);
    if (mode === 'retail' && order.userId) {
      const buyerAgent = await findActiveAgentByUserIdForOrder(db, order.userId);
      if (buyerAgent && Number(buyerAgent.parentAgentId || 0) === sellingAgentId) {
        mode = 'b2b_api';
        sellingAgentId = buyerAgent.id;
      }
    }

    const settled = await settleRecursiveOrderProfits({
      env,
      orderNo: params.localOrderNo,
      sellingAgentId,
      baseMainTotal,
      totalAmount,
      mode,
    });
    if (settled.totalSettledToChain > 0) {
      await updateOrderCommissionAmountRepo(db, params.localOrderNo, settled.totalSettledToChain);
    }
  }

  if ((order.channel || 'web') !== 'reseller_api') {
    await settleAffiliateRewardForOrder(env, params.localOrderNo).catch(() => undefined);
    if (order.publicOrderNo) {
      const mail = await sendQueuedOrderEmails(env, order.agentId ?? 0, order.publicOrderNo).catch(
        () => undefined
      );
      return { ok: true, mail_status: mail?.mail_status ?? ('pending' as const) };
    }
  }

  return { ok: true, mail_status: 'disabled' as const };
}
