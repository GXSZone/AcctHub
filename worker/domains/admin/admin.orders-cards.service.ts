import type {
  adminManualConfirmOrderSchema,
  adminOrdersSearchQuerySchema,
} from '@shared/contracts/risk.contract';
import type { z } from 'zod';

type AdminOrderSearchQuery = z.infer<typeof adminOrdersSearchQuerySchema>;
type AdminManualConfirmOrderInput = z.infer<typeof adminManualConfirmOrderSchema>;

import { roundCurrency } from '@shared/domain/money';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { orders, paymentIntents } from '../../db/schema/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { readDeliveryPayload, sealDeliveryPayload } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { dispatchOrderDeliveryEmail } from '../../infra/mail';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { settleOrderProfitDispatch } from '../agent/settlement.service';
import { checkSpecAvailability, executeUnifiedFulfillment } from '../fulfillment/fulfillment.service';
import { findOrderByNo, findProductById, resolveSiteBrandName } from '../payment/payment.order.repo';

/** 总控订单高级检索（支持单号/邮箱/买家 IP 搜索，以及状态、支付方式筛选与分页） */
export async function searchAdminOrders(env: Env, query: AdminOrderSearchQuery) {
  const db = createDb(env.DB);
  const conds = [];
  if (query.q) {
    const pattern = `%${query.q.toLowerCase()}%`;
    conds.push(
      or(
        sql`lower(${orders.orderNo}) LIKE ${pattern}`,
        sql`lower(${orders.publicOrderNo}) LIKE ${pattern}`,
        sql`lower(${orders.contactEmail}) LIKE ${pattern}`,
        sql`lower(${orders.buyerIp}) LIKE ${pattern}`,
        sql`lower(${orders.productTitle}) LIKE ${pattern}`
      )
    );
  }
  if (query.status && query.status !== 'all') {
    conds.push(eq(orders.status, query.status));
  }
  if (query.payment_method && query.payment_method !== 'all') {
    conds.push(eq(orders.paymentMethod, query.payment_method));
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined;
  const pageSize = query.page_size;
  const offset = (query.page - 1) * pageSize;

  const [countRows, rows] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(orders).where(whereClause),
    db.select().from(orders).where(whereClause).orderBy(desc(orders.id)).limit(pageSize).offset(offset),
  ]);

  return {
    total: Number(countRows[0]?.c || 0),
    page: query.page,
    page_size: pageSize,
    items: rows.map((o) => ({
      id: o.id,
      order_no: o.orderNo,
      public_order_no: o.publicOrderNo,
      product_id: o.productId,
      product_title: o.productTitle,
      spec_id: o.specId,
      spec_name: o.specName,
      quantity: o.quantity,
      unit_price: o.unitPrice,
      total_amount: o.totalAmount,
      payment_fee_amount: Number(o.paymentFeeAmount || 0),
      discount_amount: o.discountAmount,
      promo_used_amount: o.promoUsedAmount,
      commission_amount: o.commissionAmount,
      contact_email: o.contactEmail,
      buyer_ip: o.buyerIp || '',
      payment_method: o.paymentMethod,
      channel: o.channel,
      status: o.status,
      risk_flag: o.riskFlag || '',
      risk_note: o.riskNote || '',
      fulfillment_source: o.fulfillmentSource,
      upstream_error: o.upstreamError,
      agent_id: o.agentId,
      tenant_slug: o.tenantSlug,
      created_at: o.createdAt,
    })),
  };
}

