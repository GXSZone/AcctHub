import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import { parseMinTopupAmount } from '@shared/domain/payment-plugin-settings';
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  orders,
  paymentPlugins,
  products,
  rechargeCdks,
  supportTickets,
  ticketMessages,
  userLoginLogs,
  users,
  userTotpVault,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

/** 读取后台余额插件配置的正式最低充值金额 (CNY) */
export async function getConfiguredMinTopupAmountRepo(db: AppDatabase): Promise<number> {
  const rows = await db
    .select({ configJson: paymentPlugins.configJson })
    .from(paymentPlugins)
    .where(eq(paymentPlugins.id, 'balance'))
    .limit(1);
  return parseMinTopupAmount(rows[0]?.configJson);
}

/** 汇总会员本月消费、订单总数、进行中工单数与 2FA 条目数 */
export async function loadAccountSummaryStats(db: AppDatabase, userId: number, monthIso: string) {
  const [monthSpendRows, totalOrderRows, openTicketRows, vaultCountRows] = await Promise.all([
    db
      .select({ total: sql<number>`COALESCE(SUM(${orders.totalAmount}), 0)` })
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          inArray(orders.status, RECOGNIZED_ORDER_STATUSES),
          gte(orders.createdAt, monthIso)
        )
      ),
    db.select({ c: sql<number>`count(*)` }).from(orders).where(eq(orders.userId, userId)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(supportTickets)
      .where(
        and(eq(supportTickets.userId, userId), notInArray(supportTickets.status, ['resolved', 'closed']))
      ),
    db.select({ c: sql<number>`count(*)` }).from(userTotpVault).where(eq(userTotpVault.userId, userId)),
  ]);

  return {
    monthlySpend: Number(Number(monthSpendRows[0]?.total ?? 0).toFixed(2)),
    totalOrders: Number(totalOrderRows[0]?.c ?? 0),
    openTickets: Number(openTicketRows[0]?.c ?? 0),
    totpCount: Number(vaultCountRows[0]?.c ?? 0),
  };
}

/** 按 userId 严格隔离查询会员订单列表（关联商品质保字段） */
export async function listMemberOrdersWithWarranty(db: AppDatabase, userId: number, limit: number) {
  return db
    .select({
      order: orders,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.id))
    .limit(limit);
}

/** 按兑换码查询充值 CDK */
export async function findRechargeCdkByCode(db: AppDatabase, code: string) {
  const rows = await db
    .select()
    .from(rechargeCdks)
    .where(sql`upper(${rechargeCdks.code}) = ${code.toUpperCase()}`)
    .limit(1);
  return rows[0] ?? null;
}

/** 查询会员全部工单及每张工单的消息条数 */
export async function listMemberTickets(db: AppDatabase, userId: number) {
  const rows = await db
    .select({
      ticket: supportTickets,
      messageCount: sql<number>`(SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = ${supportTickets.id})`,
    })
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.updatedAt), desc(supportTickets.id))
    .limit(50);

  return rows.map(({ ticket: t, messageCount }) => ({
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
  }));
}

