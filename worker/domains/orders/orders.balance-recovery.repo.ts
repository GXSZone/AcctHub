import { and, asc, eq, exists, gte, inArray, type SQL, sql } from 'drizzle-orm';
import { coupons, orders, products, walletEvents } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { commitWalletEvent, walletEventKey } from '../account/wallet-event.repo';
import { balanceOrderCouponKey, balanceOrderExpired, orderDebitKey } from './orders.wallet.repo';

export type LocalStockMode = 'cards' | 'manual' | 'seats';

const stockModes = ['cards', 'manual', 'seats'] as const;
const localStockKey = (orderNo: string, mode: LocalStockMode) =>
  walletEventKey('balance-order-stock', orderNo, mode);

export function clearBalanceOrderStock(db: AppDatabase, orderNo: string) {
  return db.delete(walletEvents).where(
    and(
      inArray(walletEvents.eventKey, [
        balanceOrderCouponKey(orderNo),
        ...stockModes.map((mode) => localStockKey(orderNo, mode)),
      ]),
      exists(
        db
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.orderNo, orderNo), sql`${orders.status} <> 'processing'`))
      )
    )
  );
}

export async function readBalanceOrderStock(db: AppDatabase, orderNo: string) {
  const row = await db
    .select({ key: walletEvents.eventKey, endSeat: walletEvents.amount })
    .from(walletEvents)
    .where(
      inArray(
        walletEvents.eventKey,
        stockModes.map((mode) => localStockKey(orderNo, mode))
      )
    )
    .get();
  if (!row) return null;
  const mode = stockModes.find((candidate) => localStockKey(orderNo, candidate) === row.key);
  return mode ? { mode, endSeat: row.endSeat } : null;
}

export async function claimBalanceOrderCoupon(
  db: AppDatabase,
  orderNo: string,
  couponId: number,
  guard: SQL
) {
  const available = and(
    eq(coupons.id, couponId),
    eq(coupons.isActive, 1),
    sql`(${coupons.maxUses} <= 0 OR ${coupons.usedCount} < ${coupons.maxUses})`
  );
  const event = await commitWalletEvent(
    db,
    {
      eventKey: balanceOrderCouponKey(orderNo),
      amount: couponId,
      when: and(guard, exists(db.select({ id: coupons.id }).from(coupons).where(available))),
    },
    (owned) => [
      db
        .update(coupons)
        .set({ usedCount: sql`${coupons.usedCount} + 1` })
        .where(and(available, owned)),
    ]
  );
  return event.amount !== null;
}

/** 销量、座位和手工库存随订单断点提交。恢复使用已分配的结果。 */
export async function postBalanceOrderStock(
  db: AppDatabase,
  orderNo: string,
  input: { productId: number; quantity: number; mode: LocalStockMode; guard: SQL }
): Promise<number | null> {
  const { productId, quantity, mode, guard } = input;
  const stock = and(
    eq(products.id, productId),
    mode === 'manual' ? gte(products.manualStock, quantity) : undefined,
    mode === 'seats' ? sql`${products.seatTotal} - ${products.seatUsed} >= ${quantity}` : undefined
  );
  const endSeat = db
    .select({ n: sql`${products.seatUsed} + ${quantity}` })
    .from(products)
    .where(stock);
  const redeemed = await commitWalletEvent(
    db,
    {
      eventKey: localStockKey(orderNo, mode),
      amount: mode === 'seats' ? sql`(${endSeat})` : 1,
      when: and(guard, exists(db.select({ id: products.id }).from(products).where(stock))),
    },
    (owned) => [
      db
        .update(products)
        .set({
          salesCount: sql`${products.salesCount} + ${quantity}`,
          manualStock: mode === 'manual' ? sql`${products.manualStock} - ${quantity}` : undefined,
          seatUsed: mode === 'seats' ? sql`${products.seatUsed} + ${quantity}` : undefined,
        })
        .where(and(stock, owned)),
    ]
  );
  return redeemed.amount;
}

export function listExpiredBalanceOrders(db: AppDatabase) {
  return db
    .select({ order: orders })
    .from(walletEvents)
    .innerJoin(orders, sql`${walletEvents.eventKey} = json_array('balance-order-debit', ${orders.orderNo})`)
    .where(and(eq(orders.status, 'processing'), balanceOrderExpired))
    .orderBy(asc(walletEvents.createdAt), asc(orders.id))
    .limit(30);
}

export function expiredBalanceOrderGuard(db: AppDatabase, orderNo: string) {
  return sql`${exists(
    db
      .select({ key: walletEvents.eventKey })
      .from(walletEvents)
      .where(and(eq(walletEvents.eventKey, orderDebitKey(orderNo)), balanceOrderExpired))
  )} and ${exists(
    db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.orderNo, orderNo), eq(orders.status, 'processing')))
  )}`;
}
