import { roundCurrency } from '@shared/domain/money';
import { computePaymentFee, parsePaymentFeeRatePct } from '@shared/domain/payment-plugin-settings';
import { and, eq } from 'drizzle-orm';
import { type ProductRow, paymentPlugins, tenantPaymentPlugins } from '../../db/schema/index';
import type { AuthUser } from '../../db/types';
import type { Env } from '../../env';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { isAsyncPaymentProvider } from '../payment/payment.gateway';
import { updateOrderFulfillmentResult } from '../payment/payment.order.repo';
import type { PaymentFulfillLease } from '../payment/payment.repo';
import { evaluatePreFulfillmentRisk } from '../risk/risk.service';

/** 提取买家真实 IP（兼容 Cloudflare 边缘与反向代理头部） */
export function extractClientIp(req: Request): string {
  const cf = (req.headers.get('CF-Connecting-IP') || '').trim();
  if (cf) return cf.slice(0, 64);
  const xff = (req.headers.get('X-Forwarded-For') || '').split(',')[0]?.trim() || '';
  if (xff) return xff.slice(0, 64);
  return '127.0.0.1';
}

/** 校验单商品级风控购买规则：访问口令、强制登录、最低起购件数、单笔限购件数 */
export function assertProductPurchaseRules(
  product: Pick<ProductRow, 'minQuantity' | 'maxQuantity' | 'requireLogin' | 'accessPassword'>,
  qty: number,
  user: AuthUser | null,
  accessCode?: string
): void {
  const requiredPwd = (product.accessPassword || '').trim();
  if (requiredPwd && (accessCode || '').trim() !== requiredPwd) {
    throw Errors.forbidden('该商品需要专属访问口令才可购买，请输入正确口令后再下单');
  }
  if (Number(product.requireLogin || 0) === 1 && !user) {
    throw Errors.unauthorized('该商品开启了仅限登录会员购买，请先登录后再下单');
  }
  const minQty = Math.max(1, Number(product.minQuantity || 1));
  const maxQty = Math.max(0, Number(product.maxQuantity || 0));
  if (qty < minQty) {
    throw Errors.validation(`该商品最低起购 ${minQty} 件，请调高购买数量`);
  }
  if (maxQty > 0 && qty > maxQty) {
    throw Errors.validation(`该商品单笔限购 ${maxQty} 件，请调低购买数量`);
  }
}

/**
 * 计算在线支付通道买家附加手续费（主站与分站自有收款各自独立配置；绝不计入代理分润基数）：
 * - 站内余额与全额推广金固定 0 附加费；
 * - 网关实收 = 商品折后实付 + 通道附加费。
 */
export async function resolveChannelPaymentFee(
  db: AppDatabase,
  paymentMethod: string,
  paymentOwnerAgentId: number,
  goodsPayableAmount: number
): Promise<{ feeRatePct: number; feeAmount: number; gatewayPayAmount: number }> {
  const base = Math.max(0, roundCurrency(goodsPayableAmount));
  if (base <= 0 || !isAsyncPaymentProvider(paymentMethod)) {
    return { feeRatePct: 0, feeAmount: 0, gatewayPayAmount: base };
  }
  let configJson: string | null = null;
  if (paymentOwnerAgentId > 0) {
    const rows = await db
      .select({ configJson: tenantPaymentPlugins.configJson })
      .from(tenantPaymentPlugins)
      .where(
        and(
          eq(tenantPaymentPlugins.ownerAgentId, paymentOwnerAgentId),
          eq(tenantPaymentPlugins.pluginId, paymentMethod)
        )
      )
      .limit(1);
    configJson = rows[0]?.configJson ?? null;
  } else {
    const rows = await db
      .select({ configJson: paymentPlugins.configJson })
      .from(paymentPlugins)
      .where(eq(paymentPlugins.id, paymentMethod))
      .limit(1);
    configJson = rows[0]?.configJson ?? null;
  }

  const feeRatePct = parsePaymentFeeRatePct(configJson);
  const feeAmount = computePaymentFee(base, feeRatePct);
  return {
    feeRatePct,
    feeAmount,
    gatewayPayAmount: roundCurrency(base + feeAmount),
  };
}

