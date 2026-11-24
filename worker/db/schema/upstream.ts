import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 上游货源配置表 */
export const upstreamSources = sqliteTable('upstream_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  creationIntentKey: text('creation_intent_key').unique(),
  creationRequestDigest: text('creation_request_digest'),
  adapterType: text('adapter_type').notNull().default('generic_json'),
  authMode: text('auth_mode').notNull().default('header_bearer'),
  appId: text('app_id').notNull().default(''),
  baseUrl: text('base_url').notNull().default(''),
  orderUrl: text('order_url').notNull().default(''),
  queryOrderUrl: text('query_order_url').notNull().default(''),
  balanceUrl: text('balance_url').notNull().default(''),
  apiKeyEnc: text('api_key_enc').notNull().default(''),
  apiSecretEnc: text('api_secret_enc').notNull().default(''),
  webhookSecretEnc: text('webhook_secret_enc').notNull().default(''),
  proxyRelayUrl: text('proxy_relay_url').notNull().default(''),
  proxyRelayTokenEnc: text('proxy_relay_token_enc').notNull().default(''),
  authHeader: text('auth_header').notNull().default('Authorization'),
  authPrefix: text('auth_prefix').notNull().default('Bearer '),
  fieldMappingJson: text('field_mapping_json').notNull().default('{}'),
  filterRulesJson: text('filter_rules_json').notNull().default('{}'),
  pricingRulesJson: text('pricing_rules_json').notNull().default('{}'),
  orderTemplateJson: text('order_template_json').notNull().default('{}'),
  responseMappingJson: text('response_mapping_json').notNull().default('{}'),
  outOfStockAction: text('out_of_stock_action').notNull().default('mark_sold_out'),
  autoRepublishOnRestock: integer('auto_republish_on_restock').notNull().default(1),
  defaultCategoryId: integer('default_category_id').notNull().default(1),
  syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(15),
  autoSyncEnabled: integer('auto_sync_enabled').notNull().default(1),
  cachedBalance: real('cached_balance'),
  lowBalanceThreshold: real('low_balance_threshold').notNull().default(100),
  balanceUpdatedAt: text('balance_updated_at'),
  sandboxMode: text('sandbox_mode').notNull().default('normal'),
  status: text('status').notNull().default('active'),
  lastSyncAt: text('last_sync_at'),
  lastSyncStatus: text('last_sync_status').notNull().default(''),
  lastSyncMessage: text('last_sync_message').notNull().default(''),
  createdAt: text('created_at').notNull().default(nowSql),
});

/** 上游商品目录缓存与映射表 */
export const upstreamItems = sqliteTable(
  'upstream_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').notNull(),
    upstreamItemId: text('upstream_item_id').notNull(),
    rawTitle: text('raw_title').notNull(),
    rawCategory: text('raw_category').notNull().default(''),
    rawPrice: real('raw_price').notNull().default(0),
    rawStock: integer('raw_stock').notNull().default(0),
    rawStatus: text('raw_status').notNull().default('active'),
    rawSpecsJson: text('raw_specs_json').notNull().default('[]'),
    rawDescription: text('raw_description').notNull().default(''),
    rawPayloadJson: text('raw_payload_json').notNull().default('{}'),
    collectStatus: text('collect_status').notNull().default('pending'),
    localProductId: integer('local_product_id'),
    targetCategoryId: integer('target_category_id'),
    lockLocalPrice: integer('lock_local_price').notNull().default(0),
    lockLocalContent: integer('lock_local_content').notNull().default(1),
    lastSeenAt: text('last_seen_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_upstream_item').on(t.sourceId, t.upstreamItemId),
    index('idx_upstream_items_local_prod').on(t.localProductId),
  ]
);

/** 上游同步任务日志表 */
export const upstreamSyncLogs = sqliteTable(
  'upstream_sync_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: integer('source_id').notNull(),
    sourceName: text('source_name').notNull().default(''),
    triggerType: text('trigger_type').notNull().default('manual'),
    status: text('status').notNull().default('success'),
    fetchedCount: integer('fetched_count').notNull().default(0),
    syncedCount: integer('synced_count').notNull().default(0),
    outOfStockCount: integer('out_of_stock_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    alertsJson: text('alerts_json').notNull().default('[]'),
    durationMs: integer('duration_ms').notNull().default(0),
    message: text('message').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_sync_logs_source').on(t.sourceId, t.id)]
);

/** 商品规格与上游货源多路绑定表 */
export const productUpstreamBindings = sqliteTable(
  'product_upstream_bindings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id').notNull(),
    specId: text('spec_id').notNull().default('default'),
    sourceId: integer('source_id').notNull(),
    upstreamItemId: text('upstream_item_id').notNull(),
    upstreamSpecId: text('upstream_spec_id').notNull().default(''),
    fulfillmentMode: text('fulfillment_mode').notNull().default('local_first'),
    routingStrategy: text('routing_strategy').notNull().default('priority'),
    priority: integer('priority').notNull().default(10),
    cachedCost: real('cached_cost').notNull().default(0),
    cachedStock: integer('cached_stock').notNull().default(0),
    isEnabled: integer('is_enabled').notNull().default(1),
    circuitBrokenReason: text('circuit_broken_reason').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_prod_upstream_binding').on(
      t.productId,
      t.specId,
      t.sourceId,
      t.upstreamItemId,
      t.upstreamSpecId
    ),
    index('idx_bindings_prod_spec_enabled').on(t.productId, t.specId, t.isEnabled),
  ]
);

/** 上游履约采购单记录表 */
export const upstreamOrders = sqliteTable(
  'upstream_orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    localOrderNo: text('local_order_no').notNull().default(''),
    attemptNo: integer('attempt_no').notNull().default(1),
    idempotencyOutTradeNo: text('idempotency_out_trade_no').notNull().unique(),
    sourceId: integer('source_id').notNull(),
    sourceName: text('source_name').notNull().default(''),
    bindingId: integer('binding_id'),
    productId: integer('product_id'),
    specId: text('spec_id').notNull().default('default'),
    upstreamItemId: text('upstream_item_id').notNull().default(''),
    upstreamSpecId: text('upstream_spec_id').notNull().default(''),
    quantity: integer('quantity').notNull().default(1),
    upstreamOrderNo: text('upstream_order_no').notNull().default(''),
    upstreamCost: real('upstream_cost').notNull().default(0),
    status: text('status').notNull().default('pending'),
    purpose: text('purpose').notNull().default('order_fulfill'),
    replacementTicketId: integer('replacement_ticket_id'),
    replacementOrderNo: text('replacement_order_no'),
    replacementNote: text('replacement_note'),
    replacementMailStatus: text('replacement_mail_status'),
    replacementSettlementToken: text('replacement_settlement_token'),
    cardsJson: text('cards_json').notNull().default('[]'),
    errorMessage: text('error_message').notNull().default(''),
    rawResponseJson: text('raw_response_json').notNull().default('{}'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_up_orders_local').on(t.localOrderNo),
    index('idx_up_orders_status').on(t.status),
    index('idx_up_orders_poll').on(t.status, t.updatedAt, t.id),
    uniqueIndex('idx_upstream_replacement_ticket')
      .on(t.replacementTicketId)
      .where(sql`${t.replacementTicketId} IS NOT NULL`),
  ]
);

export type UpstreamSourceDbRow = typeof upstreamSources.$inferSelect;
export type UpstreamBindingDbRow = typeof productUpstreamBindings.$inferSelect;
export type UpstreamOrderDbRow = typeof upstreamOrders.$inferSelect;
