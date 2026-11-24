import { roundCurrency } from '@shared/domain/money';
import {
  parsePaymentFeeRatePct,
  paymentPluginPublicFields,
  paymentPluginSecretFields,
} from '@shared/domain/payment-plugin-settings';
import { and, eq, sql } from 'drizzle-orm';
import { orders, tenantPaymentPlugins } from '../../db/schema/index';
import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import { type AppDatabase, createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { dispatchOpsNotification } from '../../infra/notify';
import {
  parsePaymentPluginConfig,
  sealPaymentPluginCredential,
} from '../../infra/payment-credential-storage';
import {
  accountCanPost,
  commitWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';
import type { ActiveAgentContext } from '../agent/agent.guard';
import { getAgentLineageNode, settleRecursiveOrderProfits } from '../agent/settlement.service';
import { checkSpecAvailability, executeUnifiedFulfillment } from '../fulfillment/fulfillment.service';
import { findOrderByNo, findProductById, updateOrderFulfillmentResult } from './payment.order.repo';
import type { PaymentFulfillLease } from './payment.repo';

const TENANT_SUPPORTED_PLUGINS = [
  { id: 'epay', name: '易支付网关（直收）', description: '分站自有易支付商户直收（支付宝/微信）' },
  { id: 'alipay_f2f', name: '支付宝当面付（直收）', description: '分站自有支付宝当面付扫码直收' },
  { id: 'stripe', name: 'Stripe 国际卡（直收）', description: '分站自有 Stripe Checkout 直收' },
  { id: 'usdt_trc20', name: 'USDT-TRC20（直收）', description: '分站自有 TRC20 收款地址链上直收' },
] as const;

function assertOwnPaymentAllowed(ctx: ActiveAgentContext): void {
  if (!ctx.tenant.capabilities?.allow_own_payment) {
    throw Errors.forbidden('当前分站尚未获平台授权开通「自有收款渠道」功能');
  }
}

export async function listAgentPaymentPlugins(env: Env, ctx: ActiveAgentContext) {
  assertOwnPaymentAllowed(ctx);
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(tenantPaymentPlugins)
    .where(eq(tenantPaymentPlugins.ownerAgentId, ctx.agent.id));
  const byId = new Map(rows.map((r) => [r.pluginId, r]));

  return {
    plugins: TENANT_SUPPORTED_PLUGINS.map((meta) => {
      const row = byId.get(meta.id);
      const config = parsePaymentPluginConfig(row?.configJson || '{}');
      const publicFields = paymentPluginPublicFields[meta.id] || [];
      const secretFields = paymentPluginSecretFields[meta.id] || [];
      return {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        enabled: row?.enabled ?? 0,
        config_json: JSON.stringify(
          Object.fromEntries(
            publicFields.map((field) => [
              field,
              ['string', 'number', 'boolean'].includes(typeof config[field]) ? config[field] : '',
            ])
          )
        ),
        secrets_configured: Object.fromEntries(
          secretFields.map((field) => [
            field,
            typeof config[field] === 'string' && Boolean(config[field].trim()),
          ])
        ),
        updated_at: row?.updatedAt || '',
      };
    }),
  };
}

export async function updateAgentPaymentPlugin(
  env: Env,
  ctx: ActiveAgentContext,
  pluginId: string,
  body: { enabled?: boolean; config?: Record<string, unknown> }
) {
  assertOwnPaymentAllowed(ctx);
  if (!TENANT_SUPPORTED_PLUGINS.some((p) => p.id === pluginId)) {
    throw Errors.validation(`不支持的分站自有收款通道：${pluginId}`);
  }
  const db = createDb(env.DB);
  const existing = await db
    .select()
    .from(tenantPaymentPlugins)
    .where(
      and(eq(tenantPaymentPlugins.ownerAgentId, ctx.agent.id), eq(tenantPaymentPlugins.pluginId, pluginId))
    )
    .limit(1);

  const prevCfg = parsePaymentPluginConfig(existing[0]?.configJson || '{}');
  const nextCfg: Record<string, unknown> = { ...prevCfg };
  const secretFields = paymentPluginSecretFields[pluginId] || [];
  if (body.config && typeof body.config === 'object') {
    for (const [k, v] of Object.entries(body.config)) {
      if (v === undefined || v === null) continue;
      if (secretFields.includes(k)) {
        const strVal = typeof v === 'string' ? v.trim() : '';
        if (!strVal) continue;
        nextCfg[k] = await sealPaymentPluginCredential(env, pluginId, k, strVal);
        continue;
      }
      nextCfg[k] = v;
    }
  }
  const enabledVal = body.enabled !== undefined ? (body.enabled ? 1 : 0) : (existing[0]?.enabled ?? 0);

  await db
    .insert(tenantPaymentPlugins)
    .values({
      ownerAgentId: ctx.agent.id,
      pluginId,
      enabled: enabledVal,
      configJson: JSON.stringify(nextCfg),
      updatedAt: sql`datetime('now')` as unknown as string,
    })
    .onConflictDoUpdate({
      target: [tenantPaymentPlugins.ownerAgentId, tenantPaymentPlugins.pluginId],
      set: {
        enabled: enabledVal,
        configJson: JSON.stringify(nextCfg),
        updatedAt: sql`datetime('now')` as unknown as string,
      },
    });

  return { ok: true };
}

/** 列出指定分站当前已启用的自有收款通道（用于前台展示，含公开买家手续费率） */
export async function listEnabledTenantPaymentMethods(db: AppDatabase, agentId: number) {
  const rows = await db
    .select({ pluginId: tenantPaymentPlugins.pluginId, configJson: tenantPaymentPlugins.configJson })
    .from(tenantPaymentPlugins)
    .where(and(eq(tenantPaymentPlugins.ownerAgentId, agentId), eq(tenantPaymentPlugins.enabled, 1)));
  const byId = new Map(rows.map((r) => [r.pluginId, r.configJson]));
  return TENANT_SUPPORTED_PLUGINS.filter((m) => byId.has(m.id)).map((m) => ({
    id: m.id,
    name: m.name.replace('（直收）', ''),
    description: m.description,
    enabled: 1,
    is_tenant_own: true,
    fee_rate_pct: parsePaymentFeeRatePct(byId.get(m.id)),
  }));
}

export async function isTenantPaymentPluginEnabled(
  db: AppDatabase,
  agentId: number,
  pluginId: string
): Promise<boolean> {
  const rows = await db
    .select({ enabled: tenantPaymentPlugins.enabled })
    .from(tenantPaymentPlugins)
    .where(
      and(
        eq(tenantPaymentPlugins.ownerAgentId, agentId),
        eq(tenantPaymentPlugins.pluginId, pluginId),
        eq(tenantPaymentPlugins.enabled, 1)
      )
    )
    .limit(1);
  return rows.length === 1;
}

/**
 * 分站自有收款售出平台代销商品：
 * 原子从分站站长钱包扣除拿货底价（严防负余额、防重扣幂等），并结算多级上级极差利润。
 */
export async function deductAgentDirectCollectFloorAtomic(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    sellingAgentId: number;
    baseMainTotal: number;
    totalAmount: number;
  }
): Promise<{ funded: boolean; floorAmount: number; upstreamSpread: number }> {
  const seller = await getAgentLineageNode(env, params.sellingAgentId);
  if (seller?.status !== 'active') {
    return { funded: false, floorAmount: params.baseMainTotal, upstreamSpread: 0 };
  }
  const floorAmount = roundCurrency(params.baseMainTotal * Number(seller.discount_rate));
  if (floorAmount <= 0) return { funded: true, floorAmount: 0, upstreamSpread: 0 };

  const debit = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('direct-collect-floor', params.orderNo),
      amount: floorAmount,
      when: accountCanPost(db, seller.user_id, -floorAmount),
    },
    (owned) =>
      walletPosting(db, owned, {
        userId: seller.user_id,
        type: 'order_pay',
        amount: -floorAmount,
        refNo: params.orderNo,
        note: `分站自有收款代销拿货底价扣款（${params.orderNo}）`,
      })
  );

  if (!debit.applied && debit.amount === null) {
    return { funded: false, floorAmount, upstreamSpread: 0 };
  }

  // 拿货底价扣款成功后，为上级代理实时结算供应链差价（不含当前卖方直营零售利润，因为钱已直收进卖方账户）
  const settled = await settleRecursiveOrderProfits({
    env,
    orderNo: params.orderNo,
    sellingAgentId: params.sellingAgentId,
    baseMainTotal: params.baseMainTotal,
    totalAmount: floorAmount,
    mode: 'b2b_api',
  });
  return { funded: true, floorAmount, upstreamSpread: settled.totalSettledToChain };
}

