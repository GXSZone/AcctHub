import { and, desc, eq } from 'drizzle-orm';
import { type OutboundWebhookRow, outboundWebhooks } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export async function listOutboundWebhooksRepo(
  db: AppDatabase,
  ownerAgentId = 0
): Promise<OutboundWebhookRow[]> {
  return db
    .select()
    .from(outboundWebhooks)
    .where(eq(outboundWebhooks.ownerAgentId, ownerAgentId))
    .orderBy(desc(outboundWebhooks.id));
}

export async function listEnabledOutboundWebhooksRepo(
  db: AppDatabase,
  ownerAgentId = 0
): Promise<OutboundWebhookRow[]> {
  return db
    .select()
    .from(outboundWebhooks)
    .where(and(eq(outboundWebhooks.ownerAgentId, ownerAgentId), eq(outboundWebhooks.enabled, 1)))
    .orderBy(desc(outboundWebhooks.id));
}

export async function findOutboundWebhookByIdRepo(
  db: AppDatabase,
  id: number,
  ownerAgentId = 0
): Promise<OutboundWebhookRow | null> {
  const rows = await db
    .select()
    .from(outboundWebhooks)
    .where(and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.ownerAgentId, ownerAgentId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createOutboundWebhookRepo(
  db: AppDatabase,
  row: typeof outboundWebhooks.$inferInsert
): Promise<OutboundWebhookRow> {
  const [created] = await db.insert(outboundWebhooks).values(row).returning();
  return created;
}

export async function updateOutboundWebhookRepo(
  db: AppDatabase,
  id: number,
  ownerAgentId: number,
  patch: Partial<typeof outboundWebhooks.$inferInsert>
): Promise<OutboundWebhookRow | null> {
  const rows = await db
    .update(outboundWebhooks)
    .set(patch)
    .where(and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.ownerAgentId, ownerAgentId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteOutboundWebhookRepo(
  db: AppDatabase,
  id: number,
  ownerAgentId: number
): Promise<boolean> {
  const rows = await db
    .delete(outboundWebhooks)
    .where(and(eq(outboundWebhooks.id, id), eq(outboundWebhooks.ownerAgentId, ownerAgentId)))
    .returning({ id: outboundWebhooks.id });
  return rows.length > 0;
}

export async function recordWebhookDeliveryResultRepo(
  db: AppDatabase,
  id: number,
  status: number,
  error: string
): Promise<void> {
  await db
    .update(outboundWebhooks)
    .set({
      lastStatus: status,
      lastError: error.slice(0, 300),
      lastTriggeredAt: new Date().toISOString(),
    })
    .where(eq(outboundWebhooks.id, id));
}