import { finalizeProcessingOrderCas } from './orders.repo';

/** 即时支付订单履约前 5 维风控闸：Bug/0元购回滚拒单，高频/大额/暂停发卡转 risk_review 并返回待审态 */
export async function evaluateAndHoldInstantOrderRisk(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    buyerIp: string;
    contactEmail: string;
    goodsTotal: number;
    promoUsed: number;
    quantity: number;
    unitCost: number | null;
    usesUpstream: boolean;
    guard?: import('drizzle-orm').SQL;
    rollbackOnBlock: () => Promise<void>;
  }
): Promise<{ held: false } | { held: true; reason: string }> {
  const verdict = await evaluatePreFulfillmentRisk(env, db, {
    orderNo: params.orderNo,
    buyerIp: params.buyerIp,
    contactEmail: params.contactEmail,
    goodsTotal: params.goodsTotal,
    promoUsed: params.promoUsed,
    quantity: params.quantity,
    unitCost: params.unitCost,
    usesUpstream: params.usesUpstream,
  });
  if (verdict.action === 'allow') return { held: false };
  if (verdict.action === 'block_bug') {
    await params.rollbackOnBlock();
    throw Errors.forbidden(verdict.reason);
  }
  await finalizeProcessingOrderCas(
    db,
    params.orderNo,
    { status: 'risk_review', riskFlag: verdict.code, riskNote: verdict.reason, deliveredPayload: '' },
    params.guard ? { guard: params.guard, clearStock: true } : undefined
  );
  return { held: true, reason: verdict.reason };
}

export function buildHeldRiskOrderResponse(params: {
  orderNo: string;
  publicNo: string;
  isLoggedIn: boolean;
  productTitle: string;
  specName: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  discountAmount: number;
  promoUsedAmount: number;
  reason: string;
  email: string;
  paymentMethod: string;
  warranty: unknown;
  balance: number | undefined;
}) {
  return {
    order: {
      order_no: params.isLoggedIn ? params.orderNo : params.publicNo,
      public_order_no: params.publicNo,
      product_title: params.productTitle,
      spec_name: params.specName,
      quantity: params.qty,
      unit_price: params.unitPrice,
      total_amount: params.totalAmount,
      discount_amount: params.discountAmount,
      promo_used_amount: params.promoUsedAmount,
      status: 'risk_review',
      risk_note: params.reason,
      contact_email: params.email,
      payment_method: params.paymentMethod,
      payment_message: params.reason,
      delivered_payload: '',
      warranty: params.warranty,
      created_at: new Date().toISOString(),
    },
    balance: params.balance,
  };
}

/** 异步收银台付款回调履约前 5 维风控闸：命中熔断时安全保留款项并转 risk_review，绝不吐出卡密 */
export async function holdAsyncOrderIfRisky(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    buyerIp: string;
    contactEmail: string;
    totalAmount: number;
    promoUsed: number;
    qty: number;
    unitCost: number | null;
    usesUpstream: boolean;
    lease: PaymentFulfillLease;
    renewLease: () => Promise<void>;
  }
): Promise<boolean> {
  const verdict = await evaluatePreFulfillmentRisk(env, db, {
    orderNo: params.orderNo,
    buyerIp: params.buyerIp,
    contactEmail: params.contactEmail,
    goodsTotal: params.totalAmount,
    promoUsed: params.promoUsed,
    quantity: params.qty,
    unitCost: params.unitCost,
    usesUpstream: params.usesUpstream,
  });
  if (verdict.action === 'allow') return false;
  await params.renewLease();
  await updateOrderFulfillmentResult(
    db,
    params.orderNo,
    {
      status: 'risk_review',
      deliveredPayload: '',
      commissionAmount: 0,
      fulfillmentSource: 'local',
      upstreamSourceId: null,
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      upstreamStatus: 'none',
      upstreamError: verdict.reason,
      riskFlag: verdict.code,
      riskNote: verdict.reason,
    },
    params.lease
  );
  return true;
}
