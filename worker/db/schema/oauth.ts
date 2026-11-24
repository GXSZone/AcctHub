import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 用户第三方 OAuth 身份绑定表（严格按 site_agent_id 租户隔离） */
export const userOauthIdentities = sqliteTable(
  'user_oauth_identities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    userId: integer('user_id').notNull(),
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    unionId: text('union_id').notNull().default(''),
    email: text('email').notNull().default(''),
    nickname: text('nickname').notNull().default(''),
    avatarUrl: text('avatar_url').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_oauth_site_provider_uid').on(t.siteAgentId, t.provider, t.providerUserId),
    index('idx_oauth_user_id').on(t.userId),
    index('idx_oauth_union_id').on(t.siteAgentId, t.unionId),
  ]
);

/** OAuth 授权状态表（防 CSRF / PKCE / 跨域名分站中转） */
export const oauthAuthStates = sqliteTable(
  'oauth_auth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    provider: text('provider').notNull(),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    returnOrigin: text('return_origin').notNull(),
    redirectPath: text('redirect_path').notNull().default('/'),
    mode: text('mode').notNull().default('login'),
    bindUserId: integer('bind_user_id'),
    codeVerifier: text('code_verifier').notNull().default(''),
    referralCode: text('referral_code').notNull().default(''),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('idx_oauth_states_expires').on(t.expiresAt)]
);

/** OAuth 回调核销一次性短票据表（60 秒有效、CAS 防重放） */
export const oauthExchangeTickets = sqliteTable(
  'oauth_exchange_tickets',
  {
    ticketHash: text('ticket_hash').primaryKey(),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    userId: integer('user_id').notNull(),
    redirectPath: text('redirect_path').notNull().default('/'),
    action: text('action').notNull().default('login'),
    provider: text('provider').notNull().default(''),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => [index('idx_oauth_tickets_expires').on(t.expiresAt)]
);

export type UserOauthIdentityRow = typeof userOauthIdentities.$inferSelect;
