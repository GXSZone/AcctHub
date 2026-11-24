import { type BundleItemRule, evaluateFlashSale, normalizeBundleItems } from '@shared/domain/commerce-modes';
import type { SQL } from 'drizzle-orm';
import type { ProductRow } from '../../db/schema/index';
import type { AuthUser, ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { getUserBalance } from '../account/wallet.repo';
import { checkSpecAvailability, type SpecAvailabilityResult } from '../fulfillment/fulfillment.service';
import { fulfillBundleCardsAtomically, resolveBundleStockAndTitles } from './bundle.service';
import { fulfillSelectedCardAtomically, validateSelectedCardForCheckout } from './card-selection.service';
import { claimFlashSaleQuotaAtomicRepo } from './group-buy.repo';
import { commitPaidGroupBuyOrder, validateGroupBuyCheckout } from './group-buy.service';

export { fulfillSelectedCardAtomically };

export interface CheckoutCommerceContext {
  bundleItems: BundleItemRule[];
  isFlashSaleActive: boolean;
  flashSalePrice: number | null;
  groupBuyMode?: 'start' | 'join';
  groupBuyCode?: string;
  groupBuyUnitPrice: number | null;
  selectedCardId: number | null;
  cardSelectFee: number;
}

/** 零售下单前统一解析组合套餐、限时秒杀、卡密预选加价与拼团合租规则 */
export async function resolveCheckoutCommerceContext(
  db: AppDatabase,
  params: {
    siteAgentId: number;
    product: ProductRow;
    specId: string;
    qty: number;
    user: AuthUser | null;
    groupBuyMode?: 'start' | 'join';
    groupBuyCode?: string;
    selectedCardId?: number;
  }
): Promise<CheckoutCommerceContext> {
  const bundleItems = normalizeBundleItems(params.product.bundleItemsJson);
  const flash = evaluateFlashSale({
    flashSalePrice: params.product.flashSalePrice,
    flashSaleStartAt: params.product.flashSaleStartAt,
    flashSaleEndAt: params.product.flashSaleEndAt,
    flashSaleLimit: params.product.flashSaleLimit,
    flashSaleSold: params.product.flashSaleSold,
  });

  if (params.groupBuyMode) {
    const gb = await validateGroupBuyCheckout(db, {
      siteAgentId: params.siteAgentId,
      product: params.product,
      specId: params.specId,
      qty: params.qty,
      user: params.user,
      mode: params.groupBuyMode,
      code: params.groupBuyCode,
    });
    return {
      bundleItems,
      isFlashSaleActive: false,
      flashSalePrice: null,
      groupBuyMode: params.groupBuyMode,
      groupBuyCode: params.groupBuyCode,
      groupBuyUnitPrice: gb.groupPrice,
      selectedCardId: null,
      cardSelectFee: 0,
    };
  }

  const sel = await validateSelectedCardForCheckout(db, {
    product: params.product,
    specId: params.specId,
    qty: params.qty,
    selectedCardId: params.selectedCardId,
  });

  if (flash.status === 'active' && flash.limit > 0 && (flash.remaining ?? 0) < params.qty) {
    throw Errors.conflict(`限时秒杀剩余名额仅剩 ${flash.remaining ?? 0} 件，请调低购买数量`);
  }

  return {
    bundleItems,
    isFlashSaleActive: flash.status === 'active' && Boolean(flash.price),
    flashSalePrice: flash.status === 'active' ? flash.price : null,
    groupBuyUnitPrice: null,
    selectedCardId: sel.selectedCardId,
    cardSelectFee: sel.selectFee,
  };
}

/** 统一下单前库存预检（组合套餐按子商品实时套数计算，普通商品走既有规格预检） */
export async function checkOrderAvailabilityWithBundle(
  env: Env,
  db: AppDatabase,
  params: {
    product: ProductRow;
    selectedSpec: ProductSpec;
    specsCount: number;
    qty: number;
    bundleItems: BundleItemRule[];
  }
): Promise<SpecAvailabilityResult> {
  if (params.bundleItems.length > 0) {
    const info = await resolveBundleStockAndTitles(db, params.bundleItems);
    if (info.maxSets < params.qty) {
      return {
        localCardAvail: info.maxSets,
        hasHealthyUpstream: false,
        forceUpstreamOnly: false,
        available: false,
        errorMessage: `组合套餐当前仅剩 ${info.maxSets} 套可用库存，请调低数量或稍后再试`,
      };
    }
    return {
      localCardAvail: info.maxSets,
      hasHealthyUpstream: false,
      forceUpstreamOnly: false,
      available: true,
    };
  }
  return checkSpecAvailability(env, {
    productId: params.product.id,
    productOwnerAgentId: params.product.ownerAgentId,
    spec: params.selectedSpec,
    specsCount: params.specsCount,
    quantity: params.qty,
    stockMode: params.product.stockMode || 'cards',
    deliveryType: params.product.deliveryType || 'auto',
    manualStock: params.product.manualStock || 0,
    seatTotal: params.product.seatTotal || 5,
    seatUsed: params.product.seatUsed || 0,
  });
}

/** 组合套餐原子履约适配器（返回与 UnifiedFulfillmentResult 同构对象） */
export async function executeBundleFulfillment(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    productId: number;
    bundleItems: BundleItemRule[];
    qty: number;
    guard?: SQL;
    renewLease?: () => Promise<void>;
  }
) {
  const res = await fulfillBundleCardsAtomically(env, db, {
    orderNo: params.orderNo,
    bundleProductId: params.productId,
    bundleItems: params.bundleItems,
    quantity: params.qty,
    guard: params.guard,
    renewLease: params.renewLease,
  });
  if (!res.ok) {
    return {
      ok: false as const,
      conflictError: res.error,
      deliveredLines: [] as string[],
      orderStatus: 'fulfillment_failed' as const,
      fulfillmentSource: 'local' as const,
      upstreamSourceId: null,
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      upstreamStatus: 'none' as const,
      upstreamError: res.error,
    };
  }
  return {
    ok: true as const,
    deliveredLines: res.deliveredLines,
    orderStatus: 'delivered' as const,
    fulfillmentSource: 'local' as const,
    upstreamSourceId: null,
    upstreamOrderNo: '',
    upstreamCostTotal: 0,
    upstreamStatus: 'none' as const,
    upstreamError: '',
  };
}

