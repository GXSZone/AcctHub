import { normalizeBundleItems } from '@shared/domain/commerce-modes';
import { roundCurrency } from '@shared/domain/money';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import {
  INVENTORY_CREDENTIAL_SCOPE,
  readStoredCredential,
  sealDeliveryPayload,
} from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { sendQueuedOrderEmails } from '../../infra/mail.outbox';
import { dispatchOpsNotification } from '../../infra/notify';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { settleOrderProfitDispatch } from '../agent/settlement.service';
import { findUserById } from '../auth/auth.repo';
import {
  checkOrderAvailabilityWithBundle,
  executeBundleFulfillment,
  fulfillSelectedCardAtomically,
  recordFlashSalePurchaseIfNeeded,
} from '../commerce/commerce-checkout.helper';
import { commitPaidGroupBuyOrder } from '../commerce/group-buy.service';
import { postPaidOrderStock, releaseClaimedCards } from '../fulfillment/fulfillment.repo';
import { executeUnifiedFulfillment, type UnifiedFulfillmentResult } from '../fulfillment/fulfillment.service';
import { holdAsyncOrderIfRisky } from '../orders/orders.risk-fee';
import { hasCompleteUpstreamUnits } from '../upstream/upstream.order.adapter';
import {
  claimCouponUsageByCodeAtomic,
  findClaimedCardsByOrderNoRepo,
  findExistingUpstreamOrderForLocalNoRepo,
  rollbackPaymentCouponUsage,
} from './payment.fulfill.repo';
import {
  findOrderByNo,
  findProductById,
  lockPendingOrderPaidAtomic,
  updateOrderFulfillmentResult,
} from './payment.order.repo';
import { type PaymentFulfillLease, paymentFulfillLeaseGuard } from './payment.repo';
import {
  getOutstandingPromoForOrder,
  postOrderFulfillmentFailure,
  reclaimLateOrderPromo,
} from './payment-posting.repo';
import { ensureDirectCollectFloorFunded } from './tenant-payment.service';

/** 根据历史断点（卡密已扣或上游单已生成）恢复半截履约结果，避免重入时重复扣库/重复采购 */
async function tryResumeExistingFulfillment(
  env: Env,
  db: ReturnType<typeof createDb>,
  orderNo: string,
  qty: number,
  claimedCardRows: Awaited<ReturnType<typeof findClaimedCardsByOrderNoRepo>>
): Promise<UnifiedFulfillmentResult | null> {
  if (claimedCardRows.length === qty) {
    const claimedCards = await Promise.all(
      claimedCardRows.map((card) => readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE))
    );
    return {
      ok: true,
      deliveredLines: claimedCards,
      orderStatus: 'delivered',
      fulfillmentSource: 'local',
      upstreamSourceId: null,
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      upstreamStatus: 'none',
      upstreamError: '',
    };
  }

  const upOrder = await findExistingUpstreamOrderForLocalNoRepo(db, orderNo);
  if (!upOrder) return null;

  if (upOrder.status === 'succeeded') {
    const storedCards = await readStoredCredential(
      env,
      upOrder.cardsJson || '[]',
      `upstream-cards:${upOrder.id}`
    );
    const cards = safeJsonParse<string[]>(storedCards, []);
    if (hasCompleteUpstreamUnits(cards, qty)) {
      return {
        ok: true,
        deliveredLines: cards,
        orderStatus: 'delivered',
        fulfillmentSource: 'upstream',
        upstreamSourceId: upOrder.sourceId,
        upstreamOrderNo: upOrder.upstreamOrderNo || '',
        upstreamCostTotal: Number(upOrder.upstreamCost || 0),
        upstreamStatus: 'delivered',
        upstreamError: '',
      };
    }
  }

  if (['pending', 'timeout_unknown', 'orphan', 'succeeded'].includes(upOrder.status)) {
    return {
      ok: true,
      deliveredLines: [],
      orderStatus: 'upstream_pending',
      fulfillmentSource: 'upstream',
      upstreamSourceId: upOrder.sourceId,
      upstreamOrderNo: upOrder.upstreamOrderNo || '',
      upstreamCostTotal: Number(upOrder.upstreamCost || 0),
      upstreamStatus: 'pending',
      upstreamError: upOrder.errorMessage || '',
    };
  }

  return {
    ok: false,
    conflictError: upOrder.errorMessage || '上游采购恢复失败',
    deliveredLines: [],
    orderStatus: 'fulfillment_failed',
    fulfillmentSource: 'upstream',
    upstreamSourceId: upOrder.sourceId,
    upstreamOrderNo: upOrder.upstreamOrderNo || '',
    upstreamCostTotal: Number(upOrder.upstreamCost || 0),
    upstreamStatus: 'failed',
    upstreamError: upOrder.errorMessage || '',
  };
}

