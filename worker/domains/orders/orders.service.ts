import { roundCurrency } from '@shared/domain/money';
import { type CreateOrderInput, evaluateOrderWarranty } from '@shared/index';
import type { OrderRow } from '../../db/schema/index';
import type { Env, TenantContext } from '../../env';
import { readDeliveryPayload, sealDeliveryPayload } from '../../infra/credential-storage';
import { hashPassword } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { executePayment } from '../../infra/payment';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { getUserBalance } from '../account/wallet.repo';
import { settleOrderProfitDispatch } from '../agent/settlement.service';
import { isEmailBlacklisted } from '../auth/auth.repo';
import { getAuthUser } from '../auth/auth.service';
import {
  checkOrderAvailabilityWithBundle,
  executeBundleFulfillment,
  finalizeInstantGroupBuyOrder,
  fulfillSelectedCardAtomically,
  recordFlashSalePurchaseIfNeeded,
  resolveCheckoutCommerceContext,
} from '../commerce/commerce-checkout.helper';
import { executeUnifiedFulfillment } from '../fulfillment/fulfillment.service';
import { isAsyncPaymentProvider } from '../payment/payment.gateway';
import { assertOrderCreationAllowed } from '../risk/risk.service';
import { dispatchBusinessWebhookEvent } from '../webhooks/webhooks.service';
import { claimBalanceOrderCoupon, postBalanceOrderStock } from './orders.balance-recovery.repo';
import { loadRetailOrderProduct } from './orders.catalog';
import {
  assertGuestCheckoutAllowed,
  assertRetailPaymentMethodAvailable,
  prepareCheckoutInput,
  recoverCheckout,
} from './orders.checkout';
import { dispatchPostOrderNotifications } from './orders.notify';
import { resolveOrderPricing } from './orders.pricing';
import {
  applyOrderPromoDiscount,
  claimRetailOrderSlotWithIdem,
  createPendingAsyncGatewayOrder,
} from './orders.promo';
import {
  claimCouponUsageAtomic,
  finalizeProcessingOrderCas,
  findIdempotentOrder,
  releaseAbortedOrderSlotRepo,
  rollbackCouponUsage,
  updateOrderSlotMetaRepo,
} from './orders.repo';
import {
  assertProductPurchaseRules,
  buildHeldRiskOrderResponse,
  evaluateAndHoldInstantOrderRisk,
  extractClientIp,
  resolveChannelPaymentFee,
} from './orders.risk-fee';
import {
  balanceOrderActive,
  postBalanceOrderDebit,
  renewBalanceOrder,
  requestImmediateOrderAbort,
} from './orders.wallet.repo';

export { lookupRetailOrders } from './orders.lookup.service';

