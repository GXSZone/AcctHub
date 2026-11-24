import { and, asc, eq, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { orders, upstreamOrders } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export function noOtherActiveOrderPurchase(orderNo: string | SQL, purchaseId: number | SQL) {
  return sql`NOT EXISTS (
    SELECT 1 FROM upstream_orders AS current_attempt
    WHERE current_attempt.local_order_no = ${orderNo}
      AND current_attempt.purpose IN ('order_fulfill', 'manual_retry')
      AND (current_attempt.id > ${purchaseId} OR current_attempt.status != 'failed')
  )`;
}

/** 轮询未结束的采购，以及已落库但尚未更新本地订单的采购结果。 */
export async function listPendingUpstreamOrderIdsRepo(db: AppDatabase, limit = 25): Promise<number[]> {
  const noOtherAttempt = noOtherActiveOrderPurchase(
    sql`${upstreamOrders.localOrderNo}`,
    sql`${upstreamOrders.id}`
  );
  const rows = await db
    .select({ id: upstreamOrders.id })
    .from(upstreamOrders)
    .leftJoin(orders, eq(orders.orderNo, upstreamOrders.localOrderNo))
    .where(
      or(
        and(
          inArray(upstreamOrders.status, ['pending', 'timeout_unknown']),
          lt(upstreamOrders.retryCount, 30)
        ),
        and(
          inArray(upstreamOrders.purpose, ['order_fulfill', 'manual_retry']),
          eq(orders.status, 'upstream_pending'),
          or(eq(upstreamOrders.status, 'succeeded'), and(eq(upstreamOrders.status, 'failed'), noOtherAttempt))
        )
      )
    )
    .orderBy(asc(upstreamOrders.updatedAt), asc(upstreamOrders.id))
    .limit(limit);
  return rows.map((row) => row.id);
}
