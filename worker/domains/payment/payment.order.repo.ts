import { and, asc, eq, exists, lte, sql } from 'drizzle-orm';
import {
  agents,
  type OrderRow,
  orders,
  type ProductRow,
  paymentIntents,
  products,
  siteSettings,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { prepareAffiliateRewardAfterOrderFinalization } from '../account/affiliate-posting.repo';
import { commitWalletEvent, promoPosting, walletEventKey } from '../account/wallet-event.repo';
import { countUpstreamSaleAfterDelivery } from '../orders/orders.repo';
import { type PaymentFulfillLease, paymentFulfillLeaseGuard } from './payment.repo';
import { getOutstandingPromoForOrder } from './payment-posting.repo';

const overdue = and(
  eq(paymentIntents.status, 'pending'),
  lte(paymentIntents.expiresAt, sql`datetime('now')`)
);

/** 关单和退回实扣推广金一起提交，成功回调先获得支付单时不再关闭关联订单。 */
export async function markPaymentIntentExpired(db: AppDatabase, intentNo: string): Promise<boolean> {
  const pending = and(eq(paymentIntents.intentNo, intentNo), overdue);
  const intent = await db
    .select({ bizType: paymentIntents.bizType, bizRef: paymentIntents.bizRef })
    .from(paymentIntents)
    .where(pending)
    .get();
  if (!intent) return false;
  const pendingOrder = and(
    eq(orders.orderNo, intent.bizRef),
    eq(orders.paymentIntentNo, intentNo),
    eq(orders.status, 'pending_payment')
  );
  const order =
    intent.bizType === 'order'
      ? await db
          .select({ id: orders.id, userId: orders.userId, promoUsedAmount: orders.promoUsedAmount })
          .from(orders)
          .where(pendingOrder)
          .get()
      : undefined;
  const amount =
    order?.userId && order.promoUsedAmount > 0
      ? Math.min(order.promoUsedAmount, await getOutstandingPromoForOrder(db, intent.bizRef, order.userId))
      : 0;

  const expired = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('payment-expiry', intentNo),
      amount,
      when: exists(db.select({ id: paymentIntents.id }).from(paymentIntents).where(pending)),
    },
    (owned) => [
      db.update(paymentIntents).set({ status: 'expired', fulfillStatus: 'none' }).where(and(pending, owned)),
      ...(order ? [db.update(orders).set({ status: 'expired' }).where(and(pendingOrder, owned))] : []),
      ...(order?.userId && amount >= 0.01
        ? promoPosting(db, owned, {
            userId: order.userId,
            amount,
            type: 'refund',
            refNo: intent.bizRef,
            note: `超时未支付关闭，原路退回预扣推广消费金（${intent.bizRef}）`,
          })
        : []),
    ]
  );
  return expired.applied;
}

export async function findOrderByNo(db: AppDatabase, orderNo: string): Promise<OrderRow | null> {
  const rows = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  return rows[0] ?? null;
}

/** CAS 原子锁定待支付或过期订单进入 processing 履约态（补偿场景下可接管滞留 processing 单） */
export async function lockPendingOrderPaidAtomic(
  db: AppDatabase,
  orderNo: string,
  options?: { allowProcessingRecovery?: boolean; lease?: PaymentFulfillLease }
): Promise<{ locked: boolean; previousStatus?: string; alreadyCompleted?: boolean }> {
  const current = await findOrderByNo(db, orderNo);
  if (!current) return { locked: false };

  const completedStatuses = [
    'delivered',
    'paid',
    'refunded',
    'risk_review',
    'upstream_pending',
    'fulfillment_failed',
    'awaiting_agent_funding',
  ];
  if (completedStatuses.includes(current.status)) {
    return { locked: false, previousStatus: current.status, alreadyCompleted: true };
  }

  const allowedSources = options?.allowProcessingRecovery
    ? ['pending_payment', 'expired', 'processing']
    : ['pending_payment', 'expired'];
  if (!allowedSources.includes(current.status)) {
    return { locked: false, previousStatus: current.status };
  }

  const updated = await db
    .update(orders)
    .set({ status: 'processing' })
    .where(
      and(
        eq(orders.orderNo, orderNo),
        eq(orders.status, current.status),
        paymentFulfillLeaseGuard(options?.lease)
      )
    )
    .returning({ id: orders.id });

  return updated.length === 1
    ? { locked: true, previousStatus: current.status }
    : { locked: false, previousStatus: current.status };
}

export async function findProductById(db: AppDatabase, productId: number): Promise<ProductRow | null> {
  const rows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  return rows[0] ?? null;
}

export async function updateOrderFulfillmentResult(
  db: AppDatabase,
  orderNo: string,
  data: {
    status: string;
    deliveredPayload: string;
    commissionAmount: number;
    fulfillmentSource: string;
    upstreamSourceId: number | null;
    upstreamOrderNo: string;
    upstreamCostTotal: number;
    upstreamStatus: string;
    upstreamError: string;
    riskFlag?: string;
    riskNote?: string;
  },
  lease?: PaymentFulfillLease
): Promise<boolean> {
  const finalize = db
    .update(orders)
    .set(data)
    .where(and(eq(orders.orderNo, orderNo), eq(orders.status, 'processing'), paymentFulfillLeaseGuard(lease)))
    .returning({ id: orders.id });
  const rewards = await prepareAffiliateRewardAfterOrderFinalization(db, orderNo, data.status);
  const sales =
    data.status === 'delivered' && data.fulfillmentSource === 'upstream'
      ? [countUpstreamSaleAfterDelivery(db, orderNo)]
      : [];
  const updated =
    sales.length || rewards.length ? (await db.batch([finalize, ...sales, ...rewards]))[0] : await finalize;
  return updated.length === 1;
}

export async function resolveSiteBrandName(db: AppDatabase, agentId: number): Promise<string> {
  if (agentId > 0) {
    const rows = await db
      .select({ brandName: agents.brandName })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (rows[0]?.brandName) return rows[0].brandName;
  } else {
    const rows = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, 'brand_name'))
      .limit(1);
    if (rows[0]?.value) return rows[0].value;
  }
  return 'AcctHub';
}

/** 定时清理单轮有上限，单笔暂时失败时继续处理其余过期支付单。 */
export async function expireOverdueIntentsAndOrders(db: AppDatabase): Promise<number> {
  const candidates = await db
    .select({ intentNo: paymentIntents.intentNo })
    .from(paymentIntents)
    .where(overdue)
    .orderBy(asc(paymentIntents.expiresAt), asc(paymentIntents.id))
    .limit(30);
  let expired = 0;
  for (const { intentNo } of candidates) {
    try {
      if (await markPaymentIntentExpired(db, intentNo)) expired += 1;
    } catch {
      console.warn('过期支付单关闭失败，下一轮将重试', { intentNo });
    }
  }
  return expired;
}
