import {
  evaluateFlashSale,
  normalizeBundleItems,
  resolveFlashSaleSpecUnitPrice,
} from '@shared/domain/commerce-modes';
import {
  type BulkTierUnitPrices,
  evaluateBulkTierPricing,
  normalizeTierPricingRules,
} from '@shared/domain/pricing';
import { buildWarrantySummaryTemplate, normalizeWarrantyType } from '@shared/domain/warranty';
import type { ProductSpec } from '../../db/types';
import type { Env, TenantContext } from '../../env';
import { createDb } from '../../infra/db';
import { getAgentLineageNode } from '../agent/settlement.service';
import { resolveBundleStockAndTitles } from '../commerce/bundle.service';
import {
  getBaseAgentDiscountRepo,
  loadAgentCustomPrices,
  loadAgentProductOverrides,
  loadAvailableCardCountForProduct,
  loadAvailableCardCountsByProduct,
  loadHealthyUpstreamStockMapsRepo,
  type ProductOverrideRow,
} from './storefront.repo';

export type { ProductOverrideRow };

export interface PreloadedProductMeta {
  cardCountByProduct: Map<number, number>;
  upstreamStockByProduct: Map<number, number>;
  upstreamStockByProductSpec: Map<string, number>;
  upstreamOnlyProducts: Set<number>;
  customPricesByProduct: Map<number, Map<string, number>>;
  overridesByProduct: Map<number, ProductOverrideRow>;
  baseAgentDiscount: number;
  sellerDiscount: number | null;
}

function wholesaleOwner(tenant: TenantContext): number {
  return tenant.isSubAgent ? (tenant.agentId ?? 0) : 0;
}

/** 按分站加价百分比计算零售价（精确到 2 位小数） */
export function applyMarkup(price: number, markupPercent: number): number {
  if (!markupPercent) return Number(price.toFixed(2));
  return Number((price * (1 + markupPercent / 100)).toFixed(2));
}

export function resolveStorefrontRetailUnit(
  basePrice: number,
  markupPercent: number,
  customPrice: number | null | undefined,
  sellerDiscount: number | null
): number {
  const price =
    customPrice != null && Number.isFinite(customPrice) && customPrice > 0
      ? Number(customPrice.toFixed(2))
      : applyMarkup(basePrice, markupPercent);
  return sellerDiscount === null ? price : Math.max(price, Number((basePrice * sellerDiscount).toFixed(2)));
}

async function loadSellerDiscount(env: Env, agentId: number | null): Promise<number | null> {
  if (!agentId) return null;
  const seller = await getAgentLineageNode(env, agentId);
  return seller?.discount_rate ?? 0.9;
}

/** 批量预加载商品列表所需的库存、上游库存、代理定制价与覆写元数据，消除 N+1 查询 */
export async function preloadProductBatchMeta(
  env: Env,
  tenant: TenantContext
): Promise<PreloadedProductMeta> {
  const db = createDb(env.DB);
  const ownerScope = wholesaleOwner(tenant);
  const subAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : null;

  const [cardCountByProduct, upStockMaps, customRows, overrideRows, baseAgentDiscount, sellerDiscount] =
    await Promise.all([
      loadAvailableCardCountsByProduct(db),
      loadHealthyUpstreamStockMapsRepo(db, env),
      subAgentId ? loadAgentCustomPrices(db, subAgentId) : Promise.resolve([]),
      subAgentId ? loadAgentProductOverrides(db, subAgentId) : Promise.resolve([]),
      getBaseAgentDiscountRepo(db, ownerScope),
      loadSellerDiscount(env, subAgentId),
    ]);

  const customPricesByProduct = new Map<number, Map<string, number>>();
  for (const cr of customRows) {
    const pid = Number(cr.productId);
    let m = customPricesByProduct.get(pid);
    if (!m) {
      m = new Map<string, number>();
      customPricesByProduct.set(pid, m);
    }
    m.set(cr.specId, Number(cr.customPrice));
  }

  const overridesByProduct = new Map<number, ProductOverrideRow>();
  for (const ov of overrideRows) {
    overridesByProduct.set(Number(ov.product_id), ov);
  }

  return {
    cardCountByProduct,
    upstreamStockByProduct: upStockMaps.byProduct,
    upstreamStockByProductSpec: upStockMaps.byProductSpec,
    upstreamOnlyProducts: upStockMaps.upstreamOnlyProducts,
    customPricesByProduct,
    overridesByProduct,
    baseAgentDiscount,
    sellerDiscount,
  };
}

