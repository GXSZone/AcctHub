import { and, desc, eq, inArray, isNotNull, isNull, lt, not, or, type SQL, sql } from 'drizzle-orm';
import {
  agentProductOverrides,
  agentProductPrices,
  agents,
  coupons,
  type OrderRow,
  orders,
  type ProductRow,
  paymentPlugins,
  productCards,
  products,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { prepareAffiliateRewardAfterOrderFinalization } from '../account/affiliate-posting.repo';
import { clearBalanceOrderStock } from './orders.balance-recovery.repo';
import { orderAbortRequested, orderHasWalletActivity } from './orders.wallet.repo';

export interface OrderWithProductWarranty {
  order: OrderRow;
  prodWarrantyType: string | null;
  prodWarrantyDays: number | null;
  prodWarrantySummary: string | null;
}

export async function findIdempotentOrder(
  db: AppDatabase,
  idemKey: string,
  email: string,
  tenantAgentId: number | null
): Promise<OrderRow | null> {
  const siteCond = tenantAgentId ? eq(orders.agentId, tenantAgentId) : isNull(orders.agentId);
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.idempotencyKey, idemKey),
        eq(orders.channel, 'web'),
        siteCond,
        or(isNotNull(orders.checkoutPayloadHash), sql`lower(${orders.contactEmail}) = ${email}`)
      )
    )
    .orderBy(desc(orders.checkoutPayloadHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function isPaymentPluginEnabled(db: AppDatabase, pluginId: string): Promise<boolean> {
  const rows = await db
    .select({ enabled: paymentPlugins.enabled })
    .from(paymentPlugins)
    .where(eq(paymentPlugins.id, pluginId))
    .limit(1);
  return Number(rows[0]?.enabled ?? 0) === 1;
}

export async function findActiveProductForOrder(
  db: AppDatabase,
  productId: number
): Promise<ProductRow | null> {
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.isActive, 1)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAgentOrderOverride(db: AppDatabase, agentId: number, productId: number) {
  const rows = await db
    .select({
      isListed: agentProductOverrides.isListed,
      customTitle: agentProductOverrides.customTitle,
    })
    .from(agentProductOverrides)
    .where(and(eq(agentProductOverrides.agentId, agentId), eq(agentProductOverrides.productId, productId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findAgentCustomSpecPrice(
  db: AppDatabase,
  agentId: number,
  productId: number,
  specId: string,
  specsCount: number
): Promise<number | null> {
  if (specsCount > 1) {
    const rows = await db
      .select({ customPrice: agentProductPrices.customPrice })
      .from(agentProductPrices)
      .where(
        and(
          eq(agentProductPrices.agentId, agentId),
          eq(agentProductPrices.productId, productId),
          eq(agentProductPrices.specId, specId)
        )
      )
      .limit(1);
    return rows[0] ? Number(rows[0].customPrice) : null;
  }

  const rows = await db
    .select({ specId: agentProductPrices.specId, customPrice: agentProductPrices.customPrice })
    .from(agentProductPrices)
    .where(
      and(
        eq(agentProductPrices.agentId, agentId),
        eq(agentProductPrices.productId, productId),
        inArray(agentProductPrices.specId, [specId, 'default'])
      )
    );
  const exact = rows.find((r) => r.specId === specId);
  if (exact) return Number(exact.customPrice);
  const fallback = rows.find((r) => r.specId === 'default');
  return fallback ? Number(fallback.customPrice) : null;
}

export async function findActiveAgentByUserIdForOrder(db: AppDatabase, userId: number) {
  const rows = await db
    .select({ id: agents.id, parentAgentId: agents.parentAgentId })
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveCouponForOrder(db: AppDatabase, code: string, ownerAgentId = 0) {
  const rows = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.ownerAgentId, ownerAgentId),
        sql`upper(${coupons.code}) = ${code.toUpperCase()}`,
        eq(coupons.isActive, 1)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** CAS 原子预占优惠券使用额度，防止高并发下限量券超额核销 */
export async function claimCouponUsageAtomic(db: AppDatabase, couponId: number): Promise<boolean> {
  const updated = await db
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(
      and(
        eq(coupons.id, couponId),
        eq(coupons.isActive, 1),
        sql`(${coupons.maxUses} <= 0 OR ${coupons.usedCount} < ${coupons.maxUses})`
      )
    )
    .returning({ id: coupons.id });
  return updated.length === 1;
}

/** 回滚已预占的优惠券使用计数 */
export async function rollbackCouponUsage(db: AppDatabase, couponId: number): Promise<void> {
  await db
    .update(coupons)
    .set({ usedCount: sql`MAX(0, ${coupons.usedCount} - 1)` })
    .where(eq(coupons.id, couponId));
}

/**
 * 原子抢占订单占位槽位（L1 防线：先以 processing / pending_payment 落库再动用资金或履约）
 * 若撞作用域唯一幂等键或订单号唯一键，返回冲突类型而不先扣款。
 */
export async function claimOrderSlotAtomic(
  db: AppDatabase,
  values: typeof orders.$inferInsert
): Promise<{ claimed: true } | { claimed: false; reason: 'idempotency' | 'order_no' }> {
  try {
    await db.insert(orders).values(values);
    return { claimed: true };
  } catch (err) {
    const cause = err instanceof Error ? err.cause : undefined;
    const msg = cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err);
    if (!msg.includes('UNIQUE constraint failed')) throw err;
    if (msg.includes('uq_orders_scope_idem_key') || msg.includes('idempotency_key')) {
      return { claimed: false, reason: 'idempotency' };
    }
    if (msg.includes('order_no')) {
      return { claimed: false, reason: 'order_no' };
    }
    throw err;
  }
}

export function countUpstreamSaleAfterDelivery(db: AppDatabase, orderNo: string) {
  // 作为批次的第二条语句，仅前一条订单更新成功时计入销量。
  return db
    .update(products)
    .set({
      salesCount: sql`${products.salesCount} + (
        SELECT ${orders.quantity} FROM ${orders} WHERE ${orders.orderNo} = ${orderNo}
      )`,
    })
    .where(sql`changes() = 1 AND ${products.id} = (
      SELECT ${orders.productId} FROM ${orders} WHERE ${orders.orderNo} = ${orderNo}
        AND ${orders.status} = 'delivered' AND ${orders.fulfillmentSource} = 'upstream'
    )`);
}

/** CAS 原子将 processing 占位单推进至终态（若被抢跑的上游回调先交付，则不覆写） */
export async function finalizeProcessingOrderCas(
  db: AppDatabase,
  orderNo: string,
  patch: Partial<typeof orders.$inferInsert>,
  options?: { guard: SQL; clearStock?: boolean }
): Promise<{ updated: boolean; current: OrderRow | null }> {
  const finalize = db
    .update(orders)
    .set(patch)
    .where(
      and(
        eq(orders.orderNo, orderNo),
        eq(orders.status, 'processing'),
        not(orderAbortRequested(db, orderNo)),
        options?.guard
      )
    )
    .returning();
  const rewards = await prepareAffiliateRewardAfterOrderFinalization(db, orderNo, patch.status);
  const sales =
    patch.status === 'delivered' && patch.fulfillmentSource === 'upstream'
      ? [countUpstreamSaleAfterDelivery(db, orderNo)]
      : [];
  const clear = options?.clearStock ? [clearBalanceOrderStock(db, orderNo)] : [];
  const rows =
    sales.length || rewards.length || clear.length
      ? (await db.batch([finalize, ...sales, ...rewards, ...clear]))[0]
      : await finalize;
  if (rows[0]) return { updated: true, current: rows[0] };
  const existing = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  return { updated: false, current: existing[0] ?? null };
}

/** 在扣款失败或资金全额回滚后清理尚处于 processing/pending_payment 的空占位单 */
export async function releaseAbortedOrderSlotRepo(
  db: AppDatabase,
  orderNo: string,
  allowedStatus: 'processing' | 'pending_payment' = 'processing'
): Promise<void> {
  await db
    .delete(orders)
    .where(
      and(
        eq(orders.orderNo, orderNo),
        eq(orders.status, allowedStatus),
        not(orderHasWalletActivity(db, orderNo))
      )
    );
}

/** 更新处于 processing 占位单的实付金额、推广金抵扣额及异步支付单关联字段 */
export async function updateOrderSlotMetaRepo(
  db: AppDatabase,
  orderNo: string,
  patch: Partial<typeof orders.$inferInsert>
): Promise<void> {
  await db
    .update(orders)
    .set(patch)
    .where(and(eq(orders.orderNo, orderNo), inArray(orders.status, ['processing', 'pending_payment'])));
}

export async function countRemainingSpecCards(
  db: AppDatabase,
  productId: number,
  specId: string
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(productCards)
    .where(
      and(
        eq(productCards.productId, productId),
        eq(productCards.specId, specId),
        eq(productCards.status, 'available')
      )
    );
  return Number(rows[0]?.c ?? 0);
}

export async function listUserOrdersOnSite(
  db: AppDatabase,
  userId: number,
  tenantAgentId: number | null,
  cursor?: number
): Promise<OrderWithProductWarranty[]> {
  const siteCond = tenantAgentId ? eq(orders.agentId, tenantAgentId) : isNull(orders.agentId);
  return db
    .select({
      order: orders,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(and(eq(orders.userId, userId), siteCond, cursor ? lt(orders.id, cursor) : undefined))
    .orderBy(desc(orders.id))
    .limit(51);
}

export async function lookupOrdersOnSite(
  db: AppDatabase,
  query: string,
  tenantAgentId: number | null,
  ownerId?: number
): Promise<OrderWithProductWarranty[]> {
  const siteCond = tenantAgentId ? eq(orders.agentId, tenantAgentId) : isNull(orders.agentId);
  return db
    .select({
      order: orders,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(
      and(
        or(
          eq(orders.publicOrderNo, query),
          ownerId ? and(eq(orders.userId, ownerId), eq(orders.orderNo, query)) : undefined
        ),
        siteCond
      )
    )
    .orderBy(desc(orders.id))
    .limit(30);
}
