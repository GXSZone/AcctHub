import { and, asc, eq, exists, inArray, notExists, type SQL, sql } from 'drizzle-orm';
import {
  coupons,
  orders,
  productCards,
  promoTransactions,
  upstreamOrders,
  walletEvents,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import {
  accountCanPost,
  commitWalletEvent,
  promoPosting,
  readWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';

export const orderDebitKey = (orderNo: string) => walletEventKey('balance-order-debit', orderNo);
const orderAbortKey = (orderNo: string) => walletEventKey('order-abort-request', orderNo);
export const balanceOrderCouponKey = (orderNo: string) => walletEventKey('balance-order-coupon', orderNo);
export const balanceOrderExpired = sql`${walletEvents.createdAt} <= datetime('now', '-10 minutes')`;

const processingOrder = (orderNo: string) =>
  and(eq(orders.orderNo, orderNo), eq(orders.status, 'processing'));

export function orderAbortRequested(db: AppDatabase, orderNo: string) {
  return exists(
    db
      .select({ key: walletEvents.eventKey })
      .from(walletEvents)
      .where(eq(walletEvents.eventKey, orderAbortKey(orderNo)))
  );
}

export function balanceOrderActive(db: AppDatabase, orderNo: string) {
  const liveDebit = db
    .select({ key: walletEvents.eventKey })
    .from(walletEvents)
    .where(and(eq(walletEvents.eventKey, orderDebitKey(orderNo)), sql`not (${balanceOrderExpired})`));
  return sql`${exists(liveDebit)} and ${notExists(
    db
      .select({ key: walletEvents.eventKey })
      .from(walletEvents)
      .where(eq(walletEvents.eventKey, orderAbortKey(orderNo)))
  )} and
    ${exists(db.select({ id: orders.id }).from(orders).where(processingOrder(orderNo)))}`;
}

export async function renewBalanceOrder(db: AppDatabase, orderNo: string) {
  const updated = await db
    .update(walletEvents)
    .set({ createdAt: sql`datetime('now')` })
    .where(and(eq(walletEvents.eventKey, orderDebitKey(orderNo)), balanceOrderActive(db, orderNo)))
    .returning({ key: walletEvents.eventKey });
  if (!updated.length) throw Errors.conflict('余额订单已交给后台恢复，请查询原订单');
}

export async function postBalanceOrderDebit(
  db: AppDatabase,
  input: { orderNo: string; userId: number; amount: number; note: string }
) {
  if (input.amount === 0) return true;
  const { orderNo, userId, amount } = input;
  const eventKey = orderDebitKey(orderNo);
  const result = await commitWalletEvent(
    db,
    {
      eventKey,
      amount: -amount,
      when: and(
        accountCanPost(db, userId, -amount),
        exists(
          db
            .select({ id: orders.id })
            .from(orders)
            .where(
              and(
                processingOrder(orderNo),
                eq(orders.userId, userId),
                eq(orders.totalAmount, amount),
                eq(orders.paymentMethod, 'balance')
              )
            )
        ),
        notExists(
          db
            .select({ key: walletEvents.eventKey })
            .from(walletEvents)
            .where(eq(walletEvents.eventKey, orderAbortKey(orderNo)))
        )
      ),
    },
    (owned) => walletPosting(db, owned, { ...input, amount: -amount, type: 'order_pay', refNo: orderNo })
  ).catch(async (error: unknown) => {
    // 本次请求独占订单槽位。若 D1 已提交但回复丢失，继续原请求的履约。
    if ((await readWalletEvent(db, eventKey))?.amount === -amount) return { applied: true };
    throw error;
  });
  return result.applied;
}

/** 保留资金已变动的订单和取消请求，失败的退款批次由后台接续。 */
export async function requestImmediateOrderAbort(
  db: AppDatabase,
  orderNo: string,
  couponId?: number,
  guard?: SQL
) {
  const upstreamAccepted = db
    .select({ id: upstreamOrders.id })
    .from(upstreamOrders)
    .where(
      and(
        eq(upstreamOrders.localOrderNo, orderNo),
        inArray(upstreamOrders.status, ['pending', 'timeout_unknown', 'succeeded', 'orphan'])
      )
    );
  await db
    .insert(walletEvents)
    .select(sql`
    select ${orderAbortKey(orderNo)}, ${crypto.randomUUID()}, ${couponId ?? 0}, datetime('now')
    from ${orders} where ${orders.orderNo} = ${orderNo} and ${orders.status} = 'processing'
    and ${guard ?? sql`1`} and ${notExists(upstreamAccepted)}
    and exists (
      select 1 from ${walletEvents}
      where ${walletEvents.eventKey} = ${orderDebitKey(orderNo)}
        or ${walletEvents.eventKey} = json_array('promo-spend', ${orders.orderNo}, ${orders.userId})
    )
  `)
    .onConflictDoNothing({ target: walletEvents.eventKey });
  return completeImmediateOrderAbort(db, orderNo);
}

export async function completeImmediateOrderAbort(db: AppDatabase, orderNo: string) {
  const requested = await readWalletEvent(db, orderAbortKey(orderNo));
  if (!requested) return false;
  const active = processingOrder(orderNo);
  const order = await db
    .select({ userId: orders.userId, promoUsedAmount: orders.promoUsedAmount })
    .from(orders)
    .where(active)
    .get();
  if (!order?.userId) return false;
  const userId = order.userId;
  const debit = await readWalletEvent(db, orderDebitKey(orderNo));
  const coupon = await readWalletEvent(db, balanceOrderCouponKey(orderNo));
  const cash = -(debit?.amount ?? 0);
  const promo = await db
    .select({
      amount: sql<number>`max(0, min(${order.promoUsedAmount}, round(-coalesce(sum(${promoTransactions.amount}), 0), 2)))`,
    })
    .from(promoTransactions)
    .where(
      and(
        eq(promoTransactions.refNo, orderNo),
        eq(promoTransactions.userId, userId),
        inArray(promoTransactions.type, ['spend', 'refund'])
      )
    )
    .get();
  const promoAmount = promo?.amount ?? 0;
  const result = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('balance-order-abort-refund', orderNo),
      amount: cash,
      when: exists(db.select({ id: orders.id }).from(orders).where(active)),
    },
    (owned) => [
      ...(cash > 0
        ? walletPosting(db, owned, {
            userId,
            amount: cash,
            type: 'refund',
            refNo: orderNo,
            note: `下单失败退回余额（${orderNo}）`,
          })
        : []),
      ...(promoAmount > 0
        ? promoPosting(db, owned, {
            userId,
            amount: promoAmount,
            type: 'refund',
            refNo: orderNo,
            note: `下单失败退回推广金（${orderNo}）`,
          })
        : []),
      ...((coupon?.amount ?? requested.amount) > 0
        ? [
            {
              statement: db
                .update(coupons)
                .set({ usedCount: sql`max(0, ${coupons.usedCount} - 1)` })
                .where(and(eq(coupons.id, coupon?.amount ?? requested.amount), owned)),
              optional: true as const,
            },
          ]
        : []),
      db.update(orders).set({ status: 'refunded' }).where(and(active, owned)),
      {
        statement: db
          .update(productCards)
          .set({ status: 'available', orderNo: null, soldAt: null })
          .where(and(eq(productCards.orderNo, orderNo), eq(productCards.status, 'sold'), owned)),
        optional: true,
      },
      db.delete(walletEvents).where(and(eq(walletEvents.eventKey, orderAbortKey(orderNo)), owned)),
      ...(coupon
        ? [
            db
              .delete(walletEvents)
              .where(and(eq(walletEvents.eventKey, balanceOrderCouponKey(orderNo)), owned)),
          ]
        : []),
    ]
  );
  return result.amount !== null;
}

export async function recoverImmediateOrderAborts(db: AppDatabase) {
  const pending = await db
    .select({ orderNo: orders.orderNo })
    .from(walletEvents)
    .innerJoin(orders, eq(orders.orderNo, sql`json_extract(${walletEvents.eventKey}, '$[1]')`))
    .where(
      and(
        sql`json_extract(${walletEvents.eventKey}, '$[0]') = 'order-abort-request'`,
        eq(orders.status, 'processing')
      )
    )
    .orderBy(asc(orders.id))
    .limit(30);
  for (const { orderNo } of pending) {
    try {
      await completeImmediateOrderAbort(db, orderNo);
    } catch {
      console.warn('订单余额补偿失败，下一轮将重试', { orderNo });
    }
  }
}

export function orderHasWalletActivity(db: AppDatabase, orderNo: string) {
  return exists(
    db
      .select({ key: walletEvents.eventKey })
      .from(walletEvents)
      .where(
        sql`${walletEvents.eventKey} in (${orderDebitKey(orderNo)}, json_array('promo-spend', ${orders.orderNo}, ${orders.userId}))`
      )
  );
}
