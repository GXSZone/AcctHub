import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  agents,
  agentTiers,
  agentWithdrawals,
  announcements,
  coupons,
  helpArticles,
  paymentPlugins,
  rechargeCdks,
  supportTickets,
  ticketMessages,
  users,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export async function createMainAnnouncementRepo(
  db: AppDatabase,
  input: { audience: string; title: string; content: string; level: string; isPinned: number }
): Promise<number> {
  const [ins] = await db
    .insert(announcements)
    .values({
      ownerAgentId: 0,
      audience: input.audience,
      title: input.title,
      titleEn: input.title,
      content: input.content,
      contentEn: input.content,
      level: input.level,
      isPinned: input.isPinned,
    })
    .returning({ id: announcements.id });
  return ins.id;
}

export async function updateMainAnnouncementRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof announcements.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(announcements)
    .set(patch)
    .where(and(eq(announcements.id, id), eq(announcements.ownerAgentId, 0)));
}

export async function deleteMainAnnouncementRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(announcements).where(and(eq(announcements.id, id), eq(announcements.ownerAgentId, 0)));
}

export async function createHelpArticleRepo(
  db: AppDatabase,
  input: { category: string; title: string; content: string; sortOrder: number }
): Promise<number> {
  const [ins] = await db
    .insert(helpArticles)
    .values({
      category: input.category,
      title: input.title,
      titleEn: input.title,
      content: input.content,
      contentEn: input.content,
      sortOrder: input.sortOrder,
    })
    .returning({ id: helpArticles.id });
  return ins.id;
}

export async function updateHelpArticleRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof helpArticles.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(helpArticles).set(patch).where(eq(helpArticles.id, id));
}

export async function deleteHelpArticleRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(helpArticles).where(eq(helpArticles.id, id));
}

export async function updateAgentAndCascadeFloorRepo(
  db: AppDatabase,
  agentId: number,
  patch: Partial<typeof agents.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length > 0) {
    await db.update(agents).set(patch).where(eq(agents.id, agentId));
  }
  if (patch.tierId !== undefined && patch.tierId !== null) {
    const [tRows, agentRows] = await Promise.all([
      db
        .select({ discountRate: agentTiers.discountRate, minRecharge: agentTiers.minRecharge })
        .from(agentTiers)
        .where(eq(agentTiers.id, patch.tierId))
        .limit(1),
      db.select({ userId: agents.userId }).from(agents).where(eq(agents.id, agentId)).limit(1),
    ]);
    const tRow = tRows[0];
    const userId = agentRows[0]?.userId;
    if (tRow) {
      if (userId && Number.isFinite(Number(tRow.minRecharge))) {
        // 管理员手动调整代理等级时，同步将累计升级费对齐至新等级门槛，确保后续补差升级金额准确
        await db
          .update(users)
          .set({ totalRecharged: Number(Number(tRow.minRecharge).toFixed(2)) })
          .where(eq(users.id, userId));
      }
      if (Number.isFinite(Number(tRow.discountRate))) {
        const floorRate = Number(Number(tRow.discountRate).toFixed(2));
        await db
          .update(agentTiers)
          .set({ discountRate: floorRate })
          .where(and(eq(agentTiers.ownerAgentId, agentId), lt(agentTiers.discountRate, floorRate)));
      }
    }
  }
}

export async function createMainAgentTierRepo(
  db: AppDatabase,
  values: typeof agentTiers.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(agentTiers).values(values).returning({ id: agentTiers.id });
  return ins.id;
}

export async function updateMainAgentTierAndCascadeRepo(
  db: AppDatabase,
  tierId: number,
  patch: Partial<typeof agentTiers.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length > 0) {
    await db
      .update(agentTiers)
      .set(patch)
      .where(and(eq(agentTiers.id, tierId), eq(agentTiers.ownerAgentId, 0)));
  }
  if (patch.discountRate !== undefined && Number.isFinite(Number(patch.discountRate))) {
    const floorRate = Number(Number(patch.discountRate).toFixed(2));
    const boundAgents = await db.select({ id: agents.id }).from(agents).where(eq(agents.tierId, tierId));
    const agentIds = boundAgents.map((a) => a.id);
    if (agentIds.length > 0) {
      await db
        .update(agentTiers)
        .set({ discountRate: floorRate })
        .where(and(inArray(agentTiers.ownerAgentId, agentIds), lt(agentTiers.discountRate, floorRate)));
    }
  }
}

export async function countAgentsUsingTierRepo(db: AppDatabase, tierId: number): Promise<number> {
  const rows = await db.select({ c: sql<number>`count(*)` }).from(agents).where(eq(agents.tierId, tierId));
  return Number(rows[0]?.c || 0);
}