/** 总控订单完整详情（含解密已发卡密、买家自定义表单、买家 IP、风控原因与支付流水） */
export async function getAdminOrderDetail(env: Env, orderNo: string) {
  const db = createDb(env.DB);
  const order = await findOrderByNo(db, orderNo);
  if (!order) throw Errors.notFound('订单不存在');
  const [deliveredPlain, intentRows] = await Promise.all([
    order.deliveredPayload
      ? readDeliveryPayload(env, order.orderNo, order.deliveredPayload)
      : Promise.resolve(''),
    order.paymentIntentNo
      ? db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, order.paymentIntentNo)).limit(1)
      : Promise.resolve([]),
  ]);
  const intent = intentRows[0] ?? null;

  return {
    order: {
      id: order.id,
      order_no: order.orderNo,
      public_order_no: order.publicOrderNo,
      user_id: order.userId,
      agent_id: order.agentId,
      tenant_slug: order.tenantSlug,
      product_id: order.productId,
      product_owner_agent_id: order.productOwnerAgentId,
      product_title: order.productTitle,
      spec_id: order.specId,
      spec_name: order.specName,
      quantity: order.quantity,
      unit_price: order.unitPrice,
      total_amount: order.totalAmount,
      payment_fee_amount: Number(order.paymentFeeAmount || 0),
      discount_amount: order.discountAmount,
      coupon_code: order.couponCode,
      coupon_discount: order.couponDiscount,
      promo_used_amount: order.promoUsedAmount,
      commission_amount: order.commissionAmount,
      contact_email: order.contactEmail,
      buyer_ip: order.buyerIp || '',
      payment_method: order.paymentMethod,
      settlement_mode: order.settlementMode,
      channel: order.channel,
      status: order.status,
      risk_flag: order.riskFlag || '',
      risk_note: order.riskNote || '',
      fulfillment_source: order.fulfillmentSource,
      upstream_order_no: order.upstreamOrderNo,
      upstream_cost_total: order.upstreamCostTotal,
      upstream_status: order.upstreamStatus,
      upstream_error: order.upstreamError,
      custom_inputs: safeJsonParse<Record<string, string>>(order.customInputsJson || '{}', {}),
      delivered_payload: deliveredPlain,
      warranty_type: order.warrantyType,
      warranty_days: order.warrantyDays,
      warranty_summary: order.warrantySummary,
      created_at: order.createdAt,
    },
    payment_intent: intent
      ? {
          intent_no: intent.intentNo,
          provider: intent.provider,
          currency: intent.currency,
          amount_cny: intent.amountCny,
          pay_amount: intent.payAmount,
          status: intent.status,
          fulfill_status: intent.fulfillStatus,
          provider_trade_no: intent.providerTradeNo,
          paid_at: intent.paidAt,
          created_at: intent.createdAt,
        }
      : null,
  };
}

