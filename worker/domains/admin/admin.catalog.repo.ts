import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  agentProductOverrides,
  agentProductPrices,
  categories,
  categoryGroups,
  orders,
  productCards,
  products,
  productUpstreamBindings,
  restockSubscriptions,
  siteSettings,
  upstreamItems,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export async function upsertSiteSettingRepo(db: AppDatabase, key: string, value: string): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedAt: sql`datetime('now')` },
    });
}
export async function createCategoryGroupRepo(
  db: AppDatabase,
  input: { slug: string; name: string; nameEn: string; sortOrder: number }
): Promise<number> {
  const [ins] = await db.insert(categoryGroups).values(input).returning({ id: categoryGroups.id });
  return ins.id;
}

export async function reorderCategoryGroupsRepo(db: AppDatabase, orderedIds: number[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(categoryGroups)
      .set({ sortOrder: i + 1 })
      .where(eq(categoryGroups.id, orderedIds[i]));
  }
}

export async function updateCategoryGroupRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof categoryGroups.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(categoryGroups).set(patch).where(eq(categoryGroups.id, id));
}

export async function countCategoriesInGroupRepo(db: AppDatabase, groupId: number): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(categories)
    .where(eq(categories.groupId, groupId));
  return Number(rows[0]?.c || 0);
}

export async function deleteCategoryGroupRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(categoryGroups).where(eq(categoryGroups.id, id));
}

export async function createCategoryRepo(
  db: AppDatabase,
  values: typeof categories.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(categories).values(values).returning({ id: categories.id });
  return ins.id;
}

export async function reorderCategoriesRepo(db: AppDatabase, orderedIds: number[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(categories)
      .set({ sortOrder: i + 1 })
      .where(eq(categories.id, orderedIds[i]));
  }
}

export async function updateCategoryRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof categories.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(categories).set(patch).where(eq(categories.id, id));
}

export async function countProductsInCategoryRepo(db: AppDatabase, categoryId: number): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.categoryId, categoryId));
  return Number(rows[0]?.c || 0);
}

export async function deleteCategoryRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

export async function createProductRepo(
  db: AppDatabase,
  values: typeof products.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(products).values(values).returning({ id: products.id });
  return ins.id;
}

export async function updateProductRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof products.$inferInsert>
): Promise<void> {
  await db
    .update(products)
    .set({ ...patch, updatedAt: sql`datetime('now')` })
    .where(eq(products.id, id));
}

/** 删品前先固化该商品下所有历史订单质保快照，再级联清理可用卡密/绑定/定制价/订阅并删除商品 */
export async function deleteProductWithWarrantySnapshotRepo(
  db: AppDatabase,
  productId: number,
  warrantySnapshot?: { type: string; days: number; summary: string }
): Promise<void> {
  if (warrantySnapshot) {
    await db
      .update(orders)
      .set({
        warrantyType: sql`COALESCE(NULLIF(${orders.warrantyType}, ''), ${warrantySnapshot.type})`,
        warrantyDays: sql`COALESCE(${orders.warrantyDays}, ${warrantySnapshot.days})`,
        warrantySummary: sql`COALESCE(NULLIF(${orders.warrantySummary}, ''), ${warrantySnapshot.summary})`,
      })
      .where(eq(orders.productId, productId));
  }

  await Promise.all([
    db
      .delete(productCards)
      .where(and(eq(productCards.productId, productId), eq(productCards.status, 'available'))),
    db.delete(productUpstreamBindings).where(eq(productUpstreamBindings.productId, productId)),
    db.delete(agentProductPrices).where(eq(agentProductPrices.productId, productId)),
    db.delete(agentProductOverrides).where(eq(agentProductOverrides.productId, productId)),
    db.delete(restockSubscriptions).where(eq(restockSubscriptions.productId, productId)),
    db.update(upstreamItems).set({ localProductId: null }).where(eq(upstreamItems.localProductId, productId)),
  ]);
  await db.delete(products).where(eq(products.id, productId));
}

export async function listProductCardsRepo(db: AppDatabase, productId: number) {
  const rows = await db
    .select()
    .from(productCards)
    .where(eq(productCards.productId, productId))
    .orderBy(asc(productCards.status), desc(productCards.id))
    .limit(200);
  return rows.map((c) => ({
    id: c.id,
    product_id: c.productId,
    spec_id: c.specId,
    card_content: c.cardContent,
    status: c.status,
    is_loop: Number(c.isLoop || 0),
    order_no: c.orderNo,
    sold_at: c.soldAt,
    created_at: c.createdAt,
  }));
}

export async function deleteProductCardRepo(db: AppDatabase, cardId: number): Promise<void> {
  await db.delete(productCards).where(eq(productCards.id, cardId));
}