export async function deleteMainAgentTierRepo(db: AppDatabase, tierId: number): Promise<void> {
  await db.delete(agentTiers).where(and(eq(agentTiers.id, tierId), eq(agentTiers.ownerAgentId, 0)));
}

export async function findWithdrawalByIdRepo(db: AppDatabase, id: number) {
  const rows = await db.select().from(agentWithdrawals).where(eq(agentWithdrawals.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function lockWithdrawalProcessedCasRepo(
  db: AppDatabase,
  id: number,
  nextStatus: 'paid' | 'rejected',
  adminNote: string
): Promise<boolean> {
  const updated = await db
    .update(agentWithdrawals)
    .set({ status: nextStatus, adminNote, processedAt: sql`datetime('now')` })
    .where(and(eq(agentWithdrawals.id, id), eq(agentWithdrawals.status, 'pending')))
    .returning({ id: agentWithdrawals.id });
  return updated.length === 1;
}

export async function createCouponRepo(
  db: AppDatabase,
  values: typeof coupons.$inferInsert
): Promise<number> {
  const [ins] = await db.insert(coupons).values(values).returning({ id: coupons.id });
  return ins.id;
}

export async function updateCouponActiveRepo(db: AppDatabase, id: number, isActive?: number): Promise<void> {
  if (isActive === undefined) return;
  await db.update(coupons).set({ isActive }).where(eq(coupons.id, id));
}

export async function deleteCouponRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(coupons).where(eq(coupons.id, id));
}

export async function insertRechargeCdksRepo(
  db: AppDatabase,
  rows: Array<{ code: string; amount: number; batchNote: string }>
): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(rechargeCdks)
    .values(
      rows.map((r) => ({ code: r.code, amount: r.amount, status: 'available', batchNote: r.batchNote }))
    )
    .onConflictDoNothing();
}

export async function deleteAvailableCdkRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(rechargeCdks).where(and(eq(rechargeCdks.id, id), eq(rechargeCdks.status, 'available')));
}

export async function findAdminTicketByIdRepo(db: AppDatabase, id: number) {
  const rows = await db
    .select({
      ticket: supportTickets,
      siteSlug: agents.slug,
      siteBrand: agents.brandName,
    })
    .from(supportTickets)
    .leftJoin(agents, eq(agents.id, supportTickets.siteAgentId))
    .where(eq(supportTickets.id, id))
    .limit(1);
  if (!rows[0]) return null;
  const { ticket: t, siteSlug, siteBrand } = rows[0];
  return {
    id: t.id,
    ticket_no: t.ticketNo,
    site_agent_id: t.siteAgentId,
    user_id: t.userId,
    contact_email: t.contactEmail,
    order_no: t.orderNo,
    category: t.category,
    subject: t.subject,
    status: t.status,
    escalated_to_admin: t.escalatedToAdmin,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    site_slug: siteSlug,
    site_brand: siteBrand,
  };
}

export async function listAdminTicketMessagesRepo(db: AppDatabase, ticketId: number) {
  const rows = await db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.id));
  return rows.map((m) => ({
    id: m.id,
    ticket_id: m.ticketId,
    sender_role: m.senderRole,
    sender_name: m.senderName,
    content: m.content,
    created_at: m.createdAt,
  }));
}

export async function replyAdminTicketRepo(
  db: AppDatabase,
  ticketId: number,
  content: string,
  nextStatus: string
): Promise<void> {
  await db.insert(ticketMessages).values({
    ticketId,
    senderRole: 'admin',
    senderName: '平台总控客服',
    content,
  });
  await db
    .update(supportTickets)
    .set({ status: nextStatus, updatedAt: sql`datetime('now')` })
    .where(eq(supportTickets.id, ticketId));
}

export async function updateAdminTicketStatusRepo(
  db: AppDatabase,
  ticketId: number,
  status: string
): Promise<void> {
  await db
    .update(supportTickets)
    .set({ status, updatedAt: sql`datetime('now')` })
    .where(eq(supportTickets.id, ticketId));
}

export async function updatePaymentPluginRepo(
  db: AppDatabase,
  id: string,
  patch: { enabled?: number; configJson?: string }
): Promise<void> {
  if (patch.enabled === undefined && patch.configJson === undefined) return;
  await db
    .update(paymentPlugins)
    .set({
      enabled: patch.enabled,
      configJson:
        patch.configJson === undefined
          ? undefined
          : sql`json_patch(CASE WHEN json_valid(${paymentPlugins.configJson}) THEN ${paymentPlugins.configJson} ELSE '{}' END, ${patch.configJson})`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(paymentPlugins.id, id));
}
