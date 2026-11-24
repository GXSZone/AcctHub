import { BUSINESS_LIMITS } from '../constants/limits';
import { roundCurrency } from './money';

export const DEFAULT_AGENT_DISCOUNT_RATE = 0.9;

/** 主站直属代理、分站店主和当前分站直属代理可按等级拿货。 */
export function canBuyAtAgentPrice(
  siteAgentId: number | null | undefined,
  buyer: { id: number; parentAgentId?: number | null }
): boolean {
  const siteId = siteAgentId ?? 0;
  return buyer.id === siteId || (buyer.parentAgentId ?? 0) === siteId;
}

/** 商品阶梯批发价规则条目 */
export interface ProductTierPricingRule {
  min_qty: number;
  discount_rate: number;
}

/** 服务端按规格计算后的公开阶梯单价，以起批件数为键。 */
export type BulkTierUnitPrices = Record<number, number>;

export interface BulkTierEvaluationResult {
  /** 生效中的阶梯档位（若未达到任何起批件数则为 null） */
  appliedTier: ProductTierPricingRule | null;
  /** 阶梯折后单价（受成本底线保护） */
  tierUnitPrice: number;
  /** 是否触发了成本价兜底钳位 */
  costClamped: boolean;
  /** 距离下一级更优惠阶梯的引导信息 */
  nextTier: {
    min_qty: number;
    discount_rate: number;
    remaining_qty: number;
    projected_unit_price: number;
  } | null;
}

export interface EffectiveUnitPriceResult {
  unitPrice: number;
  appliedMode: 'retail' | 'bulk_tier' | 'agent_tier' | 'custom_override';
  appliedBulkTier: ProductTierPricingRule | null;
  nextBulkTier: BulkTierEvaluationResult['nextTier'];
  costClamped: boolean;
}

/** 规范化并清洗商品阶梯批发规则：过滤非法值、同件数去重并按起批件数升序排列 */
export function normalizeTierPricingRules(raw: unknown): ProductTierPricingRule[] {
  let list: unknown[] = [];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }

  const byMinQty = new Map<number, number>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const minQty = Math.floor(Number(rec.min_qty));
    const discountRate = Number(rec.discount_rate);
    if (!Number.isFinite(minQty) || minQty < 2 || minQty > BUSINESS_LIMITS.MAX_ORDER_QUANTITY) continue;
    if (!Number.isFinite(discountRate) || discountRate < 0.1 || discountRate >= 1) continue;
    const roundedRate = Number(discountRate.toFixed(4));
    const prev = byMinQty.get(minQty);
    if (prev === undefined || roundedRate < prev) {
      byMinQty.set(minQty, roundedRate);
    }
  }

  return Array.from(byMinQty.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([min_qty, discount_rate]) => ({ min_qty, discount_rate }));
}

function applyCostFloor(candidateUnit: number, baseUnitPrice: number, costPrice?: number | null) {
  const safeBase = Math.max(0, roundCurrency(baseUnitPrice));
  const clampedCost =
    costPrice !== null &&
    costPrice !== undefined &&
    Number.isFinite(Number(costPrice)) &&
    Number(costPrice) > 0
      ? Math.min(safeBase, roundCurrency(Number(costPrice)))
      : 0;
  if (clampedCost > 0 && candidateUnit < clampedCost) {
    return { price: clampedCost, clamped: true };
  }
  return { price: roundCurrency(candidateUnit), clamped: false };
}

