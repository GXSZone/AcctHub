import { and, asc, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import {
  orders,
  products,
  productUpstreamBindings,
  type UpstreamSourceDbRow,
  upstreamItems,
  upstreamOrders,
  upstreamSources,
  upstreamSyncLogs,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import type { UpstreamSourceRow } from './upstream.types';

/** 将 Drizzle 上游源记录映射为兼容全链路的蛇形 UpstreamSourceRow */
export function mapUpstreamSourceRow(row: UpstreamSourceDbRow): UpstreamSourceRow {
  return {
    id: row.id,
    name: row.name,
    adapter_type: row.adapterType,
    auth_mode: row.authMode,
    app_id: row.appId,
    base_url: row.baseUrl,
    order_url: row.orderUrl,
    query_order_url: row.queryOrderUrl,
    balance_url: row.balanceUrl,
    api_key: '',
    api_key_enc: row.apiKeyEnc,
    api_secret_enc: row.apiSecretEnc,
    webhook_secret_enc: row.webhookSecretEnc,
    proxy_relay_url: row.proxyRelayUrl,
    proxy_relay_token_enc: row.proxyRelayTokenEnc,
    auth_header: row.authHeader,
    auth_prefix: row.authPrefix,
    field_mapping_json: row.fieldMappingJson,
    filter_rules_json: row.filterRulesJson,
    pricing_rules_json: row.pricingRulesJson,
    order_template_json: row.orderTemplateJson,
    response_mapping_json: row.responseMappingJson,
    out_of_stock_action: row.outOfStockAction,
    auto_republish_on_restock: row.autoRepublishOnRestock,
    default_category_id: row.defaultCategoryId,
    sync_interval_minutes: row.syncIntervalMinutes,
    auto_sync_enabled: row.autoSyncEnabled,
    cached_balance: row.cachedBalance,
    low_balance_threshold: row.lowBalanceThreshold,
    balance_updated_at: row.balanceUpdatedAt,
    sandbox_mode: row.sandboxMode,
    status: row.status,
    last_sync_at: row.lastSyncAt,
    last_sync_status: row.lastSyncStatus,
    last_sync_message: row.lastSyncMessage,
  };
}

export async function findUpstreamSourceById(
  db: AppDatabase,
  sourceId: number
): Promise<UpstreamSourceRow | null> {
  const rows = await db.select().from(upstreamSources).where(eq(upstreamSources.id, sourceId)).limit(1);
  return rows[0] ? mapUpstreamSourceRow(rows[0]) : null;
}

export async function listUpstreamSourcesWithStats(db: AppDatabase) {
  const [sourcesRows, itemStatsRows, bindingStatsRows] = await Promise.all([
    db.select().from(upstreamSources).orderBy(desc(upstreamSources.id)),
    db
      .select({
        sourceId: upstreamItems.sourceId,
        totalItems: sql<number>`count(*)`,
        collectedItems: sql<number>`SUM(CASE WHEN ${upstreamItems.collectStatus} = 'collected' THEN 1 ELSE 0 END)`,
        soldOutItems: sql<number>`SUM(CASE WHEN ${upstreamItems.rawStock} <= 0 THEN 1 ELSE 0 END)`,
      })
      .from(upstreamItems)
      .groupBy(upstreamItems.sourceId),
    db
      .select({
        sourceId: productUpstreamBindings.sourceId,
        activeBindings: sql<number>`count(*)`,
      })
      .from(productUpstreamBindings)
      .innerJoin(products, eq(products.id, productUpstreamBindings.productId))
      .where(eq(productUpstreamBindings.isEnabled, 1))
      .groupBy(productUpstreamBindings.sourceId),
  ]);

  const itemMap = new Map(itemStatsRows.map((r) => [r.sourceId, r]));
  const bindingMap = new Map(bindingStatsRows.map((r) => [r.sourceId, Number(r.activeBindings || 0)]));

  return sourcesRows.map((s) => {
    const st = itemMap.get(s.id);
    return {
      ...mapUpstreamSourceRow(s),
      created_at: s.createdAt,
      total_items: Number(st?.totalItems || 0),
      collected_items: Number(st?.collectedItems || 0),
      sold_out_items: Number(st?.soldOutItems || 0),
      active_bindings: bindingMap.get(s.id) ?? 0,
    };
  });
}

export async function listUpstreamSyncLogs(db: AppDatabase, limit = 40) {
  const rows = await db.select().from(upstreamSyncLogs).orderBy(desc(upstreamSyncLogs.id)).limit(limit);
  return rows.map((l) => ({
    id: l.id,
    source_id: l.sourceId,
    source_name: l.sourceName,
    trigger_type: l.triggerType,
    status: l.status,
    fetched_count: l.fetchedCount,
    synced_count: l.syncedCount,
    out_of_stock_count: l.outOfStockCount,
    skipped_count: l.skippedCount,
    alerts_json: l.alertsJson,
    duration_ms: l.durationMs,
    message: l.message,
    created_at: l.createdAt,
  }));
}

export async function getUpstreamOrderExceptionCounts(db: AppDatabase) {
  const rows = await db
    .select({
      pendingCount: sql<number>`SUM(CASE WHEN ${orders.status} = 'upstream_pending' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${orders.status} = 'fulfillment_failed' THEN 1 ELSE 0 END)`,
    })
    .from(orders);
  return {
    pending_orders: Number(rows[0]?.pendingCount || 0),
    failed_orders: Number(rows[0]?.failedCount || 0),
  };
}

export async function createUpstreamSourceRepo(db: AppDatabase, values: typeof upstreamSources.$inferInsert) {
  const columns = { id: upstreamSources.id, requestDigest: upstreamSources.creationRequestDigest };
  const [inserted] = await db
    .insert(upstreamSources)
    .values(values)
    .onConflictDoNothing({ target: upstreamSources.creationIntentKey })
    .returning(columns);
  if (inserted) return inserted;
  const [existing] = await db
    .select(columns)
    .from(upstreamSources)
    .where(eq(upstreamSources.creationIntentKey, values.creationIntentKey ?? ''))
    .limit(1);
  return existing;
}

export async function updateUpstreamSourceRepo(
  db: AppDatabase,
  id: number,
  patch: { [K in keyof typeof upstreamSources.$inferInsert]?: (typeof upstreamSources.$inferInsert)[K] | SQL }
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  await db.update(upstreamSources).set(patch).where(eq(upstreamSources.id, id));
}

/** 级联删除上游源：先终止孤儿待查采购单防阻塞 Cron 队头，再解除关联并清理缓存与路由绑定 */
export async function deleteUpstreamSourceCascadeRepo(db: AppDatabase, sourceId: number): Promise<void> {
  await db
    .update(upstreamOrders)
    .set({
      status: 'failed',
      errorMessage: '关联上游货源已被管理员删除',
      updatedAt: sql`datetime('now')`,
    })
    .where(
      and(
        eq(upstreamOrders.sourceId, sourceId),
        inArray(upstreamOrders.status, ['pending', 'timeout_unknown'])
      )
    );
  await db.update(products).set({ upstreamSourceId: null }).where(eq(products.upstreamSourceId, sourceId));
  await db.delete(productUpstreamBindings).where(eq(productUpstreamBindings.sourceId, sourceId));
  await db.delete(upstreamItems).where(eq(upstreamItems.sourceId, sourceId));
  await db.delete(upstreamSources).where(eq(upstreamSources.id, sourceId));
}

export async function updateSourceCachedBalanceRepo(
  db: AppDatabase,
  sourceId: number,
  balance: number
): Promise<void> {
  await db
    .update(upstreamSources)
    .set({ cachedBalance: balance, balanceUpdatedAt: sql`datetime('now')` })
    .where(eq(upstreamSources.id, sourceId));
}

export async function updateSourceSyncStatusRepo(
  db: AppDatabase,
  sourceId: number,
  status: string,
  message: string
): Promise<void> {
  await db
    .update(upstreamSources)
    .set({
      lastSyncAt: sql`datetime('now')`,
      lastSyncStatus: status,
      lastSyncMessage: message,
    })
    .where(eq(upstreamSources.id, sourceId));
}

export async function insertUpstreamSyncLogRepo(
  db: AppDatabase,
  input: typeof upstreamSyncLogs.$inferInsert
): Promise<void> {
  await db.insert(upstreamSyncLogs).values(input);
}

export async function listAutoSyncActiveSourcesRepo(db: AppDatabase) {
  return db
    .select({
      id: upstreamSources.id,
      syncIntervalMinutes: upstreamSources.syncIntervalMinutes,
      lastSyncAt: upstreamSources.lastSyncAt,
    })
    .from(upstreamSources)
    .where(and(eq(upstreamSources.status, 'active'), eq(upstreamSources.autoSyncEnabled, 1)));
}

export async function listUpstreamItemsForSourceRepo(db: AppDatabase, sourceId: number) {
  const [rows, bindingCounts] = await Promise.all([
    db
      .select({
        item: upstreamItems,
        localTitle: products.title,
        localPrice: products.basePrice,
        localStock: products.manualStock,
        localIsActive: products.isActive,
      })
      .from(upstreamItems)
      .leftJoin(products, eq(products.id, upstreamItems.localProductId))
      .where(eq(upstreamItems.sourceId, sourceId))
      .orderBy(
        sql`CASE ${upstreamItems.collectStatus} WHEN 'collected' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END`,
        asc(upstreamItems.id)
      ),
    db
      .select({
        upstreamItemId: productUpstreamBindings.upstreamItemId,
        c: sql<number>`count(*)`,
      })
      .from(productUpstreamBindings)
      .where(eq(productUpstreamBindings.sourceId, sourceId))
      .groupBy(productUpstreamBindings.upstreamItemId),
  ]);

  const bMap = new Map(bindingCounts.map((r) => [r.upstreamItemId, Number(r.c || 0)]));

  return rows.map(({ item: i, localTitle, localPrice, localStock, localIsActive }) => ({
    id: i.id,
    source_id: i.sourceId,
    upstream_item_id: i.upstreamItemId,
    raw_title: i.rawTitle,
    raw_category: i.rawCategory,
    raw_price: i.rawPrice,
    raw_stock: i.rawStock,
    raw_status: i.rawStatus,
    raw_specs_json: i.rawSpecsJson,
    raw_description: i.rawDescription,
    raw_payload_json: i.rawPayloadJson,
    collect_status: i.collectStatus,
    local_product_id: i.localProductId,
    target_category_id: i.targetCategoryId,
    lock_local_price: i.lockLocalPrice,
    lock_local_content: i.lockLocalContent,
    last_seen_at: i.lastSeenAt,
    local_title: localTitle,
    local_price: localPrice,
    local_stock: localStock,
    local_is_active: localIsActive,
    binding_count: bMap.get(i.upstreamItemId) ?? 0,
  }));
}

export async function findUpstreamItemByIdRepo(db: AppDatabase, itemId: number) {
  const rows = await db.select().from(upstreamItems).where(eq(upstreamItems.id, itemId)).limit(1);
  return rows[0] ?? null;
}

export async function findUpstreamItemBySourceKeyRepo(
  db: AppDatabase,
  sourceId: number,
  upstreamItemId: string
) {
  const rows = await db
    .select()
    .from(upstreamItems)
    .where(and(eq(upstreamItems.sourceId, sourceId), eq(upstreamItems.upstreamItemId, upstreamItemId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertUpstreamItemRepo(
  db: AppDatabase,
  values: typeof upstreamItems.$inferInsert
): Promise<void> {
  await db.insert(upstreamItems).values(values);
}

export async function updateUpstreamItemRepo(
  db: AppDatabase,
  id: number,
  patch: Partial<typeof upstreamItems.$inferInsert> & { touchSeenAt?: boolean }
): Promise<void> {
  const { touchSeenAt, ...rest } = patch;
  await db
    .update(upstreamItems)
    .set({
      ...rest,
      ...(touchSeenAt ? { lastSeenAt: sql`datetime('now')` } : {}),
    })
    .where(eq(upstreamItems.id, id));
}

export async function listCollectedUpstreamItemsRepo(db: AppDatabase, sourceId: number) {
  return db
    .select()
    .from(upstreamItems)
    .where(
      and(
        eq(upstreamItems.sourceId, sourceId),
        eq(upstreamItems.collectStatus, 'collected'),
        isNotNull(upstreamItems.localProductId)
      )
    );
}
