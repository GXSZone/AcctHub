import { and, asc, eq, sql } from 'drizzle-orm';
import { products, productUpstreamBindings, upstreamSources } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export async function upsertProductUpstreamBindingRepo(
  db: AppDatabase,
  input: {
    productId: number;
    specId: string;
    sourceId: number;
    upstreamItemId: string;
    upstreamSpecId: string;
    fulfillmentMode: string;
    routingStrategy: string;
    priority: number;
    cachedCost: number;
    cachedStock: number;
    isEnabled: number;
    circuitBrokenReason: string;
    overwriteRouting?: boolean;
  }
): Promise<number> {
  const setUpdate = input.overwriteRouting
    ? {
        fulfillmentMode: input.fulfillmentMode,
        routingStrategy: input.routingStrategy,
        priority: input.priority,
        cachedCost: input.cachedCost,
        cachedStock: input.cachedStock,
        isEnabled: input.isEnabled,
        circuitBrokenReason: input.circuitBrokenReason,
        updatedAt: sql`datetime('now')`,
      }
    : {
        cachedCost: input.cachedCost,
        cachedStock: input.cachedStock,
        circuitBrokenReason: input.circuitBrokenReason,
        isEnabled: sql`CASE WHEN ${input.circuitBrokenReason} != '' THEN 0 ELSE ${productUpstreamBindings.isEnabled} END`,
        updatedAt: sql`datetime('now')`,
      };

  const [row] = await db
    .insert(productUpstreamBindings)
    .values({
      productId: input.productId,
      specId: input.specId,
      sourceId: input.sourceId,
      upstreamItemId: input.upstreamItemId,
      upstreamSpecId: input.upstreamSpecId,
      fulfillmentMode: input.fulfillmentMode,
      routingStrategy: input.routingStrategy,
      priority: input.priority,
      cachedCost: input.cachedCost,
      cachedStock: Math.max(0, Math.floor(input.cachedStock)),
      isEnabled: input.isEnabled,
      circuitBrokenReason: input.circuitBrokenReason,
    })
    .onConflictDoUpdate({
      target: [
        productUpstreamBindings.productId,
        productUpstreamBindings.specId,
        productUpstreamBindings.sourceId,
        productUpstreamBindings.upstreamItemId,
        productUpstreamBindings.upstreamSpecId,
      ],
      set: setUpdate,
    })
    .returning({ id: productUpstreamBindings.id });
  return row.id;
}

export async function listBindingsWithMetaRepo(db: AppDatabase, productId?: number) {
  const query = db
    .select({
      binding: productUpstreamBindings,
      sourceName: upstreamSources.name,
      adapterType: upstreamSources.adapterType,
      cachedBalance: upstreamSources.cachedBalance,
      sourceStatus: upstreamSources.status,
      productTitle: products.title,
    })
    .from(productUpstreamBindings)
    .innerJoin(upstreamSources, eq(upstreamSources.id, productUpstreamBindings.sourceId))
    .leftJoin(products, eq(products.id, productUpstreamBindings.productId));

  const rows =
    productId !== undefined
      ? await query
          .where(eq(productUpstreamBindings.productId, productId))
          .orderBy(
            asc(productUpstreamBindings.productId),
            asc(productUpstreamBindings.specId),
            asc(productUpstreamBindings.priority),
            asc(productUpstreamBindings.id)
          )
      : await query.orderBy(
          asc(productUpstreamBindings.productId),
          asc(productUpstreamBindings.specId),
          asc(productUpstreamBindings.priority),
          asc(productUpstreamBindings.id)
        );

  return rows.map(({ binding: b, sourceName, adapterType, cachedBalance, sourceStatus, productTitle }) => ({
    id: b.id,
    product_id: b.productId,
    spec_id: b.specId,
    source_id: b.sourceId,
    upstream_item_id: b.upstreamItemId,
    upstream_spec_id: b.upstreamSpecId,
    fulfillment_mode: b.fulfillmentMode,
    routing_strategy: b.routingStrategy,
    priority: b.priority,
    cached_cost: b.cachedCost,
    cached_stock: b.cachedStock,
    is_enabled: b.isEnabled,
    circuit_broken_reason: b.circuitBrokenReason,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    source_name: sourceName,
    adapter_type: adapterType,
    cached_balance: cachedBalance,
    source_status: sourceStatus,
    product_title: productTitle,
  }));
}

export async function updateBindingByIdRepo(
  db: AppDatabase,
  bindingId: number,
  patch: Partial<typeof productUpstreamBindings.$inferInsert>,
  productId?: number
): Promise<boolean> {
  const rows = await db
    .update(productUpstreamBindings)
    .set({ ...patch, updatedAt: sql`datetime('now')` })
    .where(
      and(
        eq(productUpstreamBindings.id, bindingId),
        productId === undefined ? undefined : eq(productUpstreamBindings.productId, productId)
      )
    )
    .returning({ id: productUpstreamBindings.id });
  return rows.length === 1;
}

export async function deleteBindingByIdRepo(
  db: AppDatabase,
  bindingId: number,
  productId: number
): Promise<boolean> {
  const rows = await db
    .delete(productUpstreamBindings)
    .where(and(eq(productUpstreamBindings.id, bindingId), eq(productUpstreamBindings.productId, productId)))
    .returning({ id: productUpstreamBindings.id });
  return rows.length === 1;
}

export async function listBindingsForSourceWithProductRepo(db: AppDatabase, sourceId: number) {
  return db
    .select({
      binding: productUpstreamBindings,
      productTitle: products.title,
      basePrice: products.basePrice,
      specsJson: products.specsJson,
    })
    .from(productUpstreamBindings)
    .innerJoin(products, eq(products.id, productUpstreamBindings.productId))
    .where(eq(productUpstreamBindings.sourceId, sourceId));
}

export async function decrementBindingCachedStockRepo(
  db: AppDatabase,
  bindingId: number,
  quantity: number
): Promise<void> {
  await db
    .update(productUpstreamBindings)
    .set({
      cachedStock: sql`MAX(0, ${productUpstreamBindings.cachedStock} - ${quantity})`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(productUpstreamBindings.id, bindingId));
}