/** 异步订单付款成功后扣库、限额核销优惠券、重扣已退推广金(S7)、发卡、结算分润(S8)与退款补偿 */
export async function fulfillPaidAsyncOrder(
  env: Env,
  orderNo: string,
  extra: Record<string, unknown>,
  originUrl: string,
  options: {
    allowProcessingRecovery?: boolean;
    lease: PaymentFulfillLease;
    renewLease: () => Promise<void>;
  }
): Promise<void> {
  const db = createDb(env.DB);
  const order = await findOrderByNo(db, orderNo);
  if (!order) {
    void dispatchOpsNotification(env, 'upstream_alert', '【高危L2】异步支付已成交但本地订单缺失', [
      `关联订单号：${orderNo}`,
      '处理建议：请立即排查订单落库记录或根据支付流水单号核实退款补单。',
    ]);
    throw Errors.notFound(`异步支付单关联订单不存在（${orderNo}）`);
  }

  const orderLocked = await lockPendingOrderPaidAtomic(db, orderNo, options);
  if (orderLocked.alreadyCompleted) {
    if (order.status === 'paid' || order.status === 'delivered')
      await settleAffiliateRewardForOrder(env, orderNo);
    return;
  }
  if (!orderLocked.locked) {
    throw Errors.conflict(
      `订单 ${orderNo} 当前状态为 ${orderLocked.previousStatus || order.status}，无法进入履约`
    );
  }

  const qty = Math.max(1, Number(order.quantity || 1));
  const totalAmount = Number(order.totalAmount || 0);
  const specId = order.specId || 'default';
  const email = order.contactEmail || '';
  const promoUsed = roundCurrency(Number(order.promoUsedAmount || 0));
  const { lease, renewLease } = options;
  const guard = paymentFulfillLeaseGuard(lease);
  const outstanding =
    order.userId && promoUsed > 0 ? await getOutstandingPromoForOrder(db, orderNo, order.userId) : 0;
  const compensate = async (
    cash: number,
    promo: number,
    status: 'refunded' | 'fulfillment_failed',
    reason: string
  ) => {
    await renewLease();
    if (
      !(await postOrderFulfillmentFailure(db, {
        orderNo,
        userId: order.userId,
        cash,
        promo,
        status,
        reason,
        lease,
      }))
    ) {
      throw Errors.conflict('支付订单补偿条件已变更');
    }
  };

  // 通过净抵扣额判断过期退还，恢复 processing 时也能继续执行迟到回款校验。
  let promoOutstanding = Math.min(promoUsed, outstanding);
  if (promoUsed > 0 && promoOutstanding < promoUsed && orderLocked.previousStatus !== 'pending_payment') {
    const promoToReclaim = roundCurrency(promoUsed - promoOutstanding);
    await renewLease();
    if (
      !order.userId ||
      !(await reclaimLateOrderPromo(db, {
        orderNo,
        userId: order.userId,
        amount: promoToReclaim,
        lease,
      }))
    ) {
      const cash = order.userId ? totalAmount : 0;
      const status = cash > 0 ? 'refunded' : 'fulfillment_failed';
      await compensate(cash, promoOutstanding, status, '过期订单推广金无法重新扣减，已停止发货');
      return;
    }
    promoOutstanding = promoUsed;
  }

  const priorCardClaims =
    orderLocked.previousStatus === 'processing' ? await findClaimedCardsByOrderNoRepo(db, orderNo) : [];
  const handlePostPayOutOfStock = async (reason: string) => {
    await renewLease();
    await releaseClaimedCards(
      db,
      priorCardClaims.map((card) => card.id),
      orderNo,
      guard
    );
    if (order.couponCode) {
      await rollbackPaymentCouponUsage(db, lease);
    }
    if (order.userId && totalAmount > 0) {
      await compensate(totalAmount, promoOutstanding, 'refunded', `已自动退回站内余额：${reason}`);
    } else if (order.userId && promoOutstanding >= 0.01) {
      await compensate(0, promoOutstanding, 'refunded', `已原路退回推广消费金：${reason}`);
    } else {
      await compensate(0, 0, 'fulfillment_failed', `付款后需客服补发或退款：${reason}`);
    }
    void dispatchOpsNotification(env, 'upstream_alert', '异步付款后自动退款/异常预警', [
      `订单号：${orderNo}`,
      `商品：${order.productTitle} × ${qty}`,
      `实付金额：¥${totalAmount.toFixed(2)}`,
      `原因：${reason}`,
    ]);
  };

  let fulfill =
    orderLocked.previousStatus === 'processing'
      ? await tryResumeExistingFulfillment(env, db, orderNo, qty, priorCardClaims)
      : null;
  if (fulfill?.fulfillmentSource === 'local' && guard) {
    await renewLease();
    if (
      (await postPaidOrderStock(db, {
        intentNo: lease.intentNo,
        guard,
        productId: order.productId,
        quantity: qty,
        mode: 'cards',
      })) === null
    ) {
      throw Errors.conflict('本地卡密库存入账未完成');
    }
  }

  // 核销与断点共同落库。补偿重试会沿用首次核销。
  if (order.couponCode && !fulfill) {
    await renewLease();
    const claimed = await claimCouponUsageByCodeAtomic(db, order.couponCode, lease);
    if (!claimed) {
      await handlePostPayOutOfStock('限量优惠券名额在等待付款期间已被抢完');
      return;
    }
  }

  const product = await findProductById(db, order.productId);
  const fulfillmentSnapshot = extra.fulfillment as
    | Partial<{
        specId: string;
        stockMode: string;
        deliveryType: string;
        upstreamOnly: boolean;
        mainUnitPrice: number;
        isFlashSale: boolean;
        groupBuyMode: 'start' | 'join';
        groupBuyCode: string;
        selectedCardId: number;
      }>
    | undefined;
  if (!product && !fulfill) {
    await handlePostPayOutOfStock('商品已下架或不存在');
    return;
  }

  const specs = safeJsonParse<ProductSpec[]>(product?.specsJson || '[]', []);
  const selectedSpec =
    specs.find((s) => s.id === specId) ||
    (specs.length === 0 && specId === 'default'
      ? {
          id: specId,
          name: order.specName || '标准版',
          price: Number(product?.basePrice || order.unitPrice),
        }
      : undefined);

  if (!fulfill && product) {
    const alreadyClaimed = typeof extra.fulfill_local_stock === 'number';
    if (
      !selectedSpec ||
      (fulfillmentSnapshot &&
        (fulfillmentSnapshot.specId !== specId ||
          fulfillmentSnapshot.stockMode !== (product.stockMode || 'cards') ||
          fulfillmentSnapshot.deliveryType !== (product.deliveryType || 'auto')))
    ) {
      await handlePostPayOutOfStock('原订单规格已不可用，请人工核对履约或退款');
      return;
    }

    // Phase 4 资金风控：分站自有收款售出平台代销商品时，出卡前必须原子扣除站长平台拿货底价，不足则挂起 awaiting_agent_funding
    if (order.settlementMode === 'tenant_direct_collect' && product.ownerAgentId === 0 && order.agentId) {
      const snapUnit = fulfillmentSnapshot?.mainUnitPrice;
      const baseMain = Number(
        ((typeof snapUnit === 'number' ? snapUnit : selectedSpec.price) * qty).toFixed(2)
      );
      const funded = await ensureDirectCollectFloorFunded(env, db, {
        orderNo,
        sellingAgentId: Number(order.agentId),
        baseMainTotal: baseMain,
        totalAmount,
        lease,
        renewLease,
      });
      if (!funded) return;
    }

    const bundleItems = normalizeBundleItems(product.bundleItemsJson);
    const availability = await checkOrderAvailabilityWithBundle(env, db, {
      product,
      selectedSpec,
      specsCount: specs.length,
      qty,
      bundleItems,
    });

    const localClaimsCompleteAvailability =
      (product.stockMode || 'cards') === 'cards' &&
      product.deliveryType !== 'api_key' &&
      !availability.forceUpstreamOnly &&
      availability.localCardAvail + priorCardClaims.length >= qty;
    if (
      !alreadyClaimed &&
      ((!availability.available && !localClaimsCompleteAvailability) ||
        (fulfillmentSnapshot?.upstreamOnly && !availability.hasHealthyUpstream))
    ) {
      await handlePostPayOutOfStock(availability.errorMessage || '当前库存已被其他订单抢完');
      return;
    }
    if (fulfillmentSnapshot?.upstreamOnly) availability.forceUpstreamOnly = true;

    // 异步支付回调履约前 5 维风控闸：疑似盗刷/大额/速率触顶时保留资金并转人工待审，绝不吐出卡密
    if (!alreadyClaimed && priorCardClaims.length === 0) {
      const unitCost = selectedSpec.cost_price ?? product.costPrice ?? product.upstreamCost ?? null;
      const held = await holdAsyncOrderIfRisky(env, db, {
        orderNo,
        buyerIp: order.buyerIp || '',
        contactEmail: email,
        totalAmount,
        promoUsed: promoOutstanding,
        qty,
        unitCost,
        usesUpstream:
          availability.forceUpstreamOnly ||
          ((product.stockMode || 'cards') === 'cards' && availability.localCardAvail < qty),
        lease,
        renewLease,
      });
      if (held) return;
    }

    // 异步收银台拼团合租回调分支：入团或成团发卡后直接结束
    if (fulfillmentSnapshot?.groupBuyMode && order.userId) {
      const buyerRow = await findUserById(db, order.userId);
      if (buyerRow) {
        await commitPaidGroupBuyOrder(env, db, {
          siteAgentId: Number(order.agentId || 0),
          product,
          specId,
          orderNo,
          user: { id: buyerRow.id, displayName: buyerRow.displayName, email: buyerRow.email },
          contactEmail: email,
          paidAmount: totalAmount,
          promoUsedAmount: promoOutstanding,
          mode: fulfillmentSnapshot.groupBuyMode,
          groupBuyCode: fulfillmentSnapshot.groupBuyCode,
          originUrl,
        });
        return;
      }
    }

    if (fulfillmentSnapshot?.isFlashSale) {
      await recordFlashSalePurchaseIfNeeded(db, product.id, qty, true);
    }

    const customInputs = safeJsonParse<Record<string, string>>(order.customInputsJson || '{}', {});
    await renewLease();
    fulfill = fulfillmentSnapshot?.selectedCardId
      ? await fulfillSelectedCardAtomically(env, db, {
          orderNo,
          productId: product.id,
          selectedCardId: fulfillmentSnapshot.selectedCardId,
          guard,
        })
      : bundleItems.length > 0
        ? await executeBundleFulfillment(env, db, {
            orderNo,
            productId: product.id,
            bundleItems,
            qty,
            guard,
            renewLease,
          })
        : await executeUnifiedFulfillment(env, {
            orderNo,
            channel: 'web',
            paymentMethod: order.paymentMethod || 'epay',
            productId: product.id,
            productOwnerAgentId: product.ownerAgentId,
            productTitle: order.productTitle || product.title,
            spec: selectedSpec,
            specsCount: specs.length,
            quantity: qty,
            stockMode: product.stockMode || 'cards',
            deliveryType: product.deliveryType || 'auto',
            contactEmail: email,
            totalAmount,
            originUrl,
            customInputs,
            availability,
            priorCardClaims,
            guard,
            paymentStock: guard ? { intentNo: lease.intentNo, guard, alreadyClaimed } : undefined,
            renewLease,
          });
  }

  if (!fulfill?.ok) {
    await handlePostPayOutOfStock(fulfill?.conflictError || '并发扣减卡密失败');
    return;
  }

  // S8 防护：仅在订单确认已交付(delivered)或人工接单(paid)时结算佣金；upstream_pending 延后至出卡时结算
  const snapshotUnitPrice = fulfillmentSnapshot?.mainUnitPrice;
  const baseMainTotal = Number(
    (
      (typeof snapshotUnitPrice === 'number' ? snapshotUnitPrice : (selectedSpec?.price ?? order.unitPrice)) *
      qty
    ).toFixed(2)
  );
  let commissionAmount = Number(order.commissionAmount || 0);
  const buyerWholesaleAgentId = Number(extra.buyer_wholesale_agent_id || 0);
  const sellingAgentId = order.agentId ? Number(order.agentId) : 0;

  const canSettleProfitNow =
    order.settlementMode !== 'tenant_direct_collect' &&
    (fulfill.orderStatus === 'delivered' || fulfill.orderStatus === 'paid') &&
    commissionAmount === 0;
  if (canSettleProfitNow) {
    await renewLease();
    commissionAmount = await settleOrderProfitDispatch({
      env,
      orderNo,
      productOwnerAgentId: Number(order.productOwnerAgentId || product?.ownerAgentId || 0),
      buyerWholesaleAgentId,
      sellingAgentId,
      baseMainTotal,
      totalAmount,
      guard,
    });
  }

  const deliveredPayload = fulfill.deliveredLines.join('\n');
  await renewLease();
  const finalized = await updateOrderFulfillmentResult(
    db,
    orderNo,
    {
      status: fulfill.orderStatus,
      deliveredPayload: await sealDeliveryPayload(env, orderNo, deliveredPayload),
      commissionAmount,
      fulfillmentSource: fulfill.fulfillmentSource,
      upstreamSourceId: fulfill.upstreamSourceId,
      upstreamOrderNo: fulfill.upstreamOrderNo,
      upstreamCostTotal: fulfill.upstreamCostTotal,
      upstreamStatus: fulfill.upstreamStatus,
      upstreamError: fulfill.upstreamError,
    },
    lease
  );
  if (!finalized) throw Errors.conflict('订单履约状态已变更');

  if (fulfill.orderStatus === 'delivered' || fulfill.orderStatus === 'paid') {
    await settleAffiliateRewardForOrder(env, orderNo);
    if (order.publicOrderNo) {
      await sendQueuedOrderEmails(env, order.agentId ?? 0, order.publicOrderNo).catch(() => undefined);
    }
  }

  void dispatchOpsNotification(env, 'new_order', '异步收银台付款成交', [
    `订单号：${orderNo}`,
    `支付方式：${order.paymentMethod}`,
    `商品：${order.productTitle} (${selectedSpec?.name ?? order.specName}) × ${qty}`,
    `实付：¥${totalAmount.toFixed(2)}`,
    `状态：${fulfill.orderStatus}`,
  ]);
}