/** 异步回调履约前检查：分站直收平台商品时原子扣拿货底价，不足则挂起 awaiting_agent_funding */
export async function ensureDirectCollectFloorFunded(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    sellingAgentId: number;
    baseMainTotal: number;
    totalAmount: number;
    lease: PaymentFulfillLease;
    renewLease: () => Promise<void>;
  }
): Promise<boolean> {
  const funding = await deductAgentDirectCollectFloorAtomic(env, db, params);
  if (funding.funded) return true;
  await params.renewLease();
  await updateOrderFulfillmentResult(
    db,
    params.orderNo,
    {
      status: 'awaiting_agent_funding',
      deliveredPayload: '',
      commissionAmount: 0,
      fulfillmentSource: 'local',
      upstreamSourceId: null,
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      upstreamStatus: 'none',
      upstreamError: `分站站长平台余额不足以支付拿货底价 ¥${funding.floorAmount.toFixed(2)}，等待充值补扣发卡`,
    },
    params.lease
  );
  void dispatchOpsNotification(env, 'upstream_alert', '分站直收订单因站长余额不足暂停履约', [
    `订单号：${params.orderNo} · 分站 #${params.sellingAgentId}`,
    `需扣拿货底价：¥${funding.floorAmount.toFixed(2)}`,
  ]);
  return false;
}

