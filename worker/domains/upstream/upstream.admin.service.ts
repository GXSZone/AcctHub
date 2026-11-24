import { sql } from 'drizzle-orm';
import { upstreamSources } from '../../db/schema/index';
import type { Env } from '../../env';
import { keyedDataDigest } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import {
  deleteBindingByIdRepo,
  listBindingsWithMetaRepo,
  updateBindingByIdRepo,
  upsertProductUpstreamBindingRepo,
} from './upstream.bindings.repo';
import { fetchFromUpstreamAdapter, fetchUpstreamBalance } from './upstream.catalog.adapter';
import { applyUpstreamItemToLocalProduct } from './upstream.collect.service';
import { updateLocalProductFromUpstreamRepo } from './upstream.recovery.repo';
import {
  createUpstreamSourceRepo,
  deleteUpstreamSourceCascadeRepo,
  findUpstreamItemByIdRepo,
  findUpstreamItemBySourceKeyRepo,
  findUpstreamSourceById,
  getUpstreamOrderExceptionCounts,
  listUpstreamItemsForSourceRepo,
  listUpstreamSourcesWithStats,
  listUpstreamSyncLogs,
  updateUpstreamItemRepo,
  updateUpstreamSourceRepo,
} from './upstream.repo';
import { encryptOptionalSecret, sanitizeUpstreamSourceForAdmin } from './upstream.signer';

/** 总控后台：货源列表（密文脱敏）、同步日志与异常订单汇总 */
export async function getUpstreamAdminOverview(env: Env) {
  const db = createDb(env.DB);
  const [sources, logs, summary] = await Promise.all([
    listUpstreamSourcesWithStats(db),
    listUpstreamSyncLogs(db, 40),
    getUpstreamOrderExceptionCounts(db),
  ]);
  const sanitizedSources = await Promise.all(
    sources.map((s) => sanitizeUpstreamSourceForAdmin(env, s as unknown as Record<string, unknown>))
  );
  return {
    sources: sanitizedSources,
    logs: logs.map((l) => ({ ...l, alerts: safeJsonParse<string[]>(l.alerts_json || '[]', []) })),
    summary,
  };
}

function canonicalSourceRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSourceRequest);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalSourceRequest((value as Record<string, unknown>)[key])])
  );
}

/** 创建上游货源（全部密钥 AES-GCM 加密存储） */
export async function createUpstreamSource(env: Env, b: Record<string, unknown>, creationKey?: string) {
  const intent = creationKey?.trim() || null;
  if (intent && (intent.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(intent))) {
    throw Errors.validation('创建意图编号格式无效');
  }
  const requestDigest = intent
    ? await keyedDataDigest(env, 'upstream-source-creation', JSON.stringify(canonicalSourceRequest(b)))
    : null;
  const apiKeyEnc = (await encryptOptionalSecret(env, typeof b.api_key === 'string' ? b.api_key : '')) ?? '';
  const apiSecretEnc =
    (await encryptOptionalSecret(env, typeof b.api_secret === 'string' ? b.api_secret : '')) ?? '';
  const webhookSecretEnc =
    (await encryptOptionalSecret(env, typeof b.webhook_secret === 'string' ? b.webhook_secret : '')) ?? '';
  const relayTokenEnc =
    (await encryptOptionalSecret(env, typeof b.proxy_relay_token === 'string' ? b.proxy_relay_token : '')) ??
    '';

  const adapterType = String(b.adapter_type || 'generic_json');
  const initialBal =
    b.cached_balance !== undefined && b.cached_balance !== null && b.cached_balance !== ''
      ? Number(b.cached_balance)
      : adapterType === 'mock_sandbox'
        ? 1280
        : null;

  const source = await createUpstreamSourceRepo(createDb(env.DB), {
    name: String(b.name || '新上游货源').trim(),
    creationIntentKey: intent,
    creationRequestDigest: requestDigest,
    adapterType,
    authMode: String(b.auth_mode || (adapterType === 'acgfaka' ? 'acgfaka_sign' : 'header_bearer')),
    appId: String(b.app_id || '').trim(),
    baseUrl: String(b.base_url || '').trim(),
    orderUrl: String(b.order_url || '').trim(),
    queryOrderUrl: String(b.query_order_url || '').trim(),
    balanceUrl: String(b.balance_url || '').trim(),
    apiKeyEnc,
    apiSecretEnc,
    webhookSecretEnc,
    proxyRelayUrl: String(b.proxy_relay_url || '').trim(),
    proxyRelayTokenEnc: relayTokenEnc,
    authHeader: String(b.auth_header || 'Authorization').trim(),
    authPrefix: String(b.auth_prefix ?? 'Bearer '),
    fieldMappingJson: JSON.stringify(b.field_mapping || {}),
    filterRulesJson: JSON.stringify(b.filter_rules || {}),
    pricingRulesJson: JSON.stringify(
      b.pricing_rules || {
        markup_percent: 25,
        markup_fixed: 0,
        rounding: 'point9',
        price_spike_guard_pct: 35,
      }
    ),
    orderTemplateJson: JSON.stringify(b.order_template || {}),
    responseMappingJson: JSON.stringify(b.response_mapping || {}),
    outOfStockAction: String(b.out_of_stock_action || 'mark_sold_out'),
    autoRepublishOnRestock:
      b.auto_republish_on_restock === false || b.auto_republish_on_restock === 0 ? 0 : 1,
    defaultCategoryId: Number(b.default_category_id || 1),
    syncIntervalMinutes: Math.max(1, Number(b.sync_interval_minutes || 15)),
    autoSyncEnabled: b.auto_sync_enabled === false || b.auto_sync_enabled === 0 ? 0 : 1,
    cachedBalance: initialBal,
    lowBalanceThreshold: Math.max(0, Number(b.low_balance_threshold ?? 100)),
    sandboxMode: String(b.sandbox_mode || 'normal'),
    status: String(b.status || 'active'),
  });
  if (!source || source.requestDigest !== requestDigest)
    throw Errors.conflict('该创建意图已用于不同的货源配置');
  return { id: source.id, ok: true };
}

