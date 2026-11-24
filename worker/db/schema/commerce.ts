import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 拼团合租场次表 */
export const groupBuySessions = sqliteTable(
  'group_buy_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    productId: integer('product_id').notNull(),
    specId: text('spec_id').notNull().default('default'),
    leaderUserId: integer('leader_user_id').notNull(),
    leaderName: text('leader_name').notNull().default(''),
    requiredSize: integer('required_size').notNull().default(2),
    currentSize: integer('current_size').notNull().default(0),
    groupPrice: real('group_price').notNull(),
    status: text('status').notNull().default('open'),
    expiresAt: text('expires_at').notNull(),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_group_buy_sessions_code').on(t.code),
    index('idx_group_buy_sessions_prod_status').on(t.siteAgentId, t.productId, t.status, t.expiresAt),
    index('idx_group_buy_sessions_expiry').on(t.status, t.expiresAt),
  ]
);

/** 拼团合租成员参团记录表 */
export const groupBuyMembers = sqliteTable(
  'group_buy_members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id').notNull(),
    userId: integer('user_id').notNull(),
    orderNo: text('order_no').notNull(),
    email: text('email').notNull().default(''),
    paidAmount: real('paid_amount').notNull().default(0),
    promoUsedAmount: real('promo_used_amount').notNull().default(0),
    status: text('status').notNull().default('paid'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_group_buy_members_order').on(t.orderNo),
    uniqueIndex('uq_group_buy_members_session_user').on(t.sessionId, t.userId),
    index('idx_group_buy_members_session_status').on(t.sessionId, t.status),
  ]
);

export type GroupBuySessionRow = typeof groupBuySessions.$inferSelect;
export type GroupBuyMemberRow = typeof groupBuyMembers.$inferSelect;
