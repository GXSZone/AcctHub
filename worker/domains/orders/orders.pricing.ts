import {
  canBuyAtAgentPrice,
  DEFAULT_AGENT_DISCOUNT_RATE,
  normalizeTierPricingRules,
  resolveEffectiveUnitPrice,
  resolveFlashSaleSpecUnitPrice,
} from '@shared/index';
import type { AuthUser, ProductSpec } from '../../db/types';
import type { Env, TenantContext } from '../../env';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { getAgentLineageNode } from '../agent/settlement.service';
import { getUserAgentTier } from '../auth/auth.service';
import { resolveStorefrontRetailUnit } from '../storefront/storefront.enricher';
import {
  findActiveAgentByUserIdForOrder,
  findActiveCouponForOrder,
  findAgentCustomSpecPrice,
} from './orders.repo';

export interface ResolvedOrderPricing {
  retailUnit: number;
  unitPrice: number;
  totalAmount: number;
  sellerCostFloor: number;
  discountAmount: number;
  couponCodeApplied: string | null;
  couponDiscount: number;
  couponIdClaimed: number | null;
  buyerAgentForWholesale: { id: number; parentAgentId: number | null } | null;
  appliedBulkTier: { min_qty: number; discount_rate: number } | null;
}

/**
 * 统一下单计价与优惠券校验引擎：
 * 1) 多规格严格按 spec_id 匹配定制价，并以分站拿货底价兜底防倒挂；
 * 2) 普通买家支持商品阶梯批发价（受成本底线保护）；认证代理在「代理折扣」与「阶梯批发价」间择优，严禁叠加折上折或再使用零售优惠券。
 */