/** 内部通用：将待发/待审/掉单推进为自动发卡或人工发货交付，并结清代理分润与发卡邮件 */
async function executeAdminOrderFulfill(
  env: Env,
  actor: AuditActorContext,
  orderNo: string,
  originUrl: string,
  options: {
    allowedStatuses: string[];
    manualPayload?: string;
    note?: string;
    actionName: string;
  }
) {
  const db = createDb(env.DB);
  const order = await findOrderByNo(db, orderNo);
  if (!order) throw Errors.notFound('订单不存在');
  if (!options.allowedStatuses.includes(order.status)) {
    throw Errors.conflict(`订单当前状态为 ${order.status}，不支持该操作`);
  }

  const product = await findProductById(db, order.productId);
  const qty = Math.max(1, Number(order.quantity || 1));
  const manualText = (options.manualPayload || '').trim();

  // CAS 锁单至 processing 防止多管理员并发重复放行/补发
  const locked = await db
    .update(orders)
    .set({ status: 'processing' })
    .where(and(eq(orders.orderNo, order.orderNo), inArray(orders.status, options.allowedStatuses)))
    .returning({ id: orders.id });
  if (locked.length !== 1) throw Errors.conflict('订单状态已被其他操作并发变更，请刷新后重试');

  let finalStatus = 'delivered';
  let deliveredPlain = manualText;
  let fulfillmentSource: 'local' | 'upstream' = 'local';
  let upstreamSourceId: number | null = null;
  let upstreamOrderNo = '';
  let upstreamCostTotal = 0;
  let upstreamStatus = 'none';
  let upstreamError = '';

  if (!manualText) {
    if (!product) {
      await db.update(orders).set({ status: order.status }).where(eq(orders.orderNo, order.orderNo));
      throw Errors.notFound('商品已被删除，无法自动扣库发卡，请改填自定义发货凭证');
    }
    const specs = safeJsonParse<ProductSpec[]>(product.specsJson || '[]', []);
    const spec = specs.find((s) => s.id === (order.specId || 'default')) ??
      specs[0] ?? {
        id: order.specId || 'default',
        name: order.specName || '标准版',
        price: product.basePrice,
      };
    const availability = await checkSpecAvailability(env, {
      productId: product.id,
      productOwnerAgentId: product.ownerAgentId,
      spec,
      specsCount: specs.length,
      quantity: qty,
      stockMode: product.stockMode || 'cards',
      deliveryType: product.deliveryType || 'auto',
      manualStock: product.manualStock || 0,
      seatTotal: product.seatTotal || 5,
      seatUsed: product.seatUsed || 0,
    });
    if (!availability.available) {
      await db.update(orders).set({ status: order.status }).where(eq(orders.orderNo, order.orderNo));
      throw Errors.conflict(availability.errorMessage || '当前库存不足，请先补货或填写人工发货内容');
    }
    const fulfill = await executeUnifiedFulfillment(env, {
      orderNo: order.orderNo,
      channel: 'web',
      paymentMethod: order.paymentMethod || 'manual',
      productId: product.id,
      productOwnerAgentId: product.ownerAgentId,
      productTitle: order.productTitle,
      spec,
      specsCount: specs.length,
      quantity: qty,
      stockMode: product.stockMode || 'cards',
      deliveryType: 'auto',
      contactEmail: order.contactEmail,
      totalAmount: order.totalAmount,
      originUrl,
      customInputs: safeJsonParse<Record<string, string>>(order.customInputsJson || '{}', {}),
      availability,
    });
    if (!fulfill.ok) {
      await db.update(orders).set({ status: order.status }).where(eq(orders.orderNo, order.orderNo));
      throw Errors.conflict(fulfill.conflictError || '自动出卡失败');
    }
    finalStatus = fulfill.orderStatus;
    deliveredPlain = fulfill.deliveredLines.join('\n');
    fulfillmentSource = fulfill.fulfillmentSource;
    upstreamSourceId = fulfill.upstreamSourceId;
    upstreamOrderNo = fulfill.upstreamOrderNo;
    upstreamCostTotal = fulfill.upstreamCostTotal;
    upstreamStatus = fulfill.upstreamStatus;
    upstreamError = fulfill.upstreamError;
  }

  let commissionAmount = Number(order.commissionAmount || 0);
  if (
    commissionAmount === 0 &&
    order.settlementMode !== 'tenant_direct_collect' &&
    (finalStatus === 'delivered' || finalStatus === 'paid')
  ) {
    const specs = safeJsonParse<ProductSpec[]>(product?.specsJson || '[]', []);
    const spec = specs.find((s) => s.id === (order.specId || 'default')) ?? specs[0];
    const baseMainTotal = roundCurrency((spec?.price ?? order.unitPrice) * qty);
    commissionAmount = await settleOrderProfitDispatch({
      env,
      orderNo: order.orderNo,
      productOwnerAgentId: Number(order.productOwnerAgentId || product?.ownerAgentId || 0),
      buyerWholesaleAgentId: 0,
      sellingAgentId: order.agentId ? Number(order.agentId) : 0,
      baseMainTotal,
      totalAmount: order.totalAmount,
    });
  }

  const sealed = await sealDeliveryPayload(env, order.orderNo, deliveredPlain);
  await db
    .update(orders)
    .set({
      status: finalStatus,
      deliveredPayload: sealed,
      commissionAmount,
      fulfillmentSource,
      upstreamSourceId,
      upstreamOrderNo,
      upstreamCostTotal,
      upstreamStatus,
      upstreamError,
      riskNote: options.note
        ? `${order.riskNote ? `${order.riskNote} | ` : ''}[审核处理] ${options.note}`
        : order.riskNote,
    })
    .where(eq(orders.orderNo, order.orderNo));

  if (finalStatus === 'delivered' || finalStatus === 'paid') {
    await settleAffiliateRewardForOrder(env, order.orderNo).catch(() => undefined);
    const brandName = await resolveSiteBrandName(db, order.agentId ?? 0);
    await dispatchOrderDeliveryEmail(env, {
      ownerAgentId: order.agentId ?? 0,
      brandName,
      toEmail: order.contactEmail,
      orderNo: order.publicOrderNo || order.orderNo,
      productTitle: order.productTitle,
      specName: order.specName,
      quantity: qty,
      totalAmount: order.totalAmount,
      deliveredPayload: deliveredPlain,
      warrantySummary: order.warrantySummary || undefined,
      lookupUrl: order.lookupUrl || `${originUrl}/orders`,
      scene: 'order_delivery',
    }).catch(() => undefined);
  }

  await recordAdminAudit(db, actor, {
    action: options.actionName,
    targetType: 'order',
    targetId: order.id,
    summary: `订单 ${order.orderNo} 执行${manualText ? '人工发货' : '审核自动发卡'}（${order.status} → ${finalStatus}）${options.note ? `：${options.note}` : ''}`,
    before: { status: order.status },
    after: { status: finalStatus, manual: Boolean(manualText) },
  });

  return { ok: true, status: finalStatus, delivered_payload: deliveredPlain };
}

/** 风控待审订单一键放行并立即自动发卡 */
export async function approveRiskOrder(
  env: Env,
  actor: AuditActorContext,
  orderNo: string,
  originUrl: string,
  note?: string
) {
  return executeAdminOrderFulfill(env, actor, orderNo, originUrl, {
    allowedStatuses: ['risk_review'],
    note: note || '风控人工审核通过放行',
    actionName: 'order.approve_risk',
  });
}

/** 人工发货交付 / 支付掉单人工核账补单 */
export async function manualConfirmAdminOrder(
  env: Env,
  actor: AuditActorContext,
  orderNo: string,
  originUrl: string,
  input: AdminManualConfirmOrderInput
) {
  return executeAdminOrderFulfill(env, actor, orderNo, originUrl, {
    allowedStatuses: ['pending_payment', 'expired', 'paid', 'fulfillment_failed', 'risk_review'],
    manualPayload: input.manual_payload,
    note: input.note || '总控人工发货/掉单补单',
    actionName: 'order.manual_confirm',
  });
}

export { exportAvailableProductCardsTxt, lookupAdminCardsByContent } from './admin.cards-tools.service';
