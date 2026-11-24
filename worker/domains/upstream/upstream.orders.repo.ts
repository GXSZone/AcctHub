import { and, desc, eq, inArray, not, or, sql } from 'drizzle-orm';
import {
  orders,
  products,
  productUpstreamBindings,
  upstreamOrders,
  upstreamSources,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { encryptSecret } from '../../infra/crypto';
import { type AppDatabase, createDb } from '../../infra/db';
import { prepareAffiliateRewardAfterOrderFinalization } from '../account/affiliate-posting.repo';
import { countUpstreamSaleAfterDelivery } from '../orders/orders.repo';
import { orderAbortRequested } from '../orders/orders.wallet.repo';
import { noOtherActiveOrderPurchase } from './upstream.poll.repo';
import { mapUpstreamSourceRow } from './upstream.repo';

/** 查询商品某规格下所有启用、未熔断且所属上游源活跃的候选路由绑定 */
export async function findCandidateBindingRowsRepo(db: AppDatabase, productId: number, specId: string) {
  const rows = await db
    .select({
      binding: productUpstreamBindings,
      source: upstreamSources,
    })
    .from(productUpstreamBindings)
    .innerJoin(upstreamSources, eq(upstreamSources.id, productUpstreamBindings.sourceId))
    .where(
      and(
        eq(productUpstreamBindings.productId, productId),
        eq(productUpstreamBindings.specId, specId),
        eq(productUpstreamBindings.isEnabled, 1),
        eq(productUpstreamBindings.circuitBrokenReason, ''),
        eq(upstreamSources.status, 'active')
      )
    );

  return rows.map(({ binding, source }) => ({
    binding,
    source: mapUpstreamSourceRow(source),
  }));
}

export async function isUpstreamOnlySpecRepo(db: AppDatabase, productId: number, specId: string) {
  const [policy] = await db
    .select({ id: productUpstreamBindings.id })
    .from(productUpstreamBindings)
    .where(
      and(
        eq(productUpstreamBindings.productId, productId),
        eq(productUpstreamBindings.specId, specId),
        eq(productUpstreamBindings.fulfillmentMode, 'upstream_only')
      )
    )
    .limit(1);
  return Boolean(policy);
}

export async function findBindingWithSourceByIdRepo(db: AppDatabase, bindingId: number) {
  const rows = await db
    .select({
      binding: productUpstreamBindings,
      source: upstreamSources,
    })
    .from(productUpstreamBindings)
    .innerJoin(upstreamSources, eq(upstreamSources.id, productUpstreamBindings.sourceId))
    .where(eq(productUpstreamBindings.id, bindingId))
    .limit(1);
  if (!rows[0]) return null;
  return {
    binding: rows[0].binding,
    source: mapUpstreamSourceRow(rows[0].source),
  };
}

export async function countUpstreamAttemptsForOrderRepo(
  db: AppDatabase,
  localOrderNo: string
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(upstreamOrders)
    .where(eq(upstreamOrders.localOrderNo, localOrderNo));
  return Number(rows[0]?.c || 0);
}

export async function findBlockingUpstreamAttemptRepo(db: AppDatabase, localOrderNo: string) {
  const [attempt] = await db
    .select()
    .from(upstreamOrders)
    .where(
      and(
        eq(upstreamOrders.localOrderNo, localOrderNo),
        inArray(upstreamOrders.status, ['pending', 'timeout_unknown', 'orphan', 'succeeded'])
      )
    )
    .orderBy(desc(upstreamOrders.id))
    .limit(1);
  return attempt ?? null;
}

export async function claimUpstreamOrderRepo(
  db: AppDatabase,
  values: typeof upstreamOrders.$inferInsert,
  guard = sql`1`
) {
  const purpose = values.purpose ?? 'order_fulfill';
  const attempt = await db.get<{ id: number }>(sql`
    INSERT INTO upstream_orders (
      local_order_no, attempt_no, idempotency_out_trade_no, source_id, source_name,
      binding_id, product_id, spec_id, upstream_item_id, upstream_spec_id,
      quantity, upstream_cost, status, purpose
    )
    SELECT ${values.localOrderNo ?? ''}, ${values.attemptNo ?? 1}, ${values.idempotencyOutTradeNo},
      ${values.sourceId}, ${values.sourceName ?? ''}, ${values.bindingId ?? null},
      ${values.productId ?? null}, ${values.specId ?? 'default'}, ${values.upstreamItemId ?? ''},
      ${values.upstreamSpecId ?? ''}, ${values.quantity ?? 1}, ${values.upstreamCost ?? 0},
      ${values.status ?? 'pending'}, ${purpose}
    WHERE (${purpose} NOT IN ('order_fulfill', 'manual_retry') OR (
      EXISTS (SELECT 1 FROM orders WHERE order_no = ${values.localOrderNo} AND status != 'refunded')
      AND NOT EXISTS (SELECT 1 FROM order_refunds WHERE order_no = ${values.localOrderNo})
    )) AND ${guard}
    ON CONFLICT(idempotency_out_trade_no) DO NOTHING
    RETURNING id
  `);
  return attempt?.id;
}

export async function insertUpstreamOrderRepo(
  db: AppDatabase,
  values: typeof upstreamOrders.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(upstreamOrders).values(values).returning({ id: upstreamOrders.id });
  return ins.id;
}

export async function updateUpstreamOrderRepo(
  env: Env,
  id: number,
  patch: Partial<typeof upstreamOrders.$inferInsert>
): Promise<boolean> {
  const [cardsJson, rawResponseJson] = await Promise.all([
    patch.cardsJson === undefined ? undefined : encryptSecret(env, patch.cardsJson, `upstream-cards:${id}`),
    patch.rawResponseJson === undefined
      ? undefined
      : encryptSecret(env, patch.rawResponseJson, `upstream-response:${id}`),
  ]);
  const [updated] = await createDb(env.DB)
    .update(upstreamOrders)
    .set({ ...patch, cardsJson, rawResponseJson, updatedAt: sql`datetime('now')` })
    .where(and(eq(upstreamOrders.id, id), inArray(upstreamOrders.status, ['pending', 'timeout_unknown'])))
    .returning({ id: upstreamOrders.id });
  return Boolean(updated);
}

export async function findUpstreamOrderByIdRepo(db: AppDatabase, upOrderId: number) {
  const rows = await db.select().from(upstreamOrders).where(eq(upstreamOrders.id, upOrderId)).limit(1);
  return rows[0] ?? null;
}

export async function findUpstreamOrderForWebhookRepo(
  db: AppDatabase,
  sourceId: number,
  outTradeNo: string,
  upstreamOrderNo: string
) {
  if (outTradeNo) {
    const rows = await db
      .select()
      .from(upstreamOrders)
      .where(
        and(
          eq(upstreamOrders.sourceId, sourceId),
          or(
            eq(upstreamOrders.idempotencyOutTradeNo, outTradeNo),
            eq(upstreamOrders.localOrderNo, outTradeNo)
          )
        )
      )
      .orderBy(desc(upstreamOrders.id))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  if (upstreamOrderNo) {
    const rows = await db
      .select()
      .from(upstreamOrders)
      .where(and(eq(upstreamOrders.sourceId, sourceId), eq(upstreamOrders.upstreamOrderNo, upstreamOrderNo)))
      .orderBy(desc(upstreamOrders.id))
      .limit(1);
    if (rows[0]) return rows[0];
  }
  return null;
}

/** 轮询仍未终结时递增值重试计数并刷入当前时间戳放到队尾；超过 30 次自动标为 orphan 等待人工排查 */
export async function bumpUpstreamOrderRetryRepo(
  db: AppDatabase,
  id: number,
  errorMsg: string
): Promise<{ retryCount: number; markedOrphan: boolean }> {
  const [updated] = await db
    .update(upstreamOrders)
    .set({
      retryCount: sql`COALESCE(${upstreamOrders.retryCount}, 0) + 1`,
      errorMessage: errorMsg.slice(0, 300),
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(upstreamOrders.id, id), inArray(upstreamOrders.status, ['pending', 'timeout_unknown'])))
    .returning({ retryCount: upstreamOrders.retryCount });

  const retryCount = Number(updated?.retryCount ?? 0);
  if (retryCount >= 30) {
    const [orphan] = await db
      .update(upstreamOrders)
      .set({
        status: 'orphan',
        errorMessage: `轮询超过 30 次仍未出卡，已自动转为 orphan 待人工核查（${errorMsg.slice(0, 180)}）`,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(upstreamOrders.id, id), inArray(upstreamOrders.status, ['pending', 'timeout_unknown'])))
      .returning({ id: upstreamOrders.id });
    return { retryCount, markedOrphan: Boolean(orphan) };
  }

  return { retryCount, markedOrphan: false };
}

export async function listUpstreamOrdersLedgerRepo(db: AppDatabase, limit = 100) {
  const rows = await db
    .select({
      uo: upstreamOrders,
      localTotalAmount: orders.totalAmount,
      localCommission: orders.commissionAmount,
      localProductTitle: orders.productTitle,
      localContactEmail: orders.contactEmail,
      localOrderStatus: orders.status,
    })
    .from(upstreamOrders)
    .leftJoin(orders, eq(orders.orderNo, upstreamOrders.localOrderNo))
    .orderBy(desc(upstreamOrders.id))
    .limit(limit);

  return rows.map(
    ({ uo, localTotalAmount, localCommission, localProductTitle, localContactEmail, localOrderStatus }) => ({
      id: uo.id,
      local_order_no: uo.localOrderNo,
      attempt_no: uo.attemptNo,
      idempotency_out_trade_no: uo.idempotencyOutTradeNo,
      source_id: uo.sourceId,
      source_name: uo.sourceName,
      binding_id: uo.bindingId,
      product_id: uo.productId,
      spec_id: uo.specId,
      upstream_item_id: uo.upstreamItemId,
      upstream_spec_id: uo.upstreamSpecId,
      quantity: uo.quantity,
      upstream_order_no: uo.upstreamOrderNo,
      upstream_cost: uo.upstreamCost,
      status: uo.status,
      purpose: uo.purpose,
      error_message: uo.errorMessage,
      created_at: uo.createdAt,
      updated_at: uo.updatedAt,
      local_total_amount: localTotalAmount,
      local_commission: localCommission,
      local_product_title: localProductTitle,
      local_contact_email: localContactEmail,
      local_order_status: localOrderStatus,
    })
  );
}

export async function listExceptionOrdersRepo(db: AppDatabase, limit = 80) {
  const rows = await db
    .select({
      o: orders,
      upstreamSourceName: upstreamSources.name,
    })
    .from(orders)
    .leftJoin(upstreamSources, eq(upstreamSources.id, orders.upstreamSourceId))
    .where(inArray(orders.status, ['upstream_pending', 'fulfillment_failed']))
    .orderBy(desc(orders.id))
    .limit(limit);

  return rows.map(({ o, upstreamSourceName }) => ({
    id: o.id,
    order_no: o.orderNo,
    user_id: o.userId,
    agent_id: o.agentId,
    tenant_slug: o.tenantSlug,
    contact_email: o.contactEmail,
    product_id: o.productId,
    product_title: o.productTitle,
    spec_id: o.specId,
    spec_name: o.specName,
    quantity: o.quantity,
    unit_price: o.unitPrice,
    total_amount: o.totalAmount,
    commission_amount: o.commissionAmount,
    payment_method: o.paymentMethod,
    channel: o.channel,
    status: o.status,
    fulfillment_source: o.fulfillmentSource,
    upstream_source_id: o.upstreamSourceId,
    upstream_order_no: o.upstreamOrderNo,
    upstream_cost_total: o.upstreamCostTotal,
    upstream_status: o.upstreamStatus,
    upstream_error: o.upstreamError,
    created_at: o.createdAt,
    upstream_source_name: upstreamSourceName,
  }));
}

export async function getUpstreamDeliveredProfitAggRepo(db: AppDatabase) {
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
      grossRevenue: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)`,
      totalCommission: sql<number>`COALESCE(SUM(${orders.commissionAmount}), 0)`,
      totalUpstreamCost: sql<number>`COALESCE(SUM(${orders.upstreamCostTotal}), 0)`,
    })
    .from(orders)
    .where(and(eq(orders.fulfillmentSource, 'upstream'), eq(orders.status, 'delivered')));
  return rows[0];
}

export async function findOrderWithProductWarrantyRepo(db: AppDatabase, orderNo: string) {
  const rows = await db
    .select({
      order: orders,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
      prodBasePrice: products.basePrice,
      prodSpecsJson: products.specsJson,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(eq(orders.orderNo, orderNo))
    .limit(1);
  return rows[0] ?? null;
}

/** 回写上游延迟交付订单在补结算分润后的 commission_amount */
export async function updateOrderCommissionAmountRepo(
  db: AppDatabase,
  orderNo: string,
  commissionAmount: number
): Promise<void> {
  await db
    .update(orders)
    .set({ commissionAmount: Number(commissionAmount.toFixed(2)) })
    .where(eq(orders.orderNo, orderNo));
}

/** CAS 将非退款、非已交付订单原子推进为已交付，严防迟到 Webhook 或补发逆向覆盖 refunded 订单，并返回是否为首次推进 */
export async function finalizeOrderDeliveredCasRepo(
  db: AppDatabase,
  input: {
    localOrderNo: string;
    payload: string;
    upstreamSourceId?: number | null;
    upstreamOrderNo?: string;
    upstreamCostTotal?: number;
  }
): Promise<boolean> {
  const finalize = db
    .update(orders)
    .set({
      status: 'delivered',
      deliveredPayload: input.payload,
      fulfillmentSource: 'upstream',
      ...(input.upstreamSourceId ? { upstreamSourceId: input.upstreamSourceId } : {}),
      ...(input.upstreamOrderNo ? { upstreamOrderNo: input.upstreamOrderNo } : {}),
      ...(input.upstreamCostTotal && input.upstreamCostTotal > 0
        ? { upstreamCostTotal: input.upstreamCostTotal }
        : {}),
      upstreamStatus: 'delivered',
      upstreamError: '',
    })
    .where(
      and(
        eq(orders.orderNo, input.localOrderNo),
        not(orderAbortRequested(db, input.localOrderNo)),
        sql`NOT EXISTS (SELECT 1 FROM order_refunds WHERE order_no = ${input.localOrderNo} AND status != 'failed')`,
        inArray(orders.status, ['paid', 'processing', 'upstream_pending', 'fulfillment_failed'])
      )
    )
    .returning({ id: orders.id });
  const rewards = await prepareAffiliateRewardAfterOrderFinalization(db, input.localOrderNo, 'delivered');
  const [updated] = await db.batch([
    finalize,
    countUpstreamSaleAfterDelivery(db, input.localOrderNo),
    ...rewards,
  ]);
  return updated.length === 1;
}

export async function markPendingOrderFailedRepo(
  db: AppDatabase,
  localOrderNo: string,
  errorMessage: string,
  recoveredPurchaseId?: number
): Promise<void> {
  await db
    .update(orders)
    .set({
      status: 'fulfillment_failed',
      upstreamStatus: 'failed',
      upstreamError: errorMessage,
    })
    .where(
      and(
        eq(orders.orderNo, localOrderNo),
        recoveredPurchaseId === undefined
          ? inArray(orders.status, ['processing', 'upstream_pending'])
          : and(
              eq(orders.status, 'upstream_pending'),
              noOtherActiveOrderPurchase(localOrderNo, recoveredPurchaseId)
            )
      )
    );
}

export async function updateOrderUpstreamStateRepo(
  db: AppDatabase,
  orderNo: string,
  patch: Partial<typeof orders.$inferInsert>
): Promise<void> {
  await db
    .update(orders)
    .set(patch)
    .where(
      and(
        eq(orders.orderNo, orderNo),
        eq(orders.status, 'fulfillment_failed'),
        sql`NOT EXISTS (SELECT 1 FROM order_refunds WHERE order_no = ${orderNo} AND status != 'failed')`
      )
    );
}