/** 更新上游货源配置（留空密钥不覆盖，显式传 clear_* 时清空） */
export async function updateUpstreamSource(env: Env, id: number, b: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = String(b.name).trim();
  if (b.adapter_type !== undefined) patch.adapterType = String(b.adapter_type);
  if (b.auth_mode !== undefined) patch.authMode = String(b.auth_mode);
  if (b.app_id !== undefined) patch.appId = String(b.app_id).trim();
  if (b.base_url !== undefined) patch.baseUrl = String(b.base_url).trim();
  if (b.order_url !== undefined) patch.orderUrl = String(b.order_url).trim();
  if (b.query_order_url !== undefined) patch.queryOrderUrl = String(b.query_order_url).trim();
  if (b.balance_url !== undefined) patch.balanceUrl = String(b.balance_url).trim();
  if (b.proxy_relay_url !== undefined) patch.proxyRelayUrl = String(b.proxy_relay_url).trim();
  if (b.auth_header !== undefined) patch.authHeader = String(b.auth_header);
  if (b.auth_prefix !== undefined) patch.authPrefix = String(b.auth_prefix);
  if (b.field_mapping)
    patch.fieldMappingJson = sql`json_patch(${upstreamSources.fieldMappingJson}, ${JSON.stringify(b.field_mapping)})`;
  if (b.filter_rules)
    patch.filterRulesJson = sql`json_patch(${upstreamSources.filterRulesJson}, ${JSON.stringify(b.filter_rules)})`;
  if (b.pricing_rules)
    patch.pricingRulesJson = sql`json_patch(${upstreamSources.pricingRulesJson}, ${JSON.stringify(b.pricing_rules)})`;
  if (b.order_template)
    patch.orderTemplateJson = sql`json_patch(${upstreamSources.orderTemplateJson}, ${JSON.stringify(b.order_template)})`;
  if (b.response_mapping)
    patch.responseMappingJson = sql`json_patch(${upstreamSources.responseMappingJson}, ${JSON.stringify(b.response_mapping)})`;
  if (b.out_of_stock_action !== undefined) patch.outOfStockAction = String(b.out_of_stock_action);
  if (b.auto_republish_on_restock !== undefined) {
    patch.autoRepublishOnRestock = b.auto_republish_on_restock ? 1 : 0;
  }
  if (b.default_category_id !== undefined) patch.defaultCategoryId = Number(b.default_category_id);
  if (b.sync_interval_minutes !== undefined) {
    patch.syncIntervalMinutes = Math.max(1, Number(b.sync_interval_minutes));
  }
  if (b.auto_sync_enabled !== undefined) patch.autoSyncEnabled = b.auto_sync_enabled ? 1 : 0;
  if (b.low_balance_threshold !== undefined) {
    patch.lowBalanceThreshold = Math.max(0, Number(b.low_balance_threshold));
  }
  if (b.cached_balance !== undefined && b.cached_balance !== null) {
    patch.cachedBalance = Number(b.cached_balance);
  }
  if (b.sandbox_mode !== undefined) patch.sandboxMode = String(b.sandbox_mode);
  if (b.status !== undefined) patch.status = String(b.status);

  if (b.clear_api_key) patch.apiKeyEnc = '';
  else if (typeof b.api_key === 'string' && b.api_key.trim()) {
    patch.apiKeyEnc = await encryptOptionalSecret(env, b.api_key);
  }
  if (b.clear_api_secret) patch.apiSecretEnc = '';
  else if (typeof b.api_secret === 'string' && b.api_secret.trim()) {
    patch.apiSecretEnc = await encryptOptionalSecret(env, b.api_secret);
  }
  if (b.clear_webhook_secret) patch.webhookSecretEnc = '';
  else if (typeof b.webhook_secret === 'string' && b.webhook_secret.trim()) {
    patch.webhookSecretEnc = await encryptOptionalSecret(env, b.webhook_secret);
  }
  if (b.clear_proxy_relay_token) patch.proxyRelayTokenEnc = '';
  else if (typeof b.proxy_relay_token === 'string' && b.proxy_relay_token.trim()) {
    patch.proxyRelayTokenEnc = await encryptOptionalSecret(env, b.proxy_relay_token);
  }

  await updateUpstreamSourceRepo(createDb(env.DB), id, patch);
  return { ok: true };
}

