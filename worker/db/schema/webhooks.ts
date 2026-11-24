import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 业务出站 Webhook 扩展钩子表（支持下单/发货/退款签名推送与外部 API 开通回填） */
export const outboundWebhooks = sqliteTable(
  'outbound_webhooks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    name: text('name').notNull(),
    url: text('url').notNull(),
    secretEnc: text('secret_enc').notNull().default(''),
    eventsJson: text('events_json').notNull().default('["order.delivered","order.refunded"]'),
    enabled: integer('enabled').notNull().default(1),
    allowFulfillOverride: integer('allow_fulfill_override').notNull().default(0),
    lastStatus: integer('last_status'),
    lastError: text('last_error').notNull().default(''),
    lastTriggeredAt: text('last_triggered_at'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_outbound_webhooks_owner_enabled').on(t.ownerAgentId, t.enabled)]
);

export type OutboundWebhookRow = typeof outboundWebhooks.$inferSelect;
