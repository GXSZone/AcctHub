import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 全站 IP / CIDR 黑名单表 */
export const ipBlacklist = sqliteTable(
  'ip_blacklist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ipPattern: text('ip_pattern').notNull(),
    reason: text('reason').notNull().default(''),
    createdBy: text('created_by').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [uniqueIndex('uq_ip_blacklist_pattern').on(t.ipPattern)]
);

/** 不可变风控熔断事件与 3 封紧急邮件告警台账 */
export const riskEvents = sqliteTable(
  'risk_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventType: text('event_type').notNull(),
    severity: text('severity').notNull().default('critical'),
    orderNo: text('order_no').notNull().default(''),
    buyerIp: text('buyer_ip').notNull().default(''),
    contactEmail: text('contact_email').notNull().default(''),
    summary: text('summary').notNull(),
    detailJson: text('detail_json').notNull().default('{}'),
    mailAlertCount: integer('mail_alert_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_risk_events_type_time').on(t.eventType, t.createdAt)]
);

/** 会员邮箱验证码找回密码记录表（哈希存码 + 10 分钟有效 + 失败次数防暴破） */
export const passwordResetCodes = sqliteTable(
  'password_reset_codes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    userId: integer('user_id').notNull(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_pwd_reset_email_site').on(t.siteAgentId, t.email, t.id)]
);

export type IpBlacklistRow = typeof ipBlacklist.$inferSelect;
export type RiskEventRow = typeof riskEvents.$inferSelect;
export type PasswordResetCodeRow = typeof passwordResetCodes.$inferSelect;