export async function deleteUpstreamSource(env: Env, id: number) {
  await deleteUpstreamSourceCascadeRepo(createDb(env.DB), id);
  return { ok: true };
}

export async function testUpstreamSource(env: Env, id: number) {
  const source = await findUpstreamSourceById(createDb(env.DB), id);
  if (!source) throw Errors.notFound('上游源不存在');
  const [sample, bal] = await Promise.all([
    fetchFromUpstreamAdapter(env, source),
    fetchUpstreamBalance(env, source),
  ]);
  return { ok: true, count: sample.length, balance: bal.balance, preview: sample.slice(0, 6) };
}

export async function refreshUpstreamSourceBalance(env: Env, id: number) {
  const source = await findUpstreamSourceById(createDb(env.DB), id);
  if (!source) throw Errors.notFound('上游源不存在');
  const res = await fetchUpstreamBalance(env, source);
  return { ok: !res.error, ...res };
}

export async function listUpstreamSourceItems(env: Env, id: number) {
  const rows = await listUpstreamItemsForSourceRepo(createDb(env.DB), id);
  return {
    items: rows.map((r) => ({
      ...r,
      raw_specs: safeJsonParse(r.raw_specs_json || '[]', []),
      raw_payload: safeJsonParse(r.raw_payload_json || '{}', {}),
    })),
  };
}

export async function mutateUpstreamItem(
  env: Env,
  itemId: number,
  body: {
    action?: 'collect' | 'ignore' | 'reset_pending';
    target_category_id?: number;
    lock_local_price?: boolean;
    lock_local_content?: boolean;
    fulfillment_mode?: 'upstream_only' | 'local_first';
  }
) {
  const db = createDb(env.DB);
  const item = await findUpstreamItemByIdRepo(db, itemId);
  if (!item) throw Errors.notFound('上游商品记录不存在');

  const nextCatId = body.target_category_id ?? item.targetCategoryId;
  const nextLockPrice =
    body.lock_local_price !== undefined ? (body.lock_local_price ? 1 : 0) : item.lockLocalPrice;
  const nextLockContent =
    body.lock_local_content !== undefined ? (body.lock_local_content ? 1 : 0) : item.lockLocalContent;

  await updateUpstreamItemRepo(db, itemId, {
    targetCategoryId: nextCatId,
    lockLocalPrice: nextLockPrice,
    lockLocalContent: nextLockContent,
  });

  if (body.action === 'ignore') {
    await updateUpstreamItemRepo(db, itemId, { collectStatus: 'ignored' });
    if (item.localProductId) {
      await updateLocalProductFromUpstreamRepo(db, item.localProductId, { isActive: 0 });
    }
    return { ok: true, status: 'ignored' };
  }

  if (body.action === 'reset_pending') {
    await updateUpstreamItemRepo(db, itemId, { collectStatus: 'pending' });
    return { ok: true, status: 'pending' };
  }

  if (body.action === 'collect') {
    const source = await findUpstreamSourceById(db, item.sourceId);
    if (!source) throw Errors.notFound('关联上游源不存在');

    const alerts: string[] = [];
    const applied = await applyUpstreamItemToLocalProduct(
      env,
      source,
      {
        id: item.id,
        upstream_item_id: item.upstreamItemId,
        raw_title: item.rawTitle,
        raw_price: item.rawPrice,
        raw_stock: item.rawStock,
        raw_status: item.rawStatus,
        raw_specs_json: item.rawSpecsJson,
        raw_description: item.rawDescription,
        local_product_id: item.localProductId,
        target_category_id: nextCatId,
        lock_local_price: nextLockPrice,
        lock_local_content: nextLockContent,
      },
      alerts,
      { manualCollect: true, fulfillmentMode: body.fulfillment_mode }
    );
    return { ok: true, status: 'collected', local_product_id: applied.productId, alerts };
  }

  return { ok: true };
}