/** 结合当前租户定价、覆写文案、库存与质保快照组装对外展示的商品对象 */
export async function enrichProduct(
  env: Env,
  row: Record<string, unknown>,
  tenant: TenantContext,
  baseAgentDiscount?: number,
  preloaded?: PreloadedProductMeta
) {
  const db = createDb(env.DB);
  const productId = Number(row.id);
  const stockMode = String(row.stock_mode || 'cards');
  const rawBundleItems = normalizeBundleItems(row.bundle_items_json);
  const bundleInfo = rawBundleItems.length > 0 ? await resolveBundleStockAndTitles(db, rawBundleItems) : null;
  let availableStock = Number(row.manual_stock || 0);

  if (bundleInfo) {
    availableStock = bundleInfo.maxSets;
  } else if (row.delivery_type === 'api_key') {
    availableStock = 0;
  } else if (stockMode === 'cards') {
    let localCards = 0;
    let upstreamStock = 0;
    let isUpstreamOnly = false;
    if (preloaded) {
      localCards = preloaded.cardCountByProduct.get(productId) ?? 0;
      upstreamStock = preloaded.upstreamStockByProduct.get(productId) ?? 0;
      isUpstreamOnly = preloaded.upstreamOnlyProducts.has(productId);
    } else {
      const [cnt, upMaps] = await Promise.all([
        loadAvailableCardCountForProduct(db, productId),
        loadHealthyUpstreamStockMapsRepo(db, env),
      ]);
      localCards = cnt;
      upstreamStock = upMaps.byProduct.get(productId) ?? 0;
      isUpstreamOnly = upMaps.upstreamOnlyProducts.has(productId);
    }
    availableStock = isUpstreamOnly ? upstreamStock : localCards + upstreamStock;
  } else if (stockMode === 'seats') {
    const total = Number(row.seat_total || 5);
    const used = Number(row.seat_used || 0);
    availableStock = Math.max(0, total - used);
  } else {
    const upStock = preloaded
      ? (preloaded.upstreamStockByProduct.get(productId) ?? 0)
      : ((await loadHealthyUpstreamStockMapsRepo(db, env)).byProduct.get(productId) ?? 0);
    if (upStock > 0) availableStock = Math.max(availableStock, upStock);
  }

  let customPriceMap = new Map<string, number>();
  let overrideRow: ProductOverrideRow | undefined;
  if (tenant.isSubAgent && tenant.agentId) {
    if (preloaded) {
      customPriceMap = preloaded.customPricesByProduct.get(productId) ?? customPriceMap;
      overrideRow = preloaded.overridesByProduct.get(productId);
    } else {
      const [customRows, overrides] = await Promise.all([
        loadAgentCustomPrices(db, tenant.agentId, productId),
        loadAgentProductOverrides(db, tenant.agentId, productId),
      ]);
      for (const cr of customRows) {
        customPriceMap.set(cr.specId, Number(cr.customPrice));
      }
      overrideRow = overrides[0];
    }
  }

  const sellerDiscount = preloaded
    ? preloaded.sellerDiscount
    : await loadSellerDiscount(env, tenant.isSubAgent ? tenant.agentId : null);
  const rawSpecs: ProductSpec[] = JSON.parse(String(row.specs_json || '[]'));
  const tierPricing = normalizeTierPricingRules(row.tier_pricing_json);
  const productCost = row.cost_price == null ? null : Number(row.cost_price);
  function bulkTierUnitPrices(
    baseUnitPrice: number,
    costPrice: number | null
  ): BulkTierUnitPrices | undefined {
    // 只有触发成本保护的档位需要附带实际报价。
    const prices: BulkTierUnitPrices = {};
    for (const tier of tierPricing) {
      const evaluation = evaluateBulkTierPricing({
        baseUnitPrice,
        costPrice,
        quantity: tier.min_qty,
        tiers: [tier],
      });
      if (evaluation.costClamped) prices[tier.min_qty] = evaluation.tierUnitPrice;
    }
    return Object.keys(prices).length ? prices : undefined;
  }
  const isPrivateProduct = Number(row.owner_agent_id || 0) > 0;
  const effectiveMarkup = isPrivateProduct ? 0 : tenant.markupPercent;
  const specs = rawSpecs.map((s) => {
    // 分站自建私有商品直接使用站长设定售价，不叠加平台代销默认加价率
    if (isPrivateProduct) {
      const { cost_price: _ignoreCost, ...safeSpec } = s;
      void _ignoreCost;
      return {
        ...safeSpec,
        base_price: s.price,
        price: Number(s.price.toFixed(2)),
        bulk_tier_unit_prices: undefined,
        original_price: s.original_price ? Number(s.original_price.toFixed(2)) : undefined,
      };
    }
    // 多规格商品严格按规格 ID 匹配自定义售价，防止回退到 'default' 造成高价规格被低价覆盖
    const override =
      rawSpecs.length <= 1
        ? (customPriceMap.get(s.id) ?? customPriceMap.get('default'))
        : customPriceMap.get(s.id);
    const finalPrice = resolveStorefrontRetailUnit(s.price, effectiveMarkup, override, sellerDiscount);
    const { cost_price: _ignoreCost, ...safeSpec } = s;
    void _ignoreCost;
    return {
      ...safeSpec,
      base_price: s.price,
      price: finalPrice,
      bulk_tier_unit_prices: bulkTierUnitPrices(s.price, s.cost_price ?? productCost),
      original_price: s.original_price ? applyMarkup(s.original_price, effectiveMarkup) : undefined,
    };
  });

  const basePrice = Number(row.base_price);
  const flashSale = evaluateFlashSale({
    flashSalePrice: row.flash_sale_price == null ? null : Number(row.flash_sale_price),
    flashSaleStartAt: String(row.flash_sale_start_at || ''),
    flashSaleEndAt: String(row.flash_sale_end_at || ''),
    flashSaleLimit: Number(row.flash_sale_limit || 0),
    flashSaleSold: Number(row.flash_sale_sold || 0),
  });
  const finalSpecs =
    flashSale.status === 'active' && flashSale.price
      ? specs.map((s) => {
          const flashUnit = resolveFlashSaleSpecUnitPrice({
            baseProductPrice: basePrice,
            specRetailPrice: s.price,
            flashSalePrice: flashSale.price ?? s.price,
            specsCount: specs.length,
          });
          return {
            ...s,
            original_price: s.original_price ?? s.price,
            price: flashUnit,
          };
        })
      : specs;

  const displayBasePrice =
    finalSpecs[0]?.price ??
    (isPrivateProduct
      ? Number(basePrice.toFixed(2))
      : resolveStorefrontRetailUnit(
          basePrice,
          effectiveMarkup,
          customPriceMap.get('default'),
          sellerDiscount
        ));
  const finalDisplayPrice =
    flashSale.status === 'active' && flashSale.price && finalSpecs.length === 0
      ? Math.min(displayBasePrice, flashSale.price)
      : displayBasePrice;

  const stockLabel =
    availableStock === 0
      ? row.delivery_type === 'preorder'
        ? '可预订'
        : '已售罄'
      : stockMode === 'seats'
        ? `剩 ${availableStock} 席`
        : availableStock >= 50
          ? '非常多'
          : availableStock >= 10
            ? '充足'
            : `仅剩 ${availableStock}`;

  const effectiveBaseDiscount =
    preloaded?.baseAgentDiscount ??
    baseAgentDiscount ??
    (await getBaseAgentDiscountRepo(db, wholesaleOwner(tenant)));

  const effectiveTitle = (overrideRow?.custom_title || '').trim() || String(row.title);
  const effectiveSubtitle = (overrideRow?.custom_subtitle || '').trim() || String(row.subtitle || '');
  const effectiveDetail =
    (overrideRow?.custom_detail_markdown || '').trim() || String(row.detail_markdown || '');
  const effectiveRisk = (overrideRow?.custom_risk_notice || '').trim() || String(row.risk_notice || '');
  const warrantyType = normalizeWarrantyType(row.warranty_type);
  const warrantyDays = Number.isFinite(Number(row.warranty_days))
    ? Math.max(0, Math.floor(Number(row.warranty_days)))
    : 30;
  const warrantySummary =
    String(row.warranty_summary || '').trim() || buildWarrantySummaryTemplate(warrantyType, warrantyDays);

  return {
    id: productId,
    owner_agent_id: Number(row.owner_agent_id || 0),
    is_private: Number(row.owner_agent_id || 0) > 0,
    category_id: Number(row.category_id),
    slug: String(row.slug),
    title: effectiveTitle,
    title_en: (overrideRow?.custom_title || '').trim() || String(row.title_en || row.title),
    subtitle: effectiveSubtitle,
    subtitle_en: (overrideRow?.custom_subtitle || '').trim() || String(row.subtitle_en || row.subtitle || ''),
    translations_json: String(row.translations_json || '{}'),
    icon_key: String(row.icon_key || 'sparkles'),
    accent_color: String(row.accent_color || '#D97757'),
    delivery_type: String(row.delivery_type || 'auto'),
    warranty_type: warrantyType,
    warranty_days: warrantyDays,
    warranty_summary: warrantySummary,
    tags: JSON.parse(String(row.tags_json || '[]')) as string[],
    base_price: basePrice,
    price: Number(finalDisplayPrice.toFixed(2)),
    original_price:
      flashSale.status === 'active'
        ? Number(displayBasePrice.toFixed(2))
        : row.original_price
          ? applyMarkup(Number(row.original_price), tenant.markupPercent)
          : null,
    wholesale_price: Number(((rawSpecs[0]?.price ?? basePrice) * effectiveBaseDiscount).toFixed(2)),
    stock_mode: stockMode,
    available_stock: availableStock,
    stock_label: stockLabel,
    seat_total: Number(row.seat_total || 0),
    seat_used: Number(row.seat_used || 0),
    summary_markdown: String(row.summary_markdown || ''),
    detail_markdown: effectiveDetail,
    risk_notice: effectiveRisk,
    faq: JSON.parse(String(row.faq_json || '[]')),
    custom_fields: JSON.parse(String(row.custom_fields_json || '[]')),
    specs: finalSpecs,
    tier_pricing: tierPricing,
    bulk_tier_unit_prices: rawSpecs.length === 0 ? bulkTierUnitPrices(basePrice, productCost) : undefined,
    is_featured: Boolean(row.is_featured),
    is_active: Boolean(row.is_active),
    sort_order: Number(row.sort_order || 0),
    sales_count: Number(row.sales_count || 0),
    min_quantity: Math.max(1, Number(row.min_quantity || 1)),
    max_quantity: Math.max(0, Number(row.max_quantity || 0)),
    require_login: Boolean(row.require_login),
    is_hidden: Boolean(row.is_hidden),
    has_access_password: Boolean(String(row.access_password || '').trim()),
    flash_sale: flashSale,
    bundle_items: bundleInfo ? bundleInfo.items : [],
    group_buy: {
      enabled: Boolean(row.group_buy_enabled) && Number(row.group_buy_price || 0) > 0,
      size: Math.max(2, Number(row.group_buy_size || 2)),
      price: row.group_buy_price == null ? null : Number(row.group_buy_price),
      hours: Math.max(1, Number(row.group_buy_hours || 24)),
    },
    allow_card_selection: Boolean(row.allow_card_selection),
    card_select_fee: Math.max(0, Number(row.card_select_fee || 0)),
    member_price:
      row.member_price != null && Number(row.member_price) > 0
        ? Number(Number(row.member_price).toFixed(2))
        : null,
  };
}
