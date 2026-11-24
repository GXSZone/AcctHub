import type { AsyncPaymentProvider } from '@shared/constants/enums';
import { roundCurrency } from '@shared/domain/money';
import type { OrderWarrantyStatus } from '@shared/domain/warranty';
import type { AuthUser } from '../../db/types';
import { type Env, isSandboxEnabled } from '../../env';
import { generateBizNo } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { reservePromoBalanceForOrder } from '../account/affiliate.service';
import { isInternalSandboxIntent } from '../payment/payment.provenance';
import { createPaymentIntent, type PaymentIntentRow } from '../payment/payment.service';
import { claimOrderSlotAtomic, releaseAbortedOrderSlotRepo, updateOrderSlotMetaRepo } from './orders.repo';
import { requestImmediateOrderAbort } from './orders.wallet.repo';

/** 在资金和履约操作前原子占位。幂等冲突由上层经过授权后处理。 */
export async function claimRetailOrderSlotWithIdem(
  db: AppDatabase,
  params: {
    user: AuthUser | null;
    tenantAgentId: number | null;
    tenantSlug: string | null;
    lookupUrl: string;
    email: string;
    queryPasswordHash: string | null;
    checkoutSecretHash: string | null;
    checkoutPayloadHash: string | null;
    productId: number;
    productOwnerAgentId?: number;
    settlementMode?: string;
    effectiveProductTitle: string;
    specId: string;
    specName: string;
    qty: number;
    unitPrice: number;
    totalAmount: number;
    discountAmount: number;
    couponCodeApplied: string | null;
    couponDiscount: number;
    paymentMethod: string;
    buyerIp?: string;
    paymentFeeAmount?: number;
    customInputs: Record<string, string>;
    idemKey: string;
    orderWarranty: OrderWarrantyStatus;
  }
): Promise<{ orderNo: string; publicNo: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateNo = generateBizNo('AH');
    const publicNo = `AHQ-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')}`;
    const claim = await claimOrderSlotAtomic(db, {
      orderNo: candidateNo,
      userId: params.user?.id ?? null,
      agentId: params.tenantAgentId,
      tenantSlug: params.tenantSlug,
      contactEmail: params.email,
      buyerIp: params.buyerIp ?? '',
      publicOrderNo: publicNo,
      lookupUrl: params.lookupUrl,
      queryPasswordHash: params.queryPasswordHash,
      checkoutSecretHash: params.checkoutSecretHash,
      checkoutPayloadHash: params.checkoutPayloadHash,
      productId: params.productId,
      productOwnerAgentId: params.productOwnerAgentId ?? 0,
      settlementMode: params.settlementMode ?? 'platform_collect',
      productTitle: params.effectiveProductTitle,
      specId: params.specId,
      specName: params.specName,
      quantity: params.qty,
      unitPrice: params.unitPrice,
      totalAmount: params.totalAmount,
      paymentFeeAmount: params.paymentFeeAmount ?? 0,
      discountAmount: params.discountAmount,
      couponCode: params.couponCodeApplied,
      couponDiscount: params.couponDiscount,
      promoUsedAmount: 0,
      commissionAmount: 0,
      paymentMethod: params.paymentMethod,
      channel: 'web',
      status: 'processing',
      customInputsJson: JSON.stringify(params.customInputs),
      deliveredPayload: '',
      idempotencyKey: params.idemKey || null,
      warrantyType: params.orderWarranty.warranty_type,
      warrantyDays: params.orderWarranty.warranty_days,
      warrantySummary: params.orderWarranty.warranty_summary,
    });
    if (claim.claimed) return { orderNo: candidateNo, publicNo };
    if (claim.reason === 'idempotency') return null;
  }
  throw Errors.conflict('订单号分配冲突，请重试下单');
}

/** 为本次订单试算并预扣不可提现推广消费金，返回实际抵扣额与剩余需支付现金额 */
export async function applyOrderPromoDiscount(
  db: AppDatabase,
  params: {
    user: AuthUser | null;
    usePromoBalance?: boolean;
    payableAmount: number;
    maxDeductibleAmount?: number;
    orderNo: string;
    productTitle: string;
  }
): Promise<{ promoUsedAmount: number; netTotalAmount: number }> {
  const basePayable = Math.max(0, roundCurrency(params.payableAmount));
  const deductibleCap =
    params.maxDeductibleAmount !== undefined
      ? Math.max(0, Math.min(basePayable, roundCurrency(params.maxDeductibleAmount)))
      : basePayable;
  if (!params.usePromoBalance || !params.user || deductibleCap <= 0) {
    return { promoUsedAmount: 0, netTotalAmount: basePayable };
  }

  const promoUsedAmount = await reservePromoBalanceForOrder(db, {
    userId: params.user.id,
    maxPayableAmount: deductibleCap,
    orderNo: params.orderNo,
    productTitle: params.productTitle,
  });
  const netTotalAmount = Math.max(0, roundCurrency(basePayable - promoUsedAmount));
  return { promoUsedAmount, netTotalAmount };
}

