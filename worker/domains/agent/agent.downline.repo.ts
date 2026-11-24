import { and, desc, eq, sql } from 'drizzle-orm';
import { agents, agentTiers, agentWithdrawals } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { mapWithdrawalRow } from './agent.repo';

export async function createDownlineTierRepo(
  db: AppDatabase,
  input: {
    ownerAgentId: number;
    code: string;
    name: string;
    levelRank: number;
    minRecharge: number;
    discountRate: number;
    badgeColor: string;
    perksJson: string;
  }
): Promise<number> {
  const [ins] = await db
    .insert(agentTiers)
    .values({
      ownerAgentId: input.ownerAgentId,
      code: input.code,
      name: input.name,
      levelRank: input.levelRank,
      minRecharge: input.minRecharge,
      discountRate: input.discountRate,
      commissionRate: 0,
      subOverrideRate: 0,
      maxSubAgents: 999,
      badgeColor: input.badgeColor,
      perksJson: input.perksJson,
    })
    .returning({ id: agentTiers.id });
  return ins.id;
}

export async function updateDownlineTierRepo(
  db: AppDatabase,
  tierId: number,
  ownerAgentId: number,
  patch: Partial<typeof agentTiers.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(agentTiers)
    .set(patch)
    .where(and(eq(agentTiers.id, tierId), eq(agentTiers.ownerAgentId, ownerAgentId)));
}

export async function countDownlinesUsingTier(
  db: AppDatabase,
  parentAgentId: number,
  tierId: number
): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(agents)
    .where(and(eq(agents.parentAgentId, parentAgentId), eq(agents.tierId, tierId)));
  return Number(rows[0]?.c ?? 0);
}

export async function deleteDownlineTierRepo(
  db: AppDatabase,
  tierId: number,
  ownerAgentId: number
): Promise<void> {
  await db
    .delete(agentTiers)
    .where(and(eq(agentTiers.id, tierId), eq(agentTiers.ownerAgentId, ownerAgentId)));
}

export async function findDirectDownlineAgent(
  db: AppDatabase,
  downlineId: number,
  parentAgentId: number
): Promise<number | null> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, downlineId), eq(agents.parentAgentId, parentAgentId)))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function updateDirectDownlineRepo(
  db: AppDatabase,
  downlineId: number,
  parentAgentId: number,
  patch: { tierId?: number; status?: string }
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(agents)
    .set(patch)
    .where(and(eq(agents.id, downlineId), eq(agents.parentAgentId, parentAgentId)));
}

export async function listAgentWithdrawalsRepo(db: AppDatabase, agentId: number) {
  const rows = await db
    .select()
    .from(agentWithdrawals)
    .where(eq(agentWithdrawals.agentId, agentId))
    .orderBy(desc(agentWithdrawals.id))
    .limit(50);
  return rows.map(mapWithdrawalRow);
}

export async function createAgentWithdrawalRepo(
  db: AppDatabase,
  input: {
    agentId: number;
    userId: number;
    amount: number;
    channel: string;
    accountInfo: string;
    accountName: string;
  }
): Promise<number> {
  const [ins] = await db
    .insert(agentWithdrawals)
    .values({ ...input, status: 'pending' })
    .returning({ id: agentWithdrawals.id });
  return ins.id;
}
