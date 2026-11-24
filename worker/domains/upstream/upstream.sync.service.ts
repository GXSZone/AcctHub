import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { dispatchOpsNotification } from '../../infra/notify';
import { listBindingsForSourceWithProductRepo, updateBindingByIdRepo } from './upstream.bindings.repo';
import { fetchFromUpstreamAdapter, fetchUpstreamBalance } from './upstream.catalog.adapter';
import { applyUpstreamItemToLocalProduct } from './upstream.collect.service';
import {
  findUpstreamItemBySourceKeyRepo,
  findUpstreamSourceById,
  insertUpstreamItemRepo,
  insertUpstreamSyncLogRepo,
  listAutoSyncActiveSourcesRepo,
  listCollectedUpstreamItemsRepo,
  updateSourceSyncStatusRepo,
  updateUpstreamItemRepo,
} from './upstream.repo';
import { getLowestPlatformAgentDiscount, safeParseJson } from './upstream.signer';
import type { FilterRulesConfig, NormalizedUpstreamItem, UpstreamSourceRow } from './upstream.types';

/** 校验上游商品是否通过关键词黑白名单及进货价区间过滤规则 */
function matchesFilterRules(
  item: NormalizedUpstreamItem,
  rules: FilterRulesConfig
): { pass: boolean; reason?: string } {
  const hay = `${item.raw_title} ${item.raw_category}`.toLowerCase();
  const excludes = (rules.exclude_keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  for (const kw of excludes) {
    if (hay.includes(kw)) return { pass: false, reason: `命中排除词「${kw}」` };
  }
  const includes = (rules.include_keywords || []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (includes.length > 0 && !includes.some((kw) => hay.includes(kw))) {
    return { pass: false, reason: '未命中白名单关键词' };
  }
  if (
    typeof rules.min_cost_price === 'number' &&
    rules.min_cost_price > 0 &&
    item.raw_price < rules.min_cost_price
  ) {
    return { pass: false, reason: `进货价低于最低阈值 ¥${rules.min_cost_price}` };
  }
  if (
    typeof rules.max_cost_price === 'number' &&
    rules.max_cost_price > 0 &&
    item.raw_price > rules.max_cost_price
  ) {
    return { pass: false, reason: `进货价高于最高阈值 ¥${rules.max_cost_price}` };
  }
  return { pass: true };
}

async function syncStandaloneBindingsForSource(
  env: Env,
  source: UpstreamSourceRow,
  itemMap: Map<string, NormalizedUpstreamItem>,
  alerts: string[],
  handledProductIds: Set<number>
): Promise<void> {
  const db = createDb(env.DB);
  const lowestTier = await getLowestPlatformAgentDiscount(env);
  const minDiscount = Math.max(0.05, lowestTier.discount_rate);
  const bindings = await listBindingsForSourceWithProductRepo(db, source.id);

  for (const { binding: b, productTitle, basePrice, specsJson } of bindings) {
    if (handledProductIds.has(b.productId)) continue;
    const upItem = itemMap.get(b.upstreamItemId);
    if (!upItem) {
      await updateBindingByIdRepo(db, b.id, { cachedStock: 0 });
      continue;
    }

    const matchedSpec = b.upstreamSpecId
      ? upItem.raw_specs.find((s) => s.id === b.upstreamSpecId)
      : undefined;
    const cost = matchedSpec ? Number(matchedSpec.price) : Number(upItem.raw_price);
    const stock =
      upItem.raw_status !== 'active'
        ? 0
        : matchedSpec?.stock !== undefined
          ? Number(matchedSpec.stock)
          : Number(upItem.raw_stock);

    const localSpecs = safeParseJson<ProductSpec[]>(specsJson || '[]', []);
    const localSpec = localSpecs.find((s) => s.id === b.specId);
    const sellPrice = localSpec ? Number(localSpec.price) : Number(basePrice);
    const minAgentFloor = Number((sellPrice * minDiscount).toFixed(2));

    let circuitReason = '';
    if (cost > 0 && sellPrice > 0 && minAgentFloor + 0.001 < cost) {
      circuitReason = `防亏熔断：本地售价 ¥${sellPrice}，最低代理价 ¥${minAgentFloor} 低于上游成本 ¥${cost}`;
      alerts.push(`SKU 路由防亏熔断：「${productTitle} (${b.specId})」${circuitReason}`);
    }

    await updateBindingByIdRepo(db, b.id, {
      cachedCost: cost,
      cachedStock: Math.max(0, Math.floor(stock)),
      circuitBrokenReason: circuitReason,
      ...(circuitReason ? { isEnabled: 0 } : {}),
    });
  }
}

/** 全量同步单个上游货源（目录拉取 + 绑定同步 + 防亏/涨价风控 + 余额刷新 + 同步日志） */
export async function syncUpstreamSource(
  env: Env,
  sourceId: number,
  triggerType: 'manual' | 'cron' = 'manual'
) {
  const start = Date.now();
  const db = createDb(env.DB);
  const source = await findUpstreamSourceById(db, sourceId);
  if (!source) throw new Error('上游数据源不存在');

  const filterRules: FilterRulesConfig = safeParseJson(source.filter_rules_json || '{}', {});
  const alerts: string[] = [];
  let fetchedCount = 0;
  let syncedCount = 0;
  let outOfStockCount = 0;
  let skippedCount = 0;

  try {
    const normalized = await fetchFromUpstreamAdapter(env, source);
    fetchedCount = normalized.length;
    const seenIds = new Set<string>();
    const itemMap = new Map<string, NormalizedUpstreamItem>();
    const handledProductIds = new Set<number>();

    for (const item of normalized) {
      seenIds.add(item.upstream_item_id);
      itemMap.set(item.upstream_item_id, item);
      const filterCheck = matchesFilterRules(item, filterRules);
      const existing = await findUpstreamItemBySourceKeyRepo(db, source.id, item.upstream_item_id);

      if (!existing) {
        await insertUpstreamItemRepo(db, {
          sourceId: source.id,
          upstreamItemId: item.upstream_item_id,
          rawTitle: item.raw_title,
          rawCategory: item.raw_category,
          rawPrice: item.raw_price,
          rawStock: item.raw_stock,
          rawStatus: item.raw_status,
          rawSpecsJson: JSON.stringify(item.raw_specs),
          rawDescription: item.raw_description,
          rawPayloadJson: JSON.stringify(item.raw_payload),
          collectStatus: filterCheck.pass ? 'pending' : 'ignored',
          targetCategoryId: source.default_category_id,
        });
        if (!filterCheck.pass) skippedCount++;
      } else {
        await updateUpstreamItemRepo(db, existing.id, {
          rawTitle: item.raw_title,
          rawCategory: item.raw_category,
          rawPrice: item.raw_price,
          rawStock: item.raw_stock,
          rawStatus: item.raw_status,
          rawSpecsJson: JSON.stringify(item.raw_specs),
          rawDescription: item.raw_description,
          rawPayloadJson: JSON.stringify(item.raw_payload),
          touchSeenAt: true,
        });

        if (existing.collectStatus === 'collected' && existing.localProductId) {
          const applied = await applyUpstreamItemToLocalProduct(
            env,
            source,
            {
              id: existing.id,
              upstream_item_id: item.upstream_item_id,
              raw_title: item.raw_title,
              raw_price: item.raw_price,
              raw_stock: item.raw_stock,
              raw_status: item.raw_status,
              raw_specs_json: JSON.stringify(item.raw_specs),
              raw_description: item.raw_description,
              local_product_id: existing.localProductId,
              target_category_id: existing.targetCategoryId,
              lock_local_price: existing.lockLocalPrice,
              lock_local_content: existing.lockLocalContent,
            },
            alerts
          );
          if (applied.productId > 0) handledProductIds.add(applied.productId);
          syncedCount++;
          if (applied.isOutOfStock) outOfStockCount++;
        } else {
          skippedCount++;
        }
      }
    }

    const previouslyCollected = await listCollectedUpstreamItemsRepo(db, source.id);
    for (const prev of previouslyCollected) {
      if (!seenIds.has(prev.upstreamItemId)) {
        await updateUpstreamItemRepo(db, prev.id, { rawStock: 0, rawStatus: 'inactive' });
        await applyUpstreamItemToLocalProduct(
          env,
          source,
          {
            id: prev.id,
            upstream_item_id: prev.upstreamItemId,
            raw_title: prev.rawTitle,
            raw_price: prev.rawPrice,
            raw_stock: 0,
            raw_status: 'inactive',
            raw_specs_json: '[]',
            raw_description: '',
            local_product_id: prev.localProductId,
            target_category_id: prev.targetCategoryId,
            lock_local_price: prev.lockLocalPrice,
            lock_local_content: prev.lockLocalContent,
          },
          alerts
        );
        outOfStockCount++;
        alerts.push(`上游下架提醒：「${prev.rawTitle}」已从上游目录消失，已按缺货策略处理`);
      }
    }

    await syncStandaloneBindingsForSource(env, source, itemMap, alerts, handledProductIds);

    const balInfo = await fetchUpstreamBalance(env, source);
    if (balInfo.low_balance && balInfo.balance !== null) {
      alerts.push(
        `上游低余额预警：「${source.name}」当前余额 ¥${balInfo.balance.toFixed(2)} 低于预警线 ¥${source.low_balance_threshold}`
      );
    }

    if (alerts.length > 0) {
      void dispatchOpsNotification(
        env,
        'upstream_alert',
        `上游同步风控预警 · ${source.name}`,
        alerts.slice(0, 8)
      );
    }

    const durationMs = Date.now() - start;
    const summaryMsg = `拉取 ${fetchedCount} 条上游商品，同步更新 ${syncedCount} 条已采商品（无货/缺货 ${outOfStockCount} 条，未采/跳过 ${skippedCount} 条）`;

    await updateSourceSyncStatusRepo(db, source.id, 'success', summaryMsg);
    await insertUpstreamSyncLogRepo(db, {
      sourceId: source.id,
      sourceName: source.name,
      triggerType,
      status: 'success',
      fetchedCount,
      syncedCount,
      outOfStockCount,
      skippedCount,
      alertsJson: JSON.stringify(alerts),
      durationMs,
      message: summaryMsg,
    });

    return {
      ok: true,
      fetched_count: fetchedCount,
      synced_count: syncedCount,
      out_of_stock_count: outOfStockCount,
      skipped_count: skippedCount,
      balance: balInfo.balance,
      alerts,
      duration_ms: durationMs,
      message: summaryMsg,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : '同步失败';
    await updateSourceSyncStatusRepo(db, source.id, 'error', errMsg);
    await insertUpstreamSyncLogRepo(db, {
      sourceId: source.id,
      sourceName: source.name,
      triggerType,
      status: 'error',
      durationMs,
      message: errMsg,
    });
    throw err;
  }
}

/** Cloudflare Workers Cron 定时自动同步到期的活跃上游货源 */
export async function runScheduledUpstreamSync(env: Env): Promise<void> {
  const sources = await listAutoSyncActiveSourcesRepo(createDb(env.DB));
  const now = Date.now();
  for (const s of sources) {
    const intervalMs = Math.max(1, Number(s.syncIntervalMinutes || 15)) * 60 * 1000;
    const lastMs = s.lastSyncAt ? Date.parse(`${s.lastSyncAt.replace(' ', 'T')}Z`) : 0;
    if (!lastMs || now - lastMs >= intervalMs) {
      await syncUpstreamSource(env, s.id, 'cron').catch((e) =>
        console.error(`Cron sync failed for source #${s.id}:`, e)
      );
    }
  }
}