/** 创建零售或分站订单（L1 先抢占订单槽位再动用资金与库存 + 原子 CAS 防并发双花） */
export async function createRetailOrder(
  env: Env,
  req: Request,
  tenant: TenantContext,
  body: CreateOrderInput,
  scheduleBackground?: (p: Promise<unknown>) => void
) {
  void scheduleBackground;
  const user = await getAuthUser(req, env, tenant);
  const db = createDb(env.DB);
  const { email, qty, idemKey, queryPassword, paymentMethod, checkoutSecretHash, checkoutPayloadHash } =
    await prepareCheckoutInput(body, user);
  const tenantAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : null;
  const currentSiteAgentId = tenantAgentId ?? 0;
  const recover = (order: OrderRow) =>
    recoverCheckout(env, db, order, user, checkoutSecretHash, currentSiteAgentId, {
      payloadHash: checkoutPayloadHash,
      password: queryPassword,
    });

  const duplicate = idemKey ? await findIdempotentOrder(db, idemKey, email, tenantAgentId) : null;
  if (duplicate) return recover(duplicate);

  if (tenant.isSuspended) {
    throw Errors.forbidden('当前代理分站已暂停营业，暂时无法创建新订单');
  }
  const buyerIp = extractClientIp(req);
  if (await isEmailBlacklisted(db, email)) {
    throw Errors.forbidden('该邮箱已被列入平台黑名单，禁止下单购买');
  }
  await assertOrderCreationAllowed(env, db, { buyerIp, email });
  if (!user) {
    await assertGuestCheckoutAllowed(
      env,
      req,
      currentSiteAgentId,
      body['cf-turnstile-response'] || body.turnstile_token
    );
  }

  // 主站下单商品必属平台（owner=0），先校验渠道授权与可用性；分站下单需先查商品归属再执行双轨硬隔离路由
  const prechecked = !tenantAgentId
    ? await assertRetailPaymentMethodAvailable(env, db, paymentMethod, tenant, 0)
    : null;
  const { product, specs, selectedSpec, effectiveProductTitle } = await loadRetailOrderProduct(
    db,
    tenantAgentId,
    body
  );
  assertProductPurchaseRules(product, qty, user, body.access_code);
  const commerce = await resolveCheckoutCommerceContext(db, {
    siteAgentId: currentSiteAgentId,
    product,
    specId: selectedSpec.id,
    qty,
    user,
    groupBuyMode: body.group_buy_mode,
    groupBuyCode: body.group_buy_code,
    selectedCardId: body.selected_card_id,
  });
  const { paymentOwnerAgentId, settlementMode } =
    prechecked ??
    (await assertRetailPaymentMethodAvailable(env, db, paymentMethod, tenant, product.ownerAgentId));

  const pricing = await resolveOrderPricing(env, db, {
    tenant,
    user,
    productId: body.product_id,
    selectedSpec,
    specsCount: specs.length,
    qty,
    couponCode: body.coupon_code,
    tierPricingJson: product.tierPricingJson,
    productCostPrice: product.costPrice,
    productOwnerAgentId: product.ownerAgentId,
    baseProductPrice: product.basePrice,
    flashSaleActivePrice: commerce.flashSalePrice,
    groupBuyUnitPrice: commerce.groupBuyUnitPrice,
    memberPrice: product.memberPrice,
    extraSelectFee: commerce.cardSelectFee,
  });
  const {
    unitPrice,
    discountAmount,
    couponCodeApplied,
    couponDiscount,
    couponIdClaimed,
    buyerAgentForWholesale,
  } = pricing;

  // 5. 规格与组合套餐库存预检
  const stockMode = product.stockMode || 'cards';
  const deliveryType = product.deliveryType || 'auto';
  const availability = await checkOrderAvailabilityWithBundle(env, db, {
    product,
    selectedSpec,
    specsCount: specs.length,
    qty,
    bundleItems: commerce.bundleItems,
  });
  if (!availability.available) {
    throw Errors.conflict(availability.errorMessage || '当前库存不足');
  }

  const reqOrigin = new URL(req.url).origin;
  const lookupUrl = new URL('/orders', reqOrigin);
  const orderWarranty = evaluateOrderWarranty(new Date().toISOString(), {
    warranty_type: product.warrantyType,
    warranty_days: product.warrantyDays,
    warranty_summary: product.warrantySummary,
  });

  // 5A. L1 核心防线：在触碰任何资金与库存之前，先用 INSERT 唯一约束抢占 processing 占位单
  const slotRes = await claimRetailOrderSlotWithIdem(db, {
    user,
    tenantAgentId,
    tenantSlug: tenant.slug,
    lookupUrl: lookupUrl.toString(),
    email,
    queryPasswordHash: queryPassword ? await hashPassword(queryPassword) : null,
    checkoutSecretHash,
    checkoutPayloadHash,
    productId: body.product_id,
    productOwnerAgentId: product.ownerAgentId,
    settlementMode,
    effectiveProductTitle,
    specId: selectedSpec.id,
    specName: selectedSpec.name,
    qty,
    unitPrice,
    totalAmount: pricing.totalAmount,
    discountAmount,
    couponCodeApplied,
    couponDiscount,
    paymentMethod,
    buyerIp,
    customInputs: body.custom_inputs || {},
    idemKey,
    orderWarranty,
  });
  if (!slotRes) {
    const order = await findIdempotentOrder(db, idemKey, email, tenantAgentId);
    if (order) return recover(order);
    throw Errors.conflict('本次结账仍在处理，请稍候重试');
  }
  const { orderNo, publicNo } = slotRes;

  // 5B. 不可提现推广消费金试算与原子预扣（私有商品严禁使用平台推广消费金抵扣；分站代销仅可抵扣零售毛利，严禁击穿拿货底价）
  let promoUsedAmount = 0;
  let totalAmount = pricing.totalAmount;
  const maxDeductibleAmount =
    product.ownerAgentId > 0
      ? 0
      : tenantAgentId && !buyerAgentForWholesale
        ? Math.max(0, roundCurrency(pricing.totalAmount - pricing.sellerCostFloor))
        : pricing.totalAmount;
  try {
    const promoRes = await applyOrderPromoDiscount(db, {
      user,
      usePromoBalance: body.use_promo_balance,
      payableAmount: pricing.totalAmount,
      maxDeductibleAmount,
      orderNo,
      productTitle: effectiveProductTitle,
    });
    promoUsedAmount = promoRes.promoUsedAmount;
    totalAmount = promoRes.netTotalAmount;
  } catch (err) {
    await requestImmediateOrderAbort(db, orderNo);
    await releaseAbortedOrderSlotRepo(db, orderNo, 'processing').catch(() => undefined);
    throw err;
  }

  // 6A. 异步支付网关分支（仅当扣除推广金后仍需在线支付 >= 0.01 时发起网关收单；附加费率仅向买家收取，绝不计入代理分润）
  if (totalAmount > 0 && isAsyncPaymentProvider(paymentMethod)) {
    const feeInfo = await resolveChannelPaymentFee(db, paymentMethod, paymentOwnerAgentId, totalAmount);
    return createPendingAsyncGatewayOrder(env, db, {
      orderNo,
      publicNo,
      lookupUrl: lookupUrl.toString(),
      reqOrigin,
      user,
      currentSiteAgentId,
      paymentOwnerAgentId,
      settlementMode,
      paymentMethod,
      email,
      effectiveProductTitle,
      specName: selectedSpec.name,
      qty,
      unitPrice,
      totalAmount,
      paymentFeeAmount: feeInfo.feeAmount,
      discountAmount,
      couponCodeApplied,
      couponDiscount,
      promoUsedAmount,
      buyerWholesaleAgentId: buyerAgentForWholesale?.id ?? 0,
      fulfillment: {
        specId: selectedSpec.id,
        stockMode,
        deliveryType,
        upstreamOnly: availability.forceUpstreamOnly,
        mainUnitPrice: selectedSpec.price,
        isFlashSale: commerce.isFlashSaleActive,
        groupBuyMode: commerce.groupBuyMode,
        groupBuyCode: commerce.groupBuyCode,
        selectedCardId: commerce.selectedCardId ?? undefined,
      },
      orderWarranty,
    });
  }

  // 6B. 即时支付分支（站内余额 / 本地演示 / 全额推广金抵扣）：同步金额快照 → CAS 预占优惠券与余额 → 履约
  const effectivePayMethod = totalAmount <= 0 && promoUsedAmount > 0 ? 'promo_balance' : paymentMethod;
  await updateOrderSlotMetaRepo(db, orderNo, {
    totalAmount,
    promoUsedAmount,
    paymentMethod: effectivePayMethod,
  });

  const fundedByBalance = effectivePayMethod === 'balance' && totalAmount > 0;
  let couponClaimed = false;
  if (!fundedByBalance && couponIdClaimed !== null) {
    couponClaimed = await claimCouponUsageAtomic(db, couponIdClaimed);
    if (!couponClaimed) {
      await requestImmediateOrderAbort(db, orderNo);
      await releaseAbortedOrderSlotRepo(db, orderNo, 'processing');
      throw Errors.conflict('该优惠券刚刚已被抢完');
    }
  }

  const rollbackAllOnPreFulfillAbort = async () => {
    const claimedCouponId = couponClaimed ? (couponIdClaimed ?? undefined) : undefined;
    const compensated = await requestImmediateOrderAbort(db, orderNo, claimedCouponId);
    if (!compensated && claimedCouponId !== undefined) await rollbackCouponUsage(db, claimedCouponId);
    await releaseAbortedOrderSlotRepo(db, orderNo, 'processing').catch(() => undefined);
  };

  if (fundedByBalance) {
    if (!user) {
      await rollbackAllOnPreFulfillAbort();
      throw Errors.unauthorized('使用站内余额支付请先登录账号');
    }
    const deducted = await postBalanceOrderDebit(db, {
      orderNo,
      userId: user.id,
      amount: totalAmount,
      note: `购买「${effectiveProductTitle} (${selectedSpec.name}) × ${qty}」`,
    }).catch(async (error: unknown) => {
      await rollbackAllOnPreFulfillAbort();
      throw error;
    });
    if (!deducted) {
      await rollbackAllOnPreFulfillAbort();
      throw Errors.insufficientBalance(
        `站内余额不足（需 ¥${totalAmount.toFixed(2)}，当前余额 ¥${user.balance.toFixed(2)}），请先充值或切换在线支付。`
      );
    }
  }
  const guard = fundedByBalance ? balanceOrderActive(db, orderNo) : undefined;
  const renewLease = guard ? () => renewBalanceOrder(db, orderNo) : undefined;
  if (
    guard &&
    couponIdClaimed !== null &&
    !(await claimBalanceOrderCoupon(db, orderNo, couponIdClaimed, guard))
  ) {
    await requestImmediateOrderAbort(db, orderNo, undefined, guard);
    throw Errors.conflict('该优惠券刚刚已被抢完');
  }

  const payRes =
    totalAmount > 0
      ? await executePayment(env, {
          method: effectivePayMethod,
          amount: totalAmount,
          orderNo,
          userBalance: user ? Math.max(user.balance, totalAmount) : undefined,
        })
      : { paid: true, transactionRef: `PROMO-${orderNo}`, message: '推广消费金全额抵扣' };
  if (!payRes.paid) {
    await rollbackAllOnPreFulfillAbort();
    throw Errors.insufficientBalance(payRes.message);
  }

  // 6C. 履约前 1 毫秒独立 5 维反盗刷熔断闸
  const riskCheck = await evaluateAndHoldInstantOrderRisk(env, db, {
    orderNo,
    buyerIp,
    contactEmail: email,
    goodsTotal: totalAmount,
    promoUsed: promoUsedAmount,
    quantity: qty,
    unitCost: selectedSpec.cost_price ?? product.costPrice ?? product.upstreamCost ?? null,
    usesUpstream:
      availability.forceUpstreamOnly || (stockMode === 'cards' && availability.localCardAvail < qty),
    guard,
    rollbackOnBlock: rollbackAllOnPreFulfillAbort,
  });
  if (riskCheck.held) {
    return buildHeldRiskOrderResponse({
      orderNo,
      publicNo,
      isLoggedIn: Boolean(user),
      productTitle: effectiveProductTitle,
      specName: selectedSpec.name,
      qty,
      unitPrice,
      totalAmount,
      discountAmount,
      promoUsedAmount,
      reason: riskCheck.reason,
      email,
      paymentMethod: effectivePayMethod,
      warranty: orderWarranty,
      balance: user ? await getUserBalance(db, user.id) : undefined,
    });
  }

  // 6D. 拼团合租即时支付闭环：开团/入团并视满员状态原子成团发卡
  if (commerce.groupBuyMode && user) {
    return finalizeInstantGroupBuyOrder(env, db, {
      siteAgentId: currentSiteAgentId,
      product,
      specId: selectedSpec.id,
      specName: selectedSpec.name,
      effectiveProductTitle,
      orderNo,
      publicNo,
      user,
      email,
      qty,
      unitPrice,
      totalAmount,
      discountAmount,
      promoUsedAmount,
      paymentMethod: effectivePayMethod,
      paymentRef: payRes.transactionRef,
      paymentMessage: payRes.message,
      mode: commerce.groupBuyMode,
      groupBuyCode: commerce.groupBuyCode,
      originUrl: reqOrigin,
      warranty: orderWarranty,
    });
  }

  if (!(await recordFlashSalePurchaseIfNeeded(db, body.product_id, qty, commerce.isFlashSaleActive))) {
    await rollbackAllOnPreFulfillAbort();
    throw Errors.conflict('限时秒杀名额刚刚已被抢空，已自动取消扣款');
  }

  let fulfill: Awaited<ReturnType<typeof executeUnifiedFulfillment>>;
  try {
    fulfill = commerce.selectedCardId
      ? await fulfillSelectedCardAtomically(env, db, {
          orderNo,
          productId: body.product_id,
          selectedCardId: commerce.selectedCardId,
          guard,
        })
      : commerce.bundleItems.length > 0
        ? await executeBundleFulfillment(env, db, {
            orderNo,
            productId: body.product_id,
            bundleItems: commerce.bundleItems,
            qty,
            guard,
            renewLease,
          })
        : await executeUnifiedFulfillment(env, {
            orderNo,
            channel: 'web',
            paymentMethod: effectivePayMethod,
            productId: body.product_id,
            productOwnerAgentId: product.ownerAgentId,
            productTitle: effectiveProductTitle,
            spec: selectedSpec,
            specsCount: specs.length,
            quantity: qty,
            stockMode,
            deliveryType,
            contactEmail: email,
            totalAmount,
            originUrl: reqOrigin,
            customInputs: body.custom_inputs,
            availability,
            guard,
            renewLease,
            postLocalStock: guard
              ? (mode) =>
                  postBalanceOrderStock(db, orderNo, {
                    productId: body.product_id,
                    quantity: qty,
                    mode,
                    guard,
                  })
              : undefined,
          });
  } catch (err) {
    if (!guard) await rollbackAllOnPreFulfillAbort();
    throw err;
  }

  if (!fulfill.ok) {
    await rollbackAllOnPreFulfillAbort();
    throw Errors.conflict(fulfill.conflictError || '履约失败，已自动取消扣款');
  }

  // S8 防护：仅确认已交付(delivered)或人工待发(paid)时即时结算分润；upstream_pending 延后至出卡完结时结算
  const baseMainTotal = Number((selectedSpec.price * qty).toFixed(2));
  let commissionAmount = 0;
  if (fulfill.orderStatus === 'delivered' || fulfill.orderStatus === 'paid') {
    commissionAmount = await settleOrderProfitDispatch({
      env,
      orderNo,
      productOwnerAgentId: product.ownerAgentId,
      buyerWholesaleAgentId: buyerAgentForWholesale?.id ?? 0,
      sellingAgentId: tenantAgentId ?? 0,
      baseMainTotal,
      totalAmount,
      guard,
    });
  }

  const deliveredPayload = fulfill.deliveredLines.join('\n');
  const casRes = await finalizeProcessingOrderCas(
    db,
    orderNo,
    {
      commissionAmount,
      status: fulfill.orderStatus,
      deliveredPayload: await sealDeliveryPayload(env, orderNo, deliveredPayload),
      fulfillmentSource: fulfill.fulfillmentSource,
      upstreamSourceId: fulfill.upstreamSourceId,
      upstreamOrderNo: fulfill.upstreamOrderNo,
      upstreamCostTotal: fulfill.upstreamCostTotal,
      upstreamStatus: fulfill.upstreamStatus,
      upstreamError: fulfill.upstreamError,
    },
    guard ? { guard, clearStock: true } : undefined
  );
  if (guard && !casRes.updated && casRes.current?.status === 'processing') {
    throw Errors.conflict('余额订单已交给后台恢复，请查询原订单');
  }

  // L5 抢跑防护：若上游回调先于当前函数推进到了 delivered，读回终态不覆写
  let finalStatus = casRes.updated ? fulfill.orderStatus : casRes.current?.status || fulfill.orderStatus;
  let finalPayload = casRes.updated
    ? deliveredPayload
    : await readDeliveryPayload(env, orderNo, casRes.current?.deliveredPayload || '');

  if (finalStatus === 'delivered' || finalStatus === 'paid') {
    await settleAffiliateRewardForOrder(env, orderNo).catch(() => undefined);
    const hookRes = await dispatchBusinessWebhookEvent(
      env,
      finalStatus === 'delivered' ? 'order.delivered' : 'order.created',
      {
        order_no: orderNo,
        public_order_no: publicNo,
        product_id: body.product_id,
        product_title: effectiveProductTitle,
        spec_id: selectedSpec.id,
        quantity: qty,
        total_amount: totalAmount,
        contact_email: email,
        status: finalStatus,
        custom_inputs: body.custom_inputs || {},
      }
    ).catch(() => ({ deliveredPayloadOverride: undefined }));
    if (hookRes.deliveredPayloadOverride) {
      finalStatus = 'delivered';
      finalPayload = hookRes.deliveredPayloadOverride;
    }
  }

  const updatedBalance = user ? await getUserBalance(db, user.id) : undefined;
  const mailDelivery = await dispatchPostOrderNotifications(env, db, {
    tenant,
    tenantAgentId,
    orderNo,
    publicNo,
    productId: body.product_id,
    productOriginalTitle: product.title,
    effectiveProductTitle,
    specId: selectedSpec.id,
    specName: selectedSpec.name,
    qty,
    totalAmount,
    paymentMethod: effectivePayMethod,
    email,
    orderStatus: finalStatus,
    stockMode,
    deliveryType,
  });

  return {
    order: {
      order_no: user ? orderNo : publicNo,
      public_order_no: publicNo,
      product_title: effectiveProductTitle,
      spec_name: selectedSpec.name,
      quantity: qty,
      unit_price: unitPrice,
      total_amount: totalAmount,
      discount_amount: discountAmount,
      promo_used_amount: promoUsedAmount,
      status: finalStatus,
      contact_email: email,
      payment_method: effectivePayMethod,
      ...(user ? { payment_reference: payRes.transactionRef } : {}),
      payment_message: payRes.message,
      delivered_payload: finalStatus === 'delivered' ? finalPayload : '',
      mail_delivery: mailDelivery,
      warranty: orderWarranty,
      created_at: new Date().toISOString(),
    },
    balance: updatedBalance,
  };
}