/** 校验工单关联订单归属（严格绑定 user_id 与当前租户站点） */
export async function findMemberOrderForTicket(
  db: AppDatabase,
  orderNo: string,
  userId: number,
  currentSiteAgentId: number
) {
  const siteCond = currentSiteAgentId > 0 ? eq(orders.agentId, currentSiteAgentId) : isNull(orders.agentId);
  const rows = await db
    .select({
      orderNo: orders.orderNo,
      agentId: orders.agentId,
      productTitle: orders.productTitle,
      specName: orders.specName,
      status: orders.status,
      createdAt: orders.createdAt,
      deliveredAt: orders.deliveredAt,
      warrantyType: orders.warrantyType,
      warrantyDays: orders.warrantyDays,
      warrantySummary: orders.warrantySummary,
      prodWarrantyType: products.warrantyType,
      prodWarrantyDays: products.warrantyDays,
      prodWarrantySummary: products.warrantySummary,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(and(eq(orders.orderNo, orderNo), eq(orders.userId, userId), siteCond))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSupportTicketWithFirstMessage(
  db: AppDatabase,
  input: {
    ticketNo: string;
    siteAgentId: number;
    userId: number;
    contactEmail: string;
    orderNo: string;
    category: string;
    subject: string;
    escalatedToAdmin: number;
    senderName: string;
    content: string;
  }
): Promise<number> {
  const [created] = await db
    .insert(supportTickets)
    .values({
      ticketNo: input.ticketNo,
      siteAgentId: input.siteAgentId,
      userId: input.userId,
      contactEmail: input.contactEmail,
      orderNo: input.orderNo,
      category: input.category,
      subject: input.subject,
      status: 'open',
      escalatedToAdmin: input.escalatedToAdmin,
    })
    .returning({ id: supportTickets.id });

  await db.insert(ticketMessages).values({
    ticketId: created.id,
    senderRole: 'user',
    senderName: input.senderName,
    content: input.content,
  });

  return created.id;
}

export async function findMemberTicketById(db: AppDatabase, ticketId: number, userId: number) {
  const rows = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)))
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

export async function listTicketMessages(db: AppDatabase, ticketId: number) {
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

export async function appendMemberTicketReply(
  db: AppDatabase,
  ticketId: number,
  senderName: string,
  content: string
): Promise<void> {
  await db.insert(ticketMessages).values({
    ticketId,
    senderRole: 'user',
    senderName,
    content,
  });
  await db
    .update(supportTickets)
    .set({
      status: sql`CASE WHEN ${supportTickets.status} = 'resolved' THEN 'open' ELSE ${supportTickets.status} END`,
      updatedAt: sql`datetime('now')`,
    })
    .where(eq(supportTickets.id, ticketId));
}

export async function closeMemberTicket(db: AppDatabase, ticketId: number, userId: number): Promise<void> {
  await db
    .update(supportTickets)
    .set({ status: 'closed', updatedAt: sql`datetime('now')` })
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, userId)));
}

export async function listUserLoginLogs(db: AppDatabase, userId: number) {
  const rows = await db
    .select({
      id: userLoginLogs.id,
      ip: userLoginLogs.ip,
      user_agent: userLoginLogs.userAgent,
      created_at: userLoginLogs.createdAt,
    })
    .from(userLoginLogs)
    .where(eq(userLoginLogs.userId, userId))
    .orderBy(desc(userLoginLogs.id))
    .limit(15);
  return rows;
}

export async function updateUserDisplayName(
  db: AppDatabase,
  userId: number,
  displayName: string
): Promise<void> {
  await db.update(users).set({ displayName }).where(eq(users.id, userId));
}

export async function findUserPasswordHash(db: AppDatabase, userId: number): Promise<string | null> {
  const rows = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.passwordHash ?? null;
}

export async function updateUserPasswordHash(
  db: AppDatabase,
  userId: number,
  previousHash: string,
  passwordHash: string
): Promise<boolean> {
  const [updated] = await db
    .update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(and(eq(users.id, userId), eq(users.passwordHash, previousHash)))
    .returning({ id: users.id });
  return Boolean(updated);
}

export async function listUserTotpVaultRecords(db: AppDatabase, userId: number) {
  return db
    .select()
    .from(userTotpVault)
    .where(eq(userTotpVault.userId, userId))
    .orderBy(desc(userTotpVault.id))
    .limit(100);
}

export async function insertUserTotpVaultRecord(
  db: AppDatabase,
  input: {
    userId: number;
    issuer: string;
    accountName: string;
    encryptedSecret: string;
    digits: number;
    period: number;
  }
): Promise<number> {
  const [inserted] = await db.insert(userTotpVault).values(input).returning({ id: userTotpVault.id });
  return inserted.id;
}

export async function deleteUserTotpVaultRecord(db: AppDatabase, id: number, userId: number): Promise<void> {
  await db.delete(userTotpVault).where(and(eq(userTotpVault.id, id), eq(userTotpVault.userId, userId)));
}