/** 秒杀限量原子占位（成交后调用） */
export async function recordFlashSalePurchaseIfNeeded(
  db: AppDatabase,
  productId: number,
  qty: number,
  isFlashSale: boolean
): Promise<boolean> {
  if (!isFlashSale) return true;
  return claimFlashSaleQuotaAtomicRepo(db, productId, qty);
}

/** 即时支付拼团单收尾：入团/成团发卡并组装标准订单响应 */
export async function finalizeInstantGroupBuyOrder(
  env: Env,
  db: AppDatabase,
  params: {
    siteAgentId: number;
    product: ProductRow;
    specId: string;
    specName: string;
    effectiveProductTitle: string;
    orderNo: string;
    publicNo: string;
    user: AuthUser;
    email: string;
    qty: number;
    unitPrice: number;
    totalAmount: number;
    discountAmount: number;
    promoUsedAmount: number;
    paymentMethod: string;
    paymentRef: string;
    paymentMessage: string;
    mode: 'start' | 'join';
    groupBuyCode?: string;
    originUrl: string;
    warranty: unknown;
  }
) {
  const gbRes = await commitPaidGroupBuyOrder(env, db, {
    siteAgentId: params.siteAgentId,
    product: params.product,
    specId: params.specId,
    orderNo: params.orderNo,
    user: { id: params.user.id, displayName: params.user.display_name, email: params.user.email },
    contactEmail: params.email,
    paidAmount: params.totalAmount,
    promoUsedAmount: params.promoUsedAmount,
    mode: params.mode,
    groupBuyCode: params.groupBuyCode,
    originUrl: params.originUrl,
  });
  return {
    order: {
      order_no: params.orderNo,
      public_order_no: params.publicNo,
      product_title: params.effectiveProductTitle,
      spec_name: params.specName,
      quantity: params.qty,
      unit_price: params.unitPrice,
      total_amount: params.totalAmount,
      discount_amount: params.discountAmount,
      promo_used_amount: params.promoUsedAmount,
      status: gbRes.finalOrderStatus,
      contact_email: params.email,
      payment_method: params.paymentMethod,
      payment_reference: params.paymentRef,
      payment_message: params.paymentMessage,
      delivered_payload: gbRes.finalOrderStatus === 'delivered' ? gbRes.deliveredPayload : '',
      group_buy_session: gbRes.session,
      warranty: params.warranty,
      created_at: new Date().toISOString(),
    },
    balance: await getUserBalance(db, params.user.id),
  };
}
