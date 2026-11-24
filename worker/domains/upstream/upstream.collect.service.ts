import { roundUpCurrency as roundUp2 } from '@shared/domain/money';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { findProductById } from '../payment/payment.repo';
import { upsertProductUpstreamBindingRepo } from './upstream.bindings.repo';
import {
  countHealthyBackupSuppliesRepo,
  createUpstreamLocalProductRepo,
  updateLocalProductFromUpstreamRepo,
} from './upstream.recovery.repo';
import { updateUpstreamItemRepo } from './upstream.repo';
import {
  calculateLocalSellPrice,
  getLowestPlatformAgentDiscount,
  inferIconFromTitle,
  safeParseJson,
} from './upstream.signer';
import type { NormalizedUpstreamSpec, PricingRulesConfig, UpstreamSourceRow } from './upstream.types';

/**
 * 将单条上游商品采集或增量同步至本地商品表，完整保留多规格、SKU 路由绑定、
 * 最低代理折率防亏底线、涨价熔断保护及缺货下架/补货复架策略。
 */
export async function applyUpstreamItemToLocalProduct(
  env: Env,
  source: UpstreamSourceRow,
  upRow: {
    id: number;
    upstream_item_id: string;
    raw_title: string;
    raw_price: number;
    raw_stock: number;
    raw_status: string;
    raw_specs_json: string;
    raw_description: string;
    local_product_id: number | null;
    target_category_id: number | null;
    lock_local_price: number;
    lock_local_content: number;
  },
  alerts: string[],
  opts?: { manualCollect?: boolean; fulfillmentMode?: 'upstream_only' | 'local_first' }
): Promise<{ productId: number; isOutOfStock: boolean }> {
  const db = createDb(env.DB);
  const pricingRules: PricingRulesConfig = safeParseJson(source.pricing_rules_json || '{}', {});
  const lowestTier = await getLowestPlatformAgentDiscount(env);
  const minDiscount = Math.max(0.05, lowestTier.discount_rate);

  const safeFloorFor = (cost: number) => (cost > 0 ? roundUp2(cost / minDiscount) : 0);
  const rawSpecs = safeParseJson<NormalizedUpstreamSpec[]>(upRow.raw_specs_json || '[]', []);
  const isOutOfStock = upRow.raw_status !== 'active' || upRow.raw_stock <= 0;
  const targetCatId = upRow.target_category_id || source.default_category_id || 1;
  const computedBaseSell = calculateLocalSellPrice(
    upRow.raw_price,
    pricingRules,
    safeFloorFor(upRow.raw_price)
  );

  if (!upRow.local_product_id) {
    const slug = `up-${source.id}-${upRow.upstream_item_id.toLowerCase().replace(/[^a-z0-9-]/g, '')}-${Date.now().toString(36).slice(-4)}`;
    const iconKey = inferIconFromTitle(upRow.raw_title);
    const shouldBeActive = isOutOfStock && source.out_of_stock_action === 'auto_unpublish' ? 0 : 1;

    const localSpecs: ProductSpec[] =
      rawSpecs.length > 0
        ? rawSpecs.map((rs) => {
            const specCost = Number(rs.price || upRow.raw_price);
            const specSell = calculateLocalSellPrice(specCost, pricingRules, safeFloorFor(specCost));
            const specStock = rs.stock !== undefined ? Number(rs.stock) : upRow.raw_stock;
            return {
              id: `up_${rs.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'std'}`,
              name: rs.name || '上游标准版',
              price: specSell,
              cost_price: specCost,
              badge: specStock <= 0 ? '暂时无货' : '现货直发',
            };
          })
        : [
            {
              id: 'upstream_std',
              name: '上游直供标准版',
              price: computedBaseSell,
              cost_price: upRow.raw_price,
              badge: isOutOfStock ? '暂时无货' : '现货直发',
            },
          ];

    const minSell = Math.min(...localSpecs.map((s) => Number(s.price)));
    const minCost = Math.min(...localSpecs.map((s) => Number(s.cost_price ?? upRow.raw_price)));

    const newProductId = await createUpstreamLocalProductRepo(db, {
      categoryId: targetCatId,
      slug,
      title: upRow.raw_title,
      titleEn: upRow.raw_title,
      subtitle: upRow.raw_description || '官方合作渠道直供，自动同步实时库存与状态',
      iconKey,
      accentColor: '#D97757',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['渠道直供', '自动发货']),
      basePrice: minSell,
      costPrice: minCost,
      wholesaleDiscount: 0.85,
      stockMode: 'cards',
      manualStock: isOutOfStock ? 0 : upRow.raw_stock,
      summaryMarkdown: upRow.raw_description || '',
      detailMarkdown: upRow.raw_description || '<p>本商品由官方优选渠道实时同步供应，付款后自动交付。</p>',
      specsJson: JSON.stringify(localSpecs),
      isFeatured: 0,
      isActive: shouldBeActive,
      sortOrder: 20,
      upstreamSourceId: source.id,
      upstreamItemId: upRow.upstream_item_id,
      upstreamCost: minCost,
    });

    const fMode = opts?.fulfillmentMode || 'local_first';
    if (rawSpecs.length > 0) {
      for (let i = 0; i < rawSpecs.length; i++) {
        const rs = rawSpecs[i];
        const ls = localSpecs[i];
        await upsertProductUpstreamBindingRepo(db, {
          productId: newProductId,
          specId: ls.id,
          sourceId: source.id,
          upstreamItemId: upRow.upstream_item_id,
          upstreamSpecId: rs.id,
          fulfillmentMode: fMode,
          routingStrategy: 'priority',
          priority: 10,
          cachedCost: Number(rs.price || upRow.raw_price),
          cachedStock: isOutOfStock ? 0 : Number(rs.stock ?? upRow.raw_stock),
          isEnabled: 1,
          circuitBrokenReason: '',
        });
      }
    } else {
      await upsertProductUpstreamBindingRepo(db, {
        productId: newProductId,
        specId: 'upstream_std',
        sourceId: source.id,
        upstreamItemId: upRow.upstream_item_id,
        upstreamSpecId: '',
        fulfillmentMode: fMode,
        routingStrategy: 'priority',
        priority: 10,
        cachedCost: upRow.raw_price,
        cachedStock: isOutOfStock ? 0 : upRow.raw_stock,
        isEnabled: 1,
        circuitBrokenReason: '',
      });
    }

    await updateUpstreamItemRepo(db, upRow.id, {
      collectStatus: 'collected',
      localProductId: newProductId,
      targetCategoryId: targetCatId,
    });
    return { productId: newProductId, isOutOfStock };
  }

  const existing = await findProductById(db, upRow.local_product_id);
  if (!existing) {
    await updateUpstreamItemRepo(db, upRow.id, { localProductId: null, collectStatus: 'pending' });
    return { productId: 0, isOutOfStock };
  }

  const spikeThreshold = Number(pricingRules.price_spike_guard_pct ?? 35);
  let nextActive = existing.isActive;
  let nextBasePrice = existing.basePrice;
  let circuitReason = '';

  const prevCost = Number(existing.upstreamCost ?? existing.costPrice ?? 0);
  if (
    prevCost > 0 &&
    spikeThreshold > 0 &&
    ((upRow.raw_price - prevCost) / prevCost) * 100 > spikeThreshold
  ) {
    circuitReason = `涨价熔断：上游成本从 ¥${prevCost} 暴涨至 ¥${upRow.raw_price}（超 ${spikeThreshold}%）`;
    alerts.push(`涨价熔断预警：「${upRow.raw_title}」${circuitReason}，已熔断该路由`);
  }

  const existingSpecs = safeParseJson<ProductSpec[]>(existing.specsJson || '[]', []);
  let updatedSpecs: ProductSpec[] = [...existingSpecs];

  if (!circuitReason) {
    if (upRow.lock_local_price) {
      const lockedAgentFloor = Number((existing.basePrice * minDiscount).toFixed(2));
      if (upRow.raw_price > 0 && lockedAgentFloor + 0.001 < upRow.raw_price) {
        circuitReason = `防亏熔断：已锁本地售价 ¥${existing.basePrice}，最低代理「${lowestTier.name}」拿货价 ¥${lockedAgentFloor} 低于新成本 ¥${upRow.raw_price}`;
        alerts.push(`防亏熔断预警：「${upRow.raw_title}」${circuitReason}，已自动暂停该路由`);
      }
    } else if (rawSpecs.length > 0) {
      updatedSpecs = rawSpecs.map((rs) => {
        const specCost = Number(rs.price || upRow.raw_price);
        const specSell = calculateLocalSellPrice(specCost, pricingRules, safeFloorFor(specCost));
        const specStock = isOutOfStock ? 0 : Number(rs.stock ?? upRow.raw_stock);
        const specId = `up_${rs.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'std'}`;
        const prevSpec = existingSpecs.find((es) => es.id === specId);
        return {
          ...(prevSpec || {}),
          id: specId,
          name: upRow.lock_local_content && prevSpec?.name ? prevSpec.name : rs.name || '上游标准版',
          price: specSell,
          cost_price: specCost,
          badge: specStock <= 0 ? '已售罄' : '现货',
        };
      });
      nextBasePrice = Math.min(...updatedSpecs.map((s) => Number(s.price)));
    } else {
      nextBasePrice = computedBaseSell;
      if (updatedSpecs.length > 0) {
        updatedSpecs[0] = {
          ...updatedSpecs[0],
          price: nextBasePrice,
          cost_price: upRow.raw_price,
          badge: isOutOfStock ? '已售罄' : '现货',
        };
      }
    }
  }

  if (rawSpecs.length > 0) {
    for (const rs of rawSpecs) {
      const specId = `up_${rs.id.replace(/[^a-zA-Z0-9_-]/g, '') || 'std'}`;
      const specCost = Number(rs.price || upRow.raw_price);
      let specCircuit = circuitReason;
      if (!specCircuit && upRow.lock_local_price) {
        const matchedLocal = updatedSpecs.find((s) => s.id === specId);
        if (matchedLocal && Number((matchedLocal.price * minDiscount).toFixed(2)) + 0.001 < specCost) {
          specCircuit = `防亏熔断：规格「${matchedLocal.name}」代理底价低于新成本 ¥${specCost}`;
        }
      }
      await upsertProductUpstreamBindingRepo(db, {
        productId: existing.id,
        specId,
        sourceId: source.id,
        upstreamItemId: upRow.upstream_item_id,
        upstreamSpecId: rs.id,
        fulfillmentMode: 'local_first',
        routingStrategy: 'priority',
        priority: 10,
        cachedCost: specCost,
        cachedStock: isOutOfStock ? 0 : Number(rs.stock ?? upRow.raw_stock),
        isEnabled: specCircuit ? 0 : 1,
        circuitBrokenReason: specCircuit,
      });
    }
  } else {
    const targetSpecId = updatedSpecs[0]?.id || 'upstream_std';
    await upsertProductUpstreamBindingRepo(db, {
      productId: existing.id,
      specId: targetSpecId,
      sourceId: source.id,
      upstreamItemId: upRow.upstream_item_id,
      upstreamSpecId: '',
      fulfillmentMode: 'local_first',
      routingStrategy: 'priority',
      priority: 10,
      cachedCost: upRow.raw_price,
      cachedStock: isOutOfStock ? 0 : upRow.raw_stock,
      isEnabled: circuitReason ? 0 : 1,
      circuitBrokenReason: circuitReason,
    });
  }

  const hasHealthySupply = await countHealthyBackupSuppliesRepo(db, existing.id);
  if (circuitReason) {
    if (!hasHealthySupply) nextActive = 0;
  } else if (isOutOfStock) {
    if (source.out_of_stock_action === 'auto_unpublish' && !hasHealthySupply) nextActive = 0;
    else if (opts?.manualCollect) nextActive = 1;
  } else if ((source.auto_republish_on_restock || opts?.manualCollect) && existing.isActive === 0) {
    nextActive = 1;
  }

  await updateLocalProductFromUpstreamRepo(db, existing.id, {
    categoryId: targetCatId,
    basePrice: nextBasePrice,
    costPrice: upRow.raw_price,
    specsJson: JSON.stringify(updatedSpecs),
    manualStock: isOutOfStock ? 0 : upRow.raw_stock,
    isActive: nextActive,
    upstreamCost: upRow.raw_price,
    ...(upRow.lock_local_content === 0 ? { title: upRow.raw_title } : {}),
  });

  await updateUpstreamItemRepo(db, upRow.id, {
    collectStatus: 'collected',
    targetCategoryId: targetCatId,
  });
  return { productId: existing.id, isOutOfStock };
}