export async function resolveOrderPricing(
  env: Env,
  db: AppDatabase,
  params: {
    tenant: TenantContext;
    user: AuthUser | null;
    productId: number;
    selectedSpec: ProductSpec;
    specsCount: number;
    qty: number;
    couponCode?: string;
    tierPricingJson?: string;
    productCostPrice?: number | null;
    productOwnerAgentId?: number;
    baseProductPrice?: number;
    flashSaleActivePrice?: number | null;
    groupBuyUnitPrice?: number | null;
    memberPrice?: number | null;
    extraSelectFee?: number;
  }
): Promise<ResolvedOrderPricing> {
  const { tenant, user, productId, selectedSpec, specsCount, qty, couponCode } = params;
  const tenantAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : null;

  const isPlatformProduct = (params.productOwnerAgentId ?? 0) === 0;
  let customPrice: number | null = null;
  let sellerDiscount: number | null = null;
  if (tenantAgentId && isPlatformProduct) {
    customPrice = await findAgentCustomSpecPrice(db, tenantAgentId, productId, selectedSpec.id, specsCount);
    const sellerNode = await getAgentLineageNode(env, tenantAgentId);
    sellerDiscount = sellerNode?.discount_rate ?? 0.9;
  }
  const retailUnit = isPlatformProduct
    ? resolveStorefrontRetailUnit(selectedSpec.price, tenant.markupPercent, customPrice, sellerDiscount)
    : Number(selectedSpec.price.toFixed(2));
  const hasCustomAgentOverride = customPrice !== null && Number.isFinite(customPrice) && customPrice > 0;

  let agentDiscountRate: number | null = null;
  let buyerAgentForWholesale: { id: number; parentAgentId: number | null } | null = null;
  if (isPlatformProduct && user && user.role === 'agent') {
    const buyerAgent = await findActiveAgentByUserIdForOrder(db, user.id);
    if (buyerAgent && canBuyAtAgentPrice(tenantAgentId, buyerAgent)) {
      const tier = await getUserAgentTier(env, user.id);
      agentDiscountRate = tier ? Number(tier.discount_rate) : DEFAULT_AGENT_DISCOUNT_RATE;
      buyerAgentForWholesale = buyerAgent;
    }
  }

  const tierRules = isPlatformProduct ? normalizeTierPricingRules(params.tierPricingJson) : [];
  const specCost =
    selectedSpec.cost_price !== undefined && selectedSpec.cost_price !== null
      ? Number(selectedSpec.cost_price)
      : (params.productCostPrice ?? null);

  // 若分站且存在代理拿货，基准价按主站标价选优或按分站零售价算阶梯（非自定义固定改价）
  const baseUnitForBulkAndAgent =
    buyerAgentForWholesale && agentDiscountRate !== null ? selectedSpec.price : retailUnit;
  const unitDecision = resolveEffectiveUnitPrice({
    retailUnitPrice: baseUnitForBulkAndAgent,
    quantity: qty,
    tiers: buyerAgentForWholesale || !tenantAgentId ? tierRules : [],
    agentDiscountRate,
    costPrice: specCost,
    hasCustomAgentOverride: buyerAgentForWholesale ? false : hasCustomAgentOverride,
  });

  // 代理最终拿货单价受当前分站拿货底线钳位保护（如在直属上级分站采购）
  let unitPrice =
    tenantAgentId && !buyerAgentForWholesale && hasCustomAgentOverride ? retailUnit : unitDecision.unitPrice;
  const appliedBulkTier = unitDecision.appliedBulkTier;

  // 拼团价与限时秒杀价（若低于常规单价则择优生效，且不低于代理分站拿货底线）
  if (params.groupBuyUnitPrice && params.groupBuyUnitPrice > 0) {
    unitPrice = Number(params.groupBuyUnitPrice.toFixed(2));
  } else if (params.flashSaleActivePrice && params.flashSaleActivePrice > 0) {
    const flashUnit = resolveFlashSaleSpecUnitPrice({
      baseProductPrice: params.baseProductPrice ?? selectedSpec.price,
      specRetailPrice: retailUnit,
      flashSalePrice: params.flashSaleActivePrice,
      specsCount,
    });
    const minFloor =
      tenantAgentId && isPlatformProduct
        ? Number((selectedSpec.price * (sellerDiscount ?? 0.9)).toFixed(2))
        : 0.01;
    unitPrice = Math.min(unitPrice, Math.max(minFloor, flashUnit));
  }

  // 游客价 vs 会员价分离（仅登录会员自动享受会员价，严禁击穿分站拿货底价）
  if (!params.groupBuyUnitPrice && user && params.memberPrice && params.memberPrice > 0) {
    const memberUnit = resolveFlashSaleSpecUnitPrice({
      baseProductPrice: params.baseProductPrice ?? selectedSpec.price,
      specRetailPrice: retailUnit,
      flashSalePrice: params.memberPrice,
      specsCount,
    });
    const minFloor =
      tenantAgentId && isPlatformProduct
        ? Number((selectedSpec.price * (sellerDiscount ?? 0.9)).toFixed(2))
        : 0.01;
    unitPrice = Math.min(unitPrice, Math.max(minFloor, memberUnit));
  }

  const selectFee = Math.max(0, Number(params.extraSelectFee || 0));
  const rawOrderSubtotal = Number((unitPrice * qty + selectFee).toFixed(2));
  const sellerCostFloor =
    tenantAgentId && isPlatformProduct
      ? Number((selectedSpec.price * qty * (sellerDiscount ?? 0.9)).toFixed(2))
      : 0;

  let couponCodeApplied: string | null = null;
  let couponDiscount = 0;
  let couponIdClaimed: number | null = null;

  if (couponCode?.trim()) {
    if (buyerAgentForWholesale) {
      throw Errors.validation('代理批发拿货价订单不支持叠加使用零售优惠券');
    }
    const cpn = await findActiveCouponForOrder(db, couponCode.trim(), tenantAgentId ?? 0);
    if (!cpn) throw Errors.validation('优惠券不存在或已失效');
    if (cpn.maxUses > 0 && cpn.usedCount >= cpn.maxUses) throw Errors.validation('该优惠券已领完');
    if (cpn.expiresAt && new Date(cpn.expiresAt).getTime() < Date.now()) {
      throw Errors.validation('该优惠券已过期');
    }
    if (rawOrderSubtotal < cpn.minOrderAmount) {
      throw Errors.validation(`需满 ¥${cpn.minOrderAmount} 才可使用该优惠券`);
    }
    if (cpn.discountType === 'percent') {
      const pct = Math.min(90, Math.max(1, Number(cpn.discountValue || 0)));
      couponDiscount = Number(((rawOrderSubtotal * pct) / 100).toFixed(2));
    } else {
      couponDiscount = Number(
        Math.min(rawOrderSubtotal - 0.01, Math.max(0, Number(cpn.discountValue || 0))).toFixed(2)
      );
    }
    // 分站代销平台商品时，优惠券折扣仅可让利站长自身毛利，严禁击穿拿货底价
    if (tenantAgentId && isPlatformProduct) {
      const maxMarginDiscount = Math.max(0, Number((rawOrderSubtotal - sellerCostFloor).toFixed(2)));
      if (maxMarginDiscount <= 0) {
        throw Errors.validation('当前商品已接近拿货底价，无法叠加该分站优惠券');
      }
      couponDiscount = Math.min(couponDiscount, maxMarginDiscount);
    }
    couponCodeApplied = cpn.code;
    couponIdClaimed = cpn.id;
  }

  const totalAmount = Math.max(0.01, Number((rawOrderSubtotal - couponDiscount).toFixed(2)));
  const discountAmount = Math.max(0, Number(((retailUnit - unitPrice) * qty + couponDiscount).toFixed(2)));

  return {
    retailUnit,
    unitPrice,
    totalAmount,
    sellerCostFloor,
    discountAmount,
    couponCodeApplied,
    couponDiscount,
    couponIdClaimed,
    buyerAgentForWholesale,
    appliedBulkTier,
  };
}
