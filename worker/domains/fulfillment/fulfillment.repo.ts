import { and, asc, eq, gte, inArray, type SQL, sql } from 'drizzle-orm';
import { paymentIntents, productCards, products } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

/** 统计指定商品与规格的本地可用卡密数（严格按卡密归属租户隔离；存在循环卡密时返回无限充足库存 999） */
export async function countAvailableCardsForSpec(
  db: AppDatabase,
  productId: number,
  specId: string,
  ownerAgentId = 0
): Promise<number> {
  const rows = await db
    .select({
      c: sql<number>`count(*)`,
      hasLoop: sql<number>`MAX(CASE WHEN ${productCards.isLoop} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(productCards)
    .where(
      and(
        eq(productCards.ownerAgentId, ownerAgentId),
        eq(productCards.productId, productId),
        eq(productCards.specId, specId),
        eq(productCards.status, 'available')
      )
    );
  const count = Number(rows[0]?.c ?? 0);
  const hasLoop = Number(rows[0]?.hasLoop ?? 0) === 1;
  return hasLoop && count > 0 ? Math.max(count, 999) : count;
}

/** 原子扣减商品手动库存并累加销量 */
export async function decrementManualStockAtomic(
  db: AppDatabase,
  productId: number,
  quantity: number,
  guard?: SQL
): Promise<boolean> {
  const updated = await db
    .update(products)
    .set({
      manualStock: sql`${products.manualStock} - ${quantity}`,
      salesCount: sql`${products.salesCount} + ${quantity}`,
    })
    .where(and(eq(products.id, productId), gte(products.manualStock, quantity), guard))
    .returning({ id: products.id });
  return updated.length === 1;
}

/** 累加商品销量计数 */
export async function incrementProductSalesCount(
  db: AppDatabase,
  productId: number,
  quantity: number,
  guard?: SQL
): Promise<void> {
  await db
    .update(products)
    .set({ salesCount: sql`${products.salesCount} + ${quantity}` })
    .where(and(eq(products.id, productId), guard));
}

/** 原子占位拼车席位并返回累加后的准确结束席位号（防并发分配相同席位号） */
export async function claimSeatsAtomic(
  db: AppDatabase,
  productId: number,
  quantity: number,
  guard?: SQL
): Promise<number | null> {
  const updated = await db
    .update(products)
    .set({
      seatUsed: sql`${products.seatUsed} + ${quantity}`,
      salesCount: sql`${products.salesCount} + ${quantity}`,
    })
    .where(
      and(
        eq(products.id, productId),
        sql`(${products.seatTotal} - ${products.seatUsed}) >= ${quantity}`,
        guard
      )
    )
    .returning({ seatUsed: products.seatUsed });
  return updated[0] ? Number(updated[0].seatUsed) : null;
}

/** 将在线付款的库存变更与恢复所需的结果放进同一批次。 */
export async function postPaidOrderStock(
  db: AppDatabase,
  input: {
    intentNo: string;
    productId: number;
    quantity: number;
    mode: 'cards' | 'seats' | 'manual';
    guard: SQL;
  }
): Promise<number | null> {
  const { intentNo, productId, quantity, mode, guard } = input;
  const intent = eq(paymentIntents.intentNo, intentNo);
  const checkpoint = sql<number>`json_extract(${paymentIntents.payloadJson}, '$.fulfill_local_stock')`;
  const checkpointQuery = db.select({ result: checkpoint }).from(paymentIntents).where(intent);
  const stock = db
    .update(products)
    .set({
      salesCount: sql`${products.salesCount} + ${quantity}`,
      manualStock: mode === 'manual' ? sql`${products.manualStock} - ${quantity}` : undefined,
      seatUsed: mode === 'seats' ? sql`${products.seatUsed} + ${quantity}` : undefined,
    })
    .where(
      and(
        eq(products.id, productId),
        mode === 'manual' ? gte(products.manualStock, quantity) : undefined,
        mode === 'seats' ? sql`${products.seatTotal} - ${products.seatUsed} >= ${quantity}` : undefined,
        guard,
        sql`(${checkpointQuery}) IS NULL`
      )
    );
  const endSeat = db.select({ result: products.seatUsed }).from(products).where(eq(products.id, productId));
  const remember = db
    .update(paymentIntents)
    .set({
      payloadJson: sql`json_set(${paymentIntents.payloadJson}, '$.fulfill_local_stock', ${mode === 'seats' ? sql`(${endSeat})` : 1})`,
    })
    .where(and(intent, sql`changes() = 1`));
  const [, , result] = await db.batch([
    stock,
    remember,
    db.select({ result: checkpoint }).from(paymentIntents).where(and(intent, guard)),
  ]);
  return result[0]?.result ?? null;
}

/** 查询待认领的候选可用卡密列表（严格按卡密归属租户隔离，非循环卡密优先，循环卡密可反复发卡） */
export async function listCandidateAvailableCards(
  db: AppDatabase,
  productId: number,
  specId: string,
  limit: number,
  ownerAgentId = 0
): Promise<Array<{ id: number; cardContent: string; isLoop: number }>> {
  return db
    .select({ id: productCards.id, cardContent: productCards.cardContent, isLoop: productCards.isLoop })
    .from(productCards)
    .where(
      and(
        eq(productCards.ownerAgentId, ownerAgentId),
        eq(productCards.productId, productId),
        eq(productCards.specId, specId),
        eq(productCards.status, 'available')
      )
    )
    .orderBy(asc(productCards.isLoop), asc(productCards.id))
    .limit(limit);
}

/** CAS 原子认领单张卡密 */
export async function claimSingleCardAtomic(
  db: AppDatabase,
  cardId: number,
  orderNo: string,
  guard?: SQL
): Promise<boolean> {
  const updated = await db
    .update(productCards)
    .set({
      status: 'sold',
      orderNo,
      soldAt: sql`datetime('now')`,
    })
    .where(and(eq(productCards.id, cardId), eq(productCards.status, 'available'), guard))
    .returning({ id: productCards.id });
  return updated.length === 1;
}

/** 并发不足时原子回滚本次订单已认领的部分卡密 */
export async function releaseClaimedCards(
  db: AppDatabase,
  cardIds: number[],
  orderNo: string,
  guard?: SQL
): Promise<void> {
  if (cardIds.length === 0) return;
  await db
    .update(productCards)
    .set({ status: 'available', orderNo: null, soldAt: null })
    .where(and(inArray(productCards.id, cardIds), eq(productCards.orderNo, orderNo), guard));
}
