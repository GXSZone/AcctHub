import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  agents,
  announcements,
  orders,
  products,
  siteSettings,
  supportTickets,
  ticketMessages,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

/** 加载分站自身公告、直属上级渠道通知与弹窗配置 */
export async function loadAgentNoticeSettingsData(db: AppDatabase, agentId: number, parentAgentId: number) {
  const [myAnnouncements, upstreamNotices] = await Promise.all([
    db
      .select()
      .from(announcements)
      .where(eq(announcements.ownerAgentId, agentId))
      .orderBy(desc(announcements.isPinned), desc(announcements.id)),
    db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.isActive, 1),
          eq(announcements.ownerAgentId, parentAgentId),
          eq(announcements.audience, 'direct_downlines')
        )
      )
      .orderBy(desc(announcements.isPinned), desc(announcements.id))
      .limit(30),
  ]);

  let upstreamSettingsMap: Record<string, string> = {};
  let parentAgentPopupRow: typeof agents.$inferSelect | null = null;
  if (parentAgentId === 0) {
    const sRows = await db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(
        inArray(siteSettings.key, [
          'brand_name',
          'downline_popup_enabled',
          'downline_popup_title',
          'downline_popup_content',
          'downline_popup_frequency',
          'downline_popup_version',
        ])
      );
    upstreamSettingsMap = Object.fromEntries(sRows.map((r) => [r.key, r.value]));
  } else {
    const pRows = await db.select().from(agents).where(eq(agents.id, parentAgentId)).limit(1);
    parentAgentPopupRow = pRows[0] ?? null;
  }

  const mapAnn = (a: typeof announcements.$inferSelect) => ({
    id: a.id,
    owner_agent_id: a.ownerAgentId,
    audience: a.audience,
    title: a.title,
    title_en: a.titleEn,
    content: a.content,
    content_en: a.contentEn,
    translations_json: a.translationsJson,
    level: a.level,
    is_pinned: a.isPinned,
    is_active: a.isActive,
    created_at: a.createdAt,
  });

  return {
    myAnnouncements: myAnnouncements.map(mapAnn),
    upstreamNotices: upstreamNotices.map(mapAnn),
    upstreamSettingsMap,
    parentAgentPopupRow,
  };
}

export async function createAgentAnnouncementRepo(
  db: AppDatabase,
  input: {
    ownerAgentId: number;
    audience: string;
    title: string;
    content: string;
    level: string;
    isPinned: number;
  }
): Promise<number> {
  const [ins] = await db
    .insert(announcements)
    .values({
      ownerAgentId: input.ownerAgentId,
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

export async function updateAgentAnnouncementRepo(
  db: AppDatabase,
  id: number,
  ownerAgentId: number,
  patch: Partial<typeof announcements.$inferInsert>
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(announcements)
    .set(patch)
    .where(and(eq(announcements.id, id), eq(announcements.ownerAgentId, ownerAgentId)));
}

export async function deleteAgentAnnouncementRepo(
  db: AppDatabase,
  id: number,
  ownerAgentId: number
): Promise<void> {
  await db
    .delete(announcements)
    .where(and(eq(announcements.id, id), eq(announcements.ownerAgentId, ownerAgentId)));
}

export async function findAgentOrderWithProductWarranty(db: AppDatabase, orderNo: string, agentId: number) {
  const rows = await db
    .select({
      order: orders,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(and(eq(orders.orderNo, orderNo), eq(orders.agentId, agentId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listAgentTicketsRepo(db: AppDatabase, agentId: number) {
  const rows = await db
    .select({
      ticket: supportTickets,
      messageCount: sql<number>`(SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = ${supportTickets.id})`,
      lastMessageId: sql<number>`COALESCE((SELECT MAX(m.id) FROM ticket_messages m WHERE m.ticket_id = ${supportTickets.id}), 0)`,
      lastSenderRole: sql<string | null>`(
        SELECT m.sender_role FROM ticket_messages m
        WHERE m.ticket_id = ${supportTickets.id} AND m.sender_role <> 'system'
        ORDER BY m.id DESC LIMIT 1
      )`,
    })
    .from(supportTickets)
    .where(eq(supportTickets.siteAgentId, agentId))
    .orderBy(
      sql`CASE WHEN ${supportTickets.status} IN ('open', 'escalated') THEN 0 ELSE 1 END`,
      desc(supportTickets.updatedAt)
    )
    .limit(60);

  return rows.map(({ ticket: t, messageCount, lastMessageId, lastSenderRole }) => ({
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
    message_count: Number(messageCount || 0),
    last_message_id: Number(lastMessageId || 0),
    last_sender_role: lastSenderRole || null,
  }));
}

export async function findAgentTicketByIdRepo(db: AppDatabase, ticketId: number, agentId: number) {
  const rows = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.siteAgentId, agentId)))
    .limit(1);
  const t = rows[0];
  if (!t) return null;
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
  };
}

export async function replyAgentTicketRepo(
  db: AppDatabase,
  ticketId: number,
  senderName: string,
  content: string,
  nextStatus: string
): Promise<void> {
  await db.insert(ticketMessages).values({
    ticketId,
    senderRole: 'agent',
    senderName,
    content,
  });
  await db
    .update(supportTickets)
    .set({ status: nextStatus, updatedAt: sql`datetime('now')` })
    .where(eq(supportTickets.id, ticketId));
}

export async function escalateAgentTicketRepo(
  db: AppDatabase,
  ticketId: number,
  note: string
): Promise<void> {
  await db
    .update(supportTickets)
    .set({ escalatedToAdmin: 1, status: 'escalated', updatedAt: sql`datetime('now')` })
    .where(eq(supportTickets.id, ticketId));
  await db.insert(ticketMessages).values({
    ticketId,
    senderRole: 'system',
    senderName: '系统流转',
    content: note,
  });
}
