import type { upstreamOrders } from '../../db/schema/index';
import type { Env } from '../../env';
import { readStoredCredential } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { dispatchOpsNotification } from '../../infra/notify';
import { finalizeOrderDeliveryWithCards } from './upstream.fulfillment.service';
import { hasCompleteUpstreamUnits } from './upstream.order.adapter';
import {
  bumpUpstreamOrderRetryRepo,
  findOrderWithProductWarrantyRepo,
  findUpstreamOrderByIdRepo,
  markPendingOrderFailedRepo,
  updateUpstreamOrderRepo,
} from './upstream.orders.repo';
import { listPendingUpstreamOrderIdsRepo } from './upstream.poll.repo';
import { queryUpstreamOrder } from './upstream.query.adapter';
import { completeRestockPurchaseRepo } from './upstream.recovery.repo';
import { deliverReplacementPurchase } from './upstream.replacement.service';
import { findUpstreamSourceById } from './upstream.repo';

/**
 * 统一处理上游异步出卡后的三类落地归属（L4）：
 * 1. restock_pull：预拉囤货真正入库本地 product_cards
 * 2. after_sale_replace：使用持久化的原单与工单归属进行换新
 * 3. order_fulfill / manual_retry：交付原订单；若无法交付（如不存在/已退）标记 orphan 止损不堵队头
 */
export async function settleAsyncUpstreamCardsOutcome(
  env: Env,
  input: {
    upOrder: typeof upstreamOrders.$inferSelect;
    sourceId: number;
    cards: string[];
    upstreamOrderNo: string;
    actualCost: number;
    originUrl: string;
    rawResponseJson?: string;
  }
): Promise<{ status: 'succeeded' | 'orphan' | 'pending' }> {
  const { upOrder, sourceId, cards, upstreamOrderNo, actualCost, originUrl, rawResponseJson } = input;
  if (upOrder.status === 'succeeded' || upOrder.status === 'orphan') {
    return { status: upOrder.status };
  }

  if (!hasCompleteUpstreamUnits(cards, upOrder.quantity)) return { status: 'pending' };

  const db = createDb(env.DB);
  const resolvedUpNo = upstreamOrderNo || upOrder.upstreamOrderNo || '';
  const cardsJson = JSON.stringify(cards);

  if (upOrder.purpose === 'restock_pull') {
    const prodId = Number(upOrder.productId || 0);
    if (prodId <= 0) {
      const msg = '预拉囤货上游单缺少有效 product_id，已转为 orphan 待人工核查';
      await updateUpstreamOrderRepo(env, upOrder.id, {
        status: 'orphan',
        upstreamOrderNo: resolvedUpNo,
        upstreamCost: actualCost,
        cardsJson,
        errorMessage: msg,
        ...(rawResponseJson ? { rawResponseJson } : {}),
      });
      return { status: 'orphan' };
    }
    const source = await findUpstreamSourceById(db, upOrder.sourceId);
    return completeRestockPurchaseRepo(env, {
      purchaseId: upOrder.id,
      productId: prodId,
      specId: upOrder.specId || 'default',
      cards,
      upstreamOrderNo: resolvedUpNo,
      actualCost,
      rawResponseJson,
      simulated: !source || source.adapter_type === 'mock_sandbox',
    });
  }

  if (upOrder.purpose === 'after_sale_replace') {
    const status = await deliverReplacementPurchase(env, upOrder, cards, resolvedUpNo, actualCost, originUrl);
    return { status };
  }

  // 默认分支：order_fulfill / manual_retry
  if (upOrder.localOrderNo) {
    const res = await finalizeOrderDeliveryWithCards(env, {
      localOrderNo: upOrder.localOrderNo,
      cards,
      upstreamSourceId: sourceId,
      upstreamOrderNo: resolvedUpNo,
      upstreamCostTotal: actualCost,
      upstreamOrderRowId: upOrder.id,
      originUrl,
    });
    if (res.ok) return { status: 'succeeded' };
  }

  const orphanMsg = upOrder.localOrderNo
    ? `本地订单 ${upOrder.localOrderNo} 不存在或已退款，无法交付，卡密已保留至 orphan 记录`
    : '上游采购记录缺少归属目标订单号，已转为 orphan 待人工认领';
  await updateUpstreamOrderRepo(env, upOrder.id, {
    status: 'orphan',
    upstreamOrderNo: resolvedUpNo,
    upstreamCost: actualCost,
    cardsJson,
    errorMessage: orphanMsg,
    ...(rawResponseJson ? { rawResponseJson } : {}),
  });
  void dispatchOpsNotification(env, 'upstream_alert', '【L4 孤儿卡密告警】上游出卡无法交付本地订单', [
    `上游采购单 #${upOrder.id}（${resolvedUpNo}）`,
    orphanMsg,
  ]);
  return { status: 'orphan' };
}