export async function listUpstreamBindings(env: Env, productId?: number) {
  return { bindings: await listBindingsWithMetaRepo(createDb(env.DB), productId) };
}

export async function upsertUpstreamBinding(env: Env, b: Record<string, unknown>) {
  const productId = Number(b.product_id || 0);
  const sourceId = Number(b.source_id || 0);
  const specId = String(b.spec_id || 'default').trim();
  const upstreamItemId = String(b.upstream_item_id || '').trim();
  const upstreamSpecId = String(b.upstream_spec_id || '').trim();

  if (!productId || !sourceId || !upstreamItemId) {
    throw Errors.validation('请完整选择本地商品、上游货源及上游商品编码');
  }

  const db = createDb(env.DB);
  let cachedCost = Number(b.cached_cost ?? 0);
  let cachedStock = Number(b.cached_stock ?? 0);
  if (cachedCost <= 0 || cachedStock <= 0) {
    const upItem = await findUpstreamItemBySourceKeyRepo(db, sourceId, upstreamItemId);
    if (upItem) {
      const specs = safeJsonParse<Array<{ id: string; price: number; stock?: number }>>(
        upItem.rawSpecsJson || '[]',
        []
      );
      const matched = upstreamSpecId ? specs.find((s) => s.id === upstreamSpecId) : undefined;
      if (cachedCost <= 0) cachedCost = Number(matched?.price ?? upItem.rawPrice ?? 0);
      if (cachedStock <= 0) {
        cachedStock = upItem.rawStatus === 'active' ? Number(matched?.stock ?? upItem.rawStock ?? 0) : 0;
      }
    }
  }

  const id = await upsertProductUpstreamBindingRepo(db, {
    productId,
    specId,
    sourceId,
    upstreamItemId,
    upstreamSpecId,
    fulfillmentMode: String(b.fulfillment_mode || 'local_first'),
    routingStrategy: String(b.routing_strategy || 'priority'),
    priority: Number(b.priority ?? 10),
    cachedCost,
    cachedStock: Math.max(0, Math.floor(cachedStock)),
    isEnabled: b.is_enabled === false ? 0 : 1,
    circuitBrokenReason: '',
    overwriteRouting: true,
  });
  return { ok: true, id };
}

export async function updateUpstreamBinding(
  env: Env,
  bindingId: number,
  productId: number,
  b: Record<string, unknown>
) {
  const patch: Record<string, unknown> = {};
  if (b.fulfillment_mode !== undefined) patch.fulfillmentMode = String(b.fulfillment_mode);
  if (b.routing_strategy !== undefined) patch.routingStrategy = String(b.routing_strategy);
  if (b.priority !== undefined) patch.priority = Number(b.priority);
  if (b.cached_cost !== undefined) patch.cachedCost = Number(b.cached_cost);
  if (b.cached_stock !== undefined) patch.cachedStock = Number(b.cached_stock);
  if (b.is_enabled !== undefined) patch.isEnabled = b.is_enabled ? 1 : 0;
  if (b.reset_circuit) patch.circuitBrokenReason = '';
  if (!(await updateBindingByIdRepo(createDb(env.DB), bindingId, patch, productId))) {
    throw Errors.notFound('此商品没有该上游绑定');
  }
  return { ok: true };
}

export async function deleteUpstreamBinding(env: Env, bindingId: number, productId: number) {
  if (!(await deleteBindingByIdRepo(createDb(env.DB), bindingId, productId))) {
    throw Errors.notFound('此商品没有该上游绑定');
  }
  return { ok: true };
}
