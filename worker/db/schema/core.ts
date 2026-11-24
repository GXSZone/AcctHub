import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 全站键值配置表 */
export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(nowSql),
});

/** 会员与管理员账户表（按租户 site_agent_id 严格隔离邮箱唯一性） */
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    sessionVersion: integer('session_version').notNull().default(0),
    role: text('role').notNull().default('user'),
    balance: real('balance').notNull().default(0),
    totalRecharged: real('total_recharged').notNull().default(0),
    referralCode: text('referral_code'),
    referredByUserId: integer('referred_by_user_id'),
    promoBalance: real('promo_balance').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
    status: text('status').notNull().default('active'),
    statusNote: text('status_note').notNull().default(''),
    totpSecretEnc: text('totp_secret_enc').notNull().default(''),
    totpEnabled: integer('totp_enabled').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_users_site_email').on(t.siteAgentId, t.email),
    uniqueIndex('idx_users_referral_code').on(t.referralCode).where(sql`${t.referralCode} IS NOT NULL`),
  ]
);

/** 可独立撤销的登录会话，只保存令牌摘要 */
export const userSessions = sqliteTable(
  'user_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionVersion: integer('session_version').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [index('idx_user_sessions_user_expiry').on(t.userId, t.expiresAt)]
);

/** 用户登录审计日志表 */
export const userLoginLogs = sqliteTable(
  'user_login_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_login_logs_user').on(t.userId)]
);

/** 前台与下级代理公告表（支持 translations_json 5 语种扩展） */
export const announcements = sqliteTable(
  'announcements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    audience: text('audience').notNull().default('storefront'),
    title: text('title').notNull(),
    titleEn: text('title_en').notNull().default(''),
    content: text('content').notNull(),
    contentEn: text('content_en').notNull().default(''),
    translationsJson: text('translations_json').notNull().default('{}'),
    level: text('level').notNull().default('info'),
    isPinned: integer('is_pinned').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_announcements_owner_aud').on(t.ownerAgentId, t.audience, t.isActive)]
);

/** 帮助中心文章表（按 owner_agent_id 隔离，0 为平台通用文章，>0 为分站专属文章） */
export const helpArticles = sqliteTable(
  'help_articles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    category: text('category').notNull().default('入门指南'),
    title: text('title').notNull(),
    titleEn: text('title_en').notNull().default(''),
    content: text('content').notNull(),
    contentEn: text('content_en').notNull().default(''),
    translationsJson: text('translations_json').notNull().default('{}'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_help_articles_owner').on(t.ownerAgentId, t.isActive, t.sortOrder)]
);

/** 支付网关插件配置表 */
export const paymentPlugins = sqliteTable('payment_plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  enabled: integer('enabled').notNull().default(0),
  configJson: text('config_json').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(nowSql),
});

/** 站点独立发信配置表 */
export const siteMailConfigs = sqliteTable('site_mail_configs', {
  ownerAgentId: integer('owner_agent_id').primaryKey(),
  enabled: integer('enabled').notNull().default(0),
  autoSendOrder: integer('auto_send_order').notNull().default(1),
  autoSendRestock: integer('auto_send_restock').notNull().default(1),
  provider: text('provider').notNull().default('resend'),
  fromName: text('from_name').notNull().default(''),
  fromEmail: text('from_email').notNull().default(''),
  replyTo: text('reply_to').notNull().default(''),
  apiKeyEncrypted: text('api_key_encrypted').notNull().default(''),
  apiEndpoint: text('api_endpoint').notNull().default(''),
  mailgunDomain: text('mailgun_domain').notNull().default(''),
  footerNote: text('footer_note').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(nowSql),
  orderEmailSubjectTpl: text('order_email_subject_tpl').notNull().default(''),
  orderEmailBodyTpl: text('order_email_body_tpl').notNull().default(''),
});

/** 邮件投递日志表 */
export const emailDeliveryLogs = sqliteTable(
  'email_delivery_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    orderNo: text('order_no').notNull().default(''),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    provider: text('provider').notNull().default(''),
    scene: text('scene').notNull().default('order_delivery'),
    status: text('status').notNull().default('sent'),
    errorMessage: text('error_message').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_email_logs_owner').on(t.ownerAgentId, t.id)]
);

export const mailOutbox = sqliteTable(
  'mail_outbox',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull(),
    eventKey: text('event_key').notNull(),
    scene: text('scene').notNull(),
    payload: text('payload').notNull().default(''),
    status: text('status').$type<'pending' | 'sent' | 'disabled' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    leaseUntil: integer('lease_until').notNull().default(0),
    leaseToken: text('lease_token').notNull().default(''),
    lastError: text('last_error').notNull().default(''),
    orderId: integer('order_id'),
    subscriptionId: integer('subscription_id'),
    subscriptionCycle: integer('subscription_cycle'),
    restockTitle: text('restock_title').notNull().default(''),
  },
  (t) => [
    uniqueIndex('uq_mail_outbox_event').on(t.ownerAgentId, t.eventKey),
    index('idx_mail_outbox_due').on(t.status, t.nextAttemptAt, t.leaseUntil),
    index('idx_mail_outbox_order').on(t.orderId, t.scene),
  ]
);

/** 运营总控敏感操作审计日志表 */
export const adminAuditLogs = sqliteTable(
  'admin_audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorUserId: integer('actor_user_id').notNull().default(0),
    actorEmail: text('actor_email').notNull().default('system'),
    actorRole: text('actor_role').notNull().default('admin'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull().default('system'),
    targetId: text('target_id').notNull().default(''),
    summary: text('summary').notNull().default(''),
    beforeJson: text('before_json').notNull().default('{}'),
    afterJson: text('after_json').notNull().default('{}'),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    requestId: text('request_id').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_admin_audit_action').on(t.action, t.id),
    index('idx_admin_audit_actor').on(t.actorUserId, t.id),
  ]
);

export type SiteSettingRow = typeof siteSettings.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AdminAuditLogRow = typeof adminAuditLogs.$inferSelect;
