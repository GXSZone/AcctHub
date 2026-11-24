import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/**
 * 分站域名与授权注册表（SaaS 多租户域名唯一真相源）
 * 支持一租户多域名（主域 + 备用域）、Cloudflare for SaaS 与人工授权双模式、授权有效期与强制吊销。
 */
export const tenantDomains = sqliteTable(
  'tenant_domains',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: integer('agent_id').notNull(),
    hostname: text('hostname').notNull(),
    domainType: text('domain_type').notNull().default('custom'),
    isPrimary: integer('is_primary').notNull().default(0),
    authMode: text('auth_mode').notNull().default('manual_approval'),
    status: text('status').notNull().default('pending_dns'),
    verificationToken: text('verification_token').notNull().default(''),
    cfHostnameId: text('cf_hostname_id').notNull().default(''),
    sslStatus: text('ssl_status').notNull().default('pending'),
    authorizedByAdminId: integer('authorized_by_admin_id'),
    authorizedAt: text('authorized_at'),
    expiresAt: text('expires_at'),
    errorMessage: text('error_message').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_tenant_domains_hostname').on(t.hostname),
    index('idx_tenant_domains_agent_status').on(t.agentId, t.status),
  ]
);

/**
 * 统一租户级站点键值配置表（owner_agent_id = 0 表示主站，> 0 表示对应代理分站）
 * 统一托管邀请有礼策略、品牌外显、文档可见性、帮助中心继承开关等全部租户独立配置。
 */
export const tenantSettings = sqliteTable(
  'tenant_settings',
  {
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [primaryKey({ name: 'pk_tenant_settings', columns: [t.ownerAgentId, t.key] })]
);

/**
 * 跨站点一次性 SSO 免登票据表（主站一键免登跳转至分站自身域名工作台）
 * 仅保存票据 SHA-256 哈希，60 秒短时效且严格绑定 target_agent_id 一次性原子核销。
 */
export const tenantSsoTickets = sqliteTable(
  'tenant_sso_tickets',
  {
    ticketHash: text('ticket_hash').primaryKey(),
    userId: integer('user_id').notNull(),
    targetAgentId: integer('target_agent_id').notNull(),
    redirectPath: text('redirect_path').notNull().default('/agent'),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_tenant_sso_expiry').on(t.expiresAt)]
);

/**
 * 分站自有收款渠道凭据表（仅在总控允许分站自有收款时启用）
 */
export const tenantPaymentPlugins = sqliteTable(
  'tenant_payment_plugins',
  {
    ownerAgentId: integer('owner_agent_id').notNull(),
    pluginId: text('plugin_id').notNull(),
    enabled: integer('enabled').notNull().default(0),
    configJson: text('config_json').notNull().default('{}'),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [primaryKey({ name: 'pk_tenant_payment_plugins', columns: [t.ownerAgentId, t.pluginId] })]
);

export type TenantDomainRow = typeof tenantDomains.$inferSelect;
export type TenantSettingRow = typeof tenantSettings.$inferSelect;
export type TenantSsoTicketRow = typeof tenantSsoTickets.$inferSelect;
export type TenantPaymentPluginRow = typeof tenantPaymentPlugins.$inferSelect;
