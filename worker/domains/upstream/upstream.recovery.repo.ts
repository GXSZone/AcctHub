import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  agents,
  productCards,
  products,
  productUpstreamBindings,
  siteSettings,
  supportTickets,
  upstreamOrders,
  upstreamSources,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { encryptSecret } from '../../infra/crypto';
import { type AppDatabase, createDb } from '../../infra/db';
import { prepareInventoryCredentials } from '../catalog/inventory-credentials.repo';

export async function createUpstreamLocalProductRepo(
  db: AppDatabase,
  values: typeof products.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(products).values(values).returning({ id: products.id });
  return ins.id;
}

export async function countHealthyBackupSuppliesRepo(db: AppDatabase, productId: number): Promise<boolean> {
  const [bindingRows, cardRows] = await Promise.all([
    db
      .select({ c: sql<number>`count(*)` })
      .from(productUpstreamBindings)
      .innerJoin(upstreamSources, eq(upstreamSources.id, productUpstreamBindings.sourceId))
      .where(
        and(
          eq(productUpstreamBindings.productId, productId),
          eq(productUpstreamBindings.isEnabled, 1),
          eq(productUpstreamBindings.circuitBrokenReason, ''),
          sql`${productUpstreamBindings.cachedStock} > 0`,
          eq(upstreamSources.status, 'active')
        )
      ),
    db
      .select({ c: sql<number>`count(*)` })
      .from(productCards)
      .where(and(eq(productCards.productId, productId), eq(productCards.status, 'available'))),
  ]);
  return Number(bindingRows[0]?.c || 0) > 0 || Number(cardRows[0]?.c || 0) > 0;
}

export async function updateLocalProductFromUpstreamRepo(
  db: AppDatabase,
  productId: number,
  patch: Partial<typeof products.$inferInsert>
): Promise<void> {
  await db
    .update(products)
    .set({ ...patch, updatedAt: sql`datetime('now')` })
    .where(eq(products.id, productId));
}

export async function completeRestockPurchaseRepo(
  env: Env,
  input: {
    purchaseId: number;
    productId: number;
    specId: string;
    cards: string[];
    upstreamOrderNo: string;
    actualCost: number;
    rawResponseJson?: string;
    simulated?: boolean;
  }
) {
  const { purchaseId, productId, specId, cards, upstreamOrderNo, actualCost } = input;
  const { rows, rejectedSamples, totalReal } = await prepareInventoryCredentials(
    env,
    productId,
    input.simulated ? [] : cards
  );
  const reject = input.simulated || rejectedSamples > 0 || totalReal === 0;
  const status = reject ? 'orphan' : 'succeeded';
  const note = reject ? '预拉货源返回模拟、样例或空凭证，已拒绝入库' : '';
  const [cardsJson, rawResponseJson] = await Promise.all([
    encryptSecret(env, JSON.stringify(cards), `upstream-cards:${purchaseId}`),
    input.rawResponseJson === undefined
      ? undefined
      : encryptSecret(env, input.rawResponseJson, `upstream-response:${purchaseId}`),
  ]);
  const db = createDb(env.DB);
  const claim = and(
    eq(upstreamOrders.id, purchaseId),
    eq(upstreamOrders.purpose, 'restock_pull'),
    inArray(upstreamOrders.status, ['pending', 'timeout_unknown'])
  );
  const update = db
    .update(upstreamOrders)
    .set({
      status,
      upstreamOrderNo,
      upstreamCost: actualCost,
      errorMessage: note,
      cardsJson,
      rawResponseJson,
      updatedAt: sql`datetime('now')`,
    })
    .where(claim);
  const insert = db
    .insert(productCards)
    .select(sql`
    SELECT NULL, 0, ${productId}, ${specId}, json_extract(item.value, '$.content'),
      json_extract(item.value, '$.fingerprint'), ${purchaseId}, 'available', NULL, datetime('now'), NULL, 0, '', 0
    FROM json_each(${JSON.stringify(rows)}) AS item
    WHERE EXISTS (SELECT 1 FROM ${upstreamOrders} WHERE ${claim})
  `)
    .onConflictDoNothing({ target: [productCards.productId, productCards.credentialFingerprint] });
  const results = await (reject ? db.batch([update]) : db.batch([insert, update]));
  const imported = reject ? 0 : Number(results[0]?.meta.changes || 0);
  const [settled] = await db
    .select({ status: upstreamOrders.status })
    .from(upstreamOrders)
    .where(eq(upstreamOrders.id, purchaseId))
    .limit(1);
  return {
    status: settled?.status === 'succeeded' ? ('succeeded' as const) : ('orphan' as const),
    imported,
    note,
  };
}

export async function resolveOrderBrandNameRepo(db: AppDatabase, ownerAgentId: number): Promise<string> {
  if (ownerAgentId > 0) {
    const rows = await db
      .select({ brandName: agents.brandName })
      .from(agents)
      .where(eq(agents.id, ownerAgentId))
      .limit(1);
    return rows[0]?.brandName || 'AcctHub';
  }
  const rows = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'brand_name'))
    .limit(1);
  return rows[0]?.value || 'AcctHub';
}

export async function findSupportTicketByIdRepo(db: AppDatabase, ticketId: number) {
  const rows = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
  return rows[0] ?? null;
}