/** 计算给定基准单价与购买数量下命中的阶梯批发价及下一档凑单引导 */
export function evaluateBulkTierPricing(params: {
  baseUnitPrice: number;
  quantity: number;
  tiers: ProductTierPricingRule[];
  costPrice?: number | null;
  tierUnitPrices?: BulkTierUnitPrices;
}): BulkTierEvaluationResult {
  const baseUnit = Math.max(0, roundCurrency(params.baseUnitPrice));
  const qty = Math.max(1, Math.floor(params.quantity || 1));
  const sorted = normalizeTierPricingRules(params.tiers);

  let appliedTier: ProductTierPricingRule | null = null;
  let nextTierRule: ProductTierPricingRule | null = null;

  for (const rule of sorted) {
    if (qty >= rule.min_qty) {
      appliedTier = rule;
    } else if (!nextTierRule) {
      nextTierRule = rule;
    }
  }

  let tierUnitPrice = baseUnit;
  let costClamped = false;
  const priceForRule = (rule: ProductTierPricingRule) => {
    const discounted = roundCurrency(baseUnit * rule.discount_rate);
    const quoted = params.tierUnitPrices?.[rule.min_qty];
    return quoted === undefined
      ? applyCostFloor(discounted, baseUnit, params.costPrice)
      : { price: quoted, clamped: quoted > discounted };
  };
  if (appliedTier) {
    const floored = priceForRule(appliedTier);
    tierUnitPrice = floored.price;
    costClamped = floored.clamped;
  }

  const nextTier = nextTierRule
    ? (() => {
        const projected = priceForRule(nextTierRule).price;
        return {
          min_qty: nextTierRule.min_qty,
          discount_rate: nextTierRule.discount_rate,
          remaining_qty: Math.max(1, nextTierRule.min_qty - qty),
          projected_unit_price: projected,
        };
      })()
    : null;

  return { appliedTier, tierUnitPrice, costClamped, nextTier };
}

/**
 * 前后端同源最终单价裁决引擎：
 * - 普通会员：直接应用阶梯批发折后价（带成本底线保护）；
 * - 认证代理：在「代理等级折后价」与「阶梯批发折后价」之间择低生效，绝不叠折亏本。
 */
export function resolveEffectiveUnitPrice(params: {
  retailUnitPrice: number;
  quantity: number;
  tiers: ProductTierPricingRule[];
  agentDiscountRate?: number | null;
  costPrice?: number | null;
  tierUnitPrices?: BulkTierUnitPrices;
  hasCustomAgentOverride?: boolean;
}): EffectiveUnitPriceResult {
  const retailUnit = Math.max(0, roundCurrency(params.retailUnitPrice));
  const bulk = evaluateBulkTierPricing({
    baseUnitPrice: retailUnit,
    quantity: params.quantity,
    tiers: params.tiers,
    costPrice: params.costPrice,
    tierUnitPrices: params.tierUnitPrices,
  });

  if (params.hasCustomAgentOverride) {
    return {
      unitPrice: retailUnit,
      appliedMode: 'custom_override',
      appliedBulkTier: null,
      nextBulkTier: null,
      costClamped: false,
    };
  }

  const hasValidAgentDiscount =
    params.agentDiscountRate !== null &&
    params.agentDiscountRate !== undefined &&
    Number.isFinite(params.agentDiscountRate) &&
    params.agentDiscountRate > 0 &&
    params.agentDiscountRate < 1;

  if (!hasValidAgentDiscount) {
    return {
      unitPrice: bulk.tierUnitPrice,
      appliedMode: bulk.appliedTier ? 'bulk_tier' : 'retail',
      appliedBulkTier: bulk.appliedTier,
      nextBulkTier: bulk.nextTier,
      costClamped: bulk.costClamped,
    };
  }

  const agentUnit = roundCurrency(retailUnit * Number(params.agentDiscountRate));
  if (bulk.appliedTier && bulk.tierUnitPrice < agentUnit) {
    return {
      unitPrice: bulk.tierUnitPrice,
      appliedMode: 'bulk_tier',
      appliedBulkTier: bulk.appliedTier,
      nextBulkTier: bulk.nextTier,
      costClamped: bulk.costClamped,
    };
  }

  return {
    unitPrice: agentUnit,
    appliedMode: 'agent_tier',
    appliedBulkTier: null,
    nextBulkTier: bulk.nextTier,
    costClamped: false,
  };
}