/** 主动轮询单笔待处理/超时上游采购单，并在上游已出卡时自动完结对应归属 */
export async function pollSingleUpstreamOrder(
  env: Env,
  upOrderId: number,
  originUrl = ''
): Promise<{ status: string; cards: string[]; errorMessage: string }> {
  const db = createDb(env.DB);
  const upOrder = await findUpstreamOrderByIdRepo(db, upOrderId);
  if (!upOrder) throw new Error('上游采购记录不存在');
  if (
    upOrder.status === 'failed' &&
    upOrder.localOrderNo &&
    ['order_fulfill', 'manual_retry'].includes(upOrder.purpose)
  ) {
    await markPendingOrderFailedRepo(db, upOrder.localOrderNo, upOrder.errorMessage, upOrder.id);
  }
  if (
    upOrder.status === 'succeeded' &&
    upOrder.localOrderNo &&
    ['order_fulfill', 'manual_retry'].includes(upOrder.purpose)
  ) {
    const local = await findOrderWithProductWarrantyRepo(db, upOrder.localOrderNo);
    if (local?.order.status === 'upstream_pending') {
      const stored = await readStoredCredential(env, upOrder.cardsJson, `upstream-cards:${upOrder.id}`);
      const cards = safeJsonParse<string[]>(stored, []);
      if (hasCompleteUpstreamUnits(cards, upOrder.quantity)) {
        await finalizeOrderDeliveryWithCards(env, {
          localOrderNo: upOrder.localOrderNo,
          cards,
          upstreamSourceId: upOrder.sourceId,
          upstreamOrderNo: upOrder.upstreamOrderNo,
          upstreamCostTotal: upOrder.upstreamCost,
          originUrl,
        });
      }
    }
  }
  if (!['pending', 'timeout_unknown'].includes(upOrder.status)) {
    return { status: upOrder.status, cards: [], errorMessage: upOrder.errorMessage };
  }

  const source = await findUpstreamSourceById(db, upOrder.sourceId);
  if (!source) {
    const orphanMsg = '关联上游货源已被删除，自动终止待查单状态';
    await updateUpstreamOrderRepo(env, upOrderId, { status: 'orphan', errorMessage: orphanMsg });
    return { status: 'orphan', cards: [], errorMessage: orphanMsg };
  }

  const qRes = await queryUpstreamOrder(env, source, {
    outTradeNo: upOrder.idempotencyOutTradeNo,
    upstreamOrderNo: upOrder.upstreamOrderNo || '',
    upstreamItemId: upOrder.upstreamItemId || '',
    quantity: Number(upOrder.quantity || 1),
  });

  if (qRes.status === 'succeeded' && qRes.cards.length > 0) {
    const settled = await settleAsyncUpstreamCardsOutcome(env, {
      upOrder,
      sourceId: source.id,
      cards: qRes.cards,
      upstreamOrderNo: qRes.upstreamOrderNo,
      actualCost: Number(upOrder.upstreamCost || 0),
      originUrl,
    });
    return {
      status: settled.status,
      cards: settled.status === 'succeeded' ? qRes.cards : [],
      errorMessage: '',
    };
  }

  if (qRes.status === 'failed') {
    const updated = await updateUpstreamOrderRepo(env, upOrderId, {
      status: 'failed',
      errorMessage: qRes.errorMessage,
    });
    if (!updated) {
      const current = await findUpstreamOrderByIdRepo(db, upOrderId);
      return { status: current?.status ?? 'pending', cards: [], errorMessage: current?.errorMessage ?? '' };
    }
    if (upOrder.localOrderNo && ['order_fulfill', 'manual_retry'].includes(upOrder.purpose)) {
      await markPendingOrderFailedRepo(db, upOrder.localOrderNo, qRes.errorMessage);
    }
    return { status: 'failed', cards: [], errorMessage: qRes.errorMessage };
  }

  const bump = await bumpUpstreamOrderRetryRepo(db, upOrderId, qRes.errorMessage || '上游处理中');
  if (!bump.retryCount) {
    const current = await findUpstreamOrderByIdRepo(db, upOrderId);
    return { status: current?.status ?? 'pending', cards: [], errorMessage: current?.errorMessage ?? '' };
  }
  if (bump.markedOrphan) {
    void dispatchOpsNotification(env, 'upstream_alert', '【L4 上游轮询超时】采购单已转为 orphan', [
      `上游采购单 #${upOrderId}（${upOrder.localOrderNo || upOrder.idempotencyOutTradeNo}）轮询已达 ${bump.retryCount} 次上限`,
      `最近信息：${qRes.errorMessage || '仍处于 pending'}`,
    ]);
    return { status: 'orphan', cards: [], errorMessage: qRes.errorMessage };
  }

  return { status: 'pending', cards: [], errorMessage: qRes.errorMessage };
}

/** Cloudflare Workers Cron 定时轮询 pending / timeout_unknown 状态的上游采购单 */
export async function runScheduledUpstreamOrderPoll(env: Env): Promise<void> {
  const ids = await listPendingUpstreamOrderIdsRepo(createDb(env.DB), 25);
  for (const id of ids) {
    await pollSingleUpstreamOrder(env, id).catch((e) =>
      console.error(`Cron poll upstream_order #${id} failed:`, e)
    );
  }
}