/** 分站站长充值余额后，针对 awaiting_agent_funding 订单一键补扣底价并自动发卡交付 */
export async function retryAgentOrderFunding(
  env: Env,
  ctx: ActiveAgentContext,
  orderNo: string,
  originUrl: string
) {
  const db = createDb(env.DB);
  const order = await findOrderByNo(db, orderNo);
  if (!order || order.agentId !== ctx.agent.id) {
    throw Errors.notFound('未找到该分站订单');
  }
  if (order.status !== 'awaiting_agent_funding') {
    throw Errors.conflict(`该订单当前状态为 ${order.status}，无需补扣底价`);
  }
  const product = await findProductById(db, order.productId);
  if (!product) throw Errors.notFound('关联商品不存在');

  const specs = safeJsonParse<Array<{ id: string; name: string; price: number }>>(
    product.specsJson || '[]',
    []
  );
  const selectedSpec = specs.find((s) => s.id === (order.specId || 'default')) ??
    specs[0] ?? { id: order.specId || 'default', name: order.specName || '标准版', price: product.basePrice };
  const qty = Math.max(1, Number(order.quantity || 1));
  const baseMainTotal = roundCurrency(selectedSpec.price * qty);

  // 先 CAS 锁定 awaiting_agent_funding → processing 防并发双扣与双发，同时满足分润状态机前置校验
  const locked = await db
    .update(orders)
    .set({ status: 'processing' })
    .where(and(eq(orders.orderNo, order.orderNo), eq(orders.status, 'awaiting_agent_funding')))
    .returning({ id: orders.id });
  if (locked.length !== 1) {
    throw Errors.conflict('该订单正在补发处理中，请稍候刷新');
  }

  const funding = await deductAgentDirectCollectFloorAtomic(env, db, {
    orderNo: order.orderNo,
    sellingAgentId: ctx.agent.id,
    baseMainTotal,
    totalAmount: order.totalAmount,
  });
  if (!funding.funded) {
    // 余额不足：安全回退订单状态至 awaiting_agent_funding，等待充值后重试
    await db
      .update(orders)
      .set({ status: 'awaiting_agent_funding' })
      .where(and(eq(orders.orderNo, order.orderNo), eq(orders.status, 'processing')));
    throw Errors.insufficientBalance(
      `您的平台钱包余额仍不足以支付拿货底价 ¥${funding.floorAmount.toFixed(2)}，请先充值后再试`
    );
  }

  const availability = await checkSpecAvailability(env, {
    productId: product.id,
    productOwnerAgentId: product.ownerAgentId,
    spec: selectedSpec,
    specsCount: specs.length,
    quantity: qty,
    stockMode: product.stockMode || 'cards',
    deliveryType: product.deliveryType || 'auto',
    manualStock: product.manualStock || 0,
    seatTotal: product.seatTotal || 5,
    seatUsed: product.seatUsed || 0,
  });

  const fulfill = await executeUnifiedFulfillment(env, {
    orderNo: order.orderNo,
    channel: 'web',
    paymentMethod: order.paymentMethod || 'epay',
    productId: product.id,
    productOwnerAgentId: product.ownerAgentId,
    productTitle: order.productTitle,
    spec: selectedSpec,
    specsCount: specs.length,
    quantity: qty,
    stockMode: product.stockMode || 'cards',
    deliveryType: product.deliveryType || 'auto',
    contactEmail: order.contactEmail,
    totalAmount: order.totalAmount,
    originUrl,
    customInputs: safeJsonParse<Record<string, string>>(order.customInputsJson || '{}', {}),
    availability,
  });

  if (!fulfill.ok) {
    await db
      .update(orders)
      .set({ status: 'fulfillment_failed', upstreamError: fulfill.conflictError || '补发时库存不足' })
      .where(eq(orders.orderNo, order.orderNo));
    throw Errors.conflict(fulfill.conflictError || '补发时库存不足');
  }

  await db
    .update(orders)
    .set({
      status: fulfill.orderStatus,
      commissionAmount: funding.upstreamSpread,
      deliveredPayload: await sealDeliveryPayload(env, order.orderNo, fulfill.deliveredLines.join('\n')),
      fulfillmentSource: fulfill.fulfillmentSource,
      upstreamSourceId: fulfill.upstreamSourceId,
      upstreamOrderNo: fulfill.upstreamOrderNo,
      upstreamCostTotal: fulfill.upstreamCostTotal,
      upstreamStatus: fulfill.upstreamStatus,
      upstreamError: fulfill.upstreamError,
    })
    .where(eq(orders.orderNo, order.orderNo));

  void dispatchOpsNotification(env, 'new_order', '分站待补款订单已完成补扣发卡', [
    `订单号：${order.orderNo}`,
    `分站：@${ctx.agent.slug}`,
    `扣除拿货底价：¥${funding.floorAmount.toFixed(2)}`,
    `状态：${fulfill.orderStatus}`,
  ]);

  return { ok: true, status: fulfill.orderStatus };
}
