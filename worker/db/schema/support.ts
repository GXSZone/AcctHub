import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 售后工单主表 */
export const supportTickets = sqliteTable(
  'support_tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketNo: text('ticket_no').notNull().unique(),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    userId: integer('user_id'),
    contactEmail: text('contact_email').notNull(),
    orderNo: text('order_no').notNull().default(''),
    category: text('category').notNull().default('after_sale'),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    escalatedToAdmin: integer('escalated_to_admin').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_tickets_site_status').on(t.siteAgentId, t.status),
    index('idx_tickets_order').on(t.orderNo),
  ]
);

/** 工单多轮对话消息表 */
export const ticketMessages = sqliteTable(
  'ticket_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ticketId: integer('ticket_id').notNull(),
    senderRole: text('sender_role').notNull().default('user'),
    senderName: text('sender_name').notNull().default(''),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_ticket_msgs_ticket').on(t.ticketId)]
);

/** 会员加密 2FA TOTP 凭证保险箱表 */
export const userTotpVault = sqliteTable(
  'user_totp_vault',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    issuer: text('issuer').notNull().default(''),
    accountName: text('account_name').notNull().default(''),
    encryptedSecret: text('encrypted_secret').notNull(),
    digits: integer('digits').notNull().default(6),
    period: integer('period').notNull().default(30),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_totp_user').on(t.userId)]
);

export type SupportTicketRow = typeof supportTickets.$inferSelect;