/** 基于已抢占的占位订单创建异步收银台支付单并推进为 pending_payment（失败时回滚推广金并清理占位单） */
export async function createPendingAsyncGatewayOrder(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    publicNo: string;
    lookupUrl: string;
    reqOrigin: string;
    user: AuthUser | null;
    currentSiteAgentId: number;
    paymentOwnerAgentId?: number;
    settlementMode?: 'platform_collect' | 'tenant_direct_collect';
    paymentMethod: AsyncPaymentProvider;
    email: string;
    effectiveProductTitle: string;
    specName: string;
    qty: number;
    unitPrice: number;
    totalAmount: number;
    paymentFeeAmount?: number;
    discountAmount: number;
    couponCodeApplied: string | null;
    couponDiscount: number;
    promoUsedAmount: number;
    buyerWholesaleAgentId: number;
    fulfillment: {
      specId: string;
      stockMode: string;
      deliveryType: string;
      upstreamOnly: boolean;
      mainUnitPrice: number;
      isFlashSale?: boolean;
      groupBuyMode?: 'start' | 'join';
      groupBuyCode?: string;
      selectedCardId?: number;
    };
    orderWarranty: OrderWarrantyStatus;
  }
) {
  const paymentFeeAmount = Math.max(0, roundCurrency(params.paymentFeeAmount ?? 0));
  const gatewayPayAmount = roundCurrency(params.totalAmount + paymentFeeAmount);
  let intent: PaymentIntentRow;
  try {
    intent = await createPaymentIntent(env, {
      bizType: 'order',
      bizRef: params.orderNo,
      userId: params.user?.id ?? null,
      siteAgentId: params.currentSiteAgentId,
      paymentOwnerAgentId: params.paymentOwnerAgentId ?? 0,
      settlementMode: params.settlementMode ?? 'platform_collect',
      provider: params.paymentMethod,
      amountCny: gatewayPayAmount,
      subject: `${params.effectiveProductTitle} (${params.specName}) × ${params.qty}`,
      originUrl: params.reqOrigin,
      returnUrl: params.lookupUrl,
      customerEmail: params.email,
      payload: {
        buyer_wholesale_agent_id: params.buyerWholesaleAgentId,
        payment_fee_amount: paymentFeeAmount,
        fulfillment: params.fulfillment,
      },
    });
  } catch (err) {
    await requestImmediateOrderAbort(db, params.orderNo);
    await releaseAbortedOrderSlotRepo(db, params.orderNo, 'processing').catch(() => undefined);
    throw err;
  }

  await updateOrderSlotMetaRepo(db, params.orderNo, {
    status: 'pending_payment',
    totalAmount: params.totalAmount,
    paymentFeeAmount,
    promoUsedAmount: params.promoUsedAmount,
    paymentMethod: params.paymentMethod,
    paymentIntentNo: intent.intent_no,
    paymentExpiresAt: intent.expires_at,
  });

  return {
    requires_payment: true,
    order: {
      order_no: params.user ? params.orderNo : params.publicNo,
      public_order_no: params.publicNo,
      product_title: params.effectiveProductTitle,
      spec_name: params.specName,
      quantity: params.qty,
      unit_price: params.unitPrice,
      total_amount: params.totalAmount,
      payment_fee_amount: paymentFeeAmount,
      discount_amount: params.discountAmount,
      coupon_code: params.couponCodeApplied,
      coupon_discount: params.couponDiscount,
      promo_used_amount: params.promoUsedAmount,
      payment_method: params.paymentMethod,
      status: 'pending_payment',
      contact_email: params.email,
      delivered_payload: '',
      warranty: params.orderWarranty,
      created_at: new Date().toISOString(),
    },
    payment_intent: presentCashierIntent(env, intent),
  };
}

export function presentCashierIntent(env: Env, intent: PaymentIntentRow, viewToken = intent.view_token) {
  return {
    intent_no: intent.intent_no,
    provider: intent.provider,
    currency: intent.currency,
    amount_cny: intent.amount_cny,
    pay_amount: intent.pay_amount,
    pay_url: intent.pay_url,
    qr_content: intent.qr_content,
    status: intent.status,
    fulfill_status: intent.fulfill_status,
    biz_type: intent.biz_type,
    expires_at: intent.expires_at,
    sandbox_simulated: isSandboxEnabled(env) && isInternalSandboxIntent(intent),
    view_token: viewToken,
  };
}
