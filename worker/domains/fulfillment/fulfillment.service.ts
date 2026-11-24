import type { ProductSpecDto } from '@shared/index';
import type { SQL } from 'drizzle-orm';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { generateRandomCode } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { dispatchOpsNotification } from '../../infra/notify';
import {
  executeUpstreamProcurement,
  getCandidateBindingsForSpec,
} from '../upstream/upstream.fulfillment.service';
import { isUpstreamOnlySpecRepo } from '../upstream/upstream.orders.repo';
import {
  claimSeatsAtomic,
  claimSingleCardAtomic,
  countAvailableCardsForSpec,
  decrementManualStockAtomic,
  incrementProductSalesCount,
  listCandidateAvailableCards,
  postPaidOrderStock,
  releaseClaimedCards,
} from './fulfillment.repo';

export interface SpecAvailabilityResult {
  localCardAvail: number;
  hasHealthyUpstream: boolean;
  forceUpstreamOnly: boolean;
  available: boolean;
  errorMessage?: string;
}

/**
 * 零售前台与 B2B 代理批采统一的下单前规格可用库存校验入口
 */
export async function checkSpecAvailability(
  env: Env,
  params: {
    productId: number;
    productOwnerAgentId?: number;
    spec: ProductSpecDto;
    specsCount: number;
    quantity: number;
    stockMode: string;
    deliveryType: string;
    manualStock: number;
    seatTotal: number;
    seatUsed: number;
  }
): Promise<SpecAvailabilityResult> {
  const { productId, spec, quantity, stockMode, deliveryType, manualStock, seatTotal, seatUsed } = params;
  const cardOwnerAgentId = params.productOwnerAgentId ?? 0;
  const isTenantPrivate = cardOwnerAgentId > 0;

  const db = createDb(env.DB);
  const upstreamCandidates = isTenantPrivate
    ? []
    : await getCandidateBindingsForSpec(env, productId, spec.id, quantity);
  const hasHealthyUpstream = upstreamCandidates.length > 0;
  const forceUpstreamOnly = isTenantPrivate ? false : await isUpstreamOnlySpecRepo(db, productId, spec.id);

  let localCardAvail = 0;

  if (forceUpstreamOnly && !hasHealthyUpstream) {
    return {
      localCardAvail,
      hasHealthyUpstream,
      forceUpstreamOnly,
      available: false,
      errorMessage: '该规格仅支持上游履约，当前没有可用货源。',
    };
  }

  if (deliveryType === 'api_key') {
    return {
      localCardAvail: 0,
      hasHealthyUpstream,
      forceUpstreamOnly,
      available: false,
      errorMessage: 'API 算力商品尚未接入可验证的开通服务。',
    };
  }

  if (stockMode === 'cards') {
    localCardAvail = await countAvailableCardsForSpec(db, productId, spec.id, cardOwnerAgentId);

    if (
      (forceUpstreamOnly && !hasHealthyUpstream) ||
      (!forceUpstreamOnly && localCardAvail < quantity && !hasHealthyUpstream)
    ) {
      return {
        localCardAvail,
        hasHealthyUpstream,
        forceUpstreamOnly,
        available: false,
        errorMessage: `所选规格「${spec.name}」当前仅剩 ${localCardAvail} 件可用库存，请调低数量或切换其他规格。`,
      };
    }
    return { localCardAvail, hasHealthyUpstream, forceUpstreamOnly, available: true };
  }

  if (stockMode === 'seats') {
    const rem = Math.max(0, seatTotal - seatUsed);
    if (rem < quantity && !hasHealthyUpstream) {
      return {
        localCardAvail: 0,
        hasHealthyUpstream,
        forceUpstreamOnly,
        available: false,
        errorMessage: `当前车队仅剩 ${rem} 个空席位，不足所选数量。`,
      };
    }
    return { localCardAvail: 0, hasHealthyUpstream, forceUpstreamOnly, available: true };
  }

  if (manualStock < quantity && !hasHealthyUpstream) {
    return {
      localCardAvail: 0,
      hasHealthyUpstream,
      forceUpstreamOnly,
      available: false,
      errorMessage: `当前库存仅剩 ${manualStock} 件。`,
    };
  }

  return { localCardAvail: 0, hasHealthyUpstream, forceUpstreamOnly, available: true };
}

export interface UnifiedFulfillmentInput {
  orderNo: string;
  channel: 'web' | 'reseller_api';
  paymentMethod: string;
  productId: number;
  productOwnerAgentId?: number;
  productTitle: string;
  spec: ProductSpecDto;
  specsCount: number;
  quantity: number;
  stockMode: string;
  deliveryType: string;
  contactEmail: string;
  totalAmount: number;
  originUrl: string;
  customInputs?: Record<string, string>;
  availability: SpecAvailabilityResult;
  priorCardClaims?: Array<{ id: number; cardContent: string }>;
  paymentStock?: { intentNo: string; guard: SQL; alreadyClaimed: boolean };
  postLocalStock?: (mode: 'cards' | 'seats' | 'manual') => Promise<number | null>;
  guard?: SQL;
  renewLease?: () => Promise<void>;
}

export interface UnifiedFulfillmentResult {
  ok: boolean;
  conflictError?: string;
  deliveredLines: string[];
  orderStatus: 'paid' | 'delivered' | 'upstream_pending' | 'fulfillment_failed';
  fulfillmentSource: 'local' | 'upstream';
  upstreamSourceId: number | null;
  upstreamOrderNo: string;
  upstreamCostTotal: number;
  upstreamStatus: 'none' | 'pending' | 'delivered' | 'failed';
  upstreamError: string;
}

export function buildLocalOrderDelivery(
  input: Pick<UnifiedFulfillmentInput, 'channel' | 'orderNo' | 'productId' | 'quantity' | 'contactEmail'>,
  mode: 'manual' | 'seats',
  endSeat = 0
): string[] {
  if (input.channel === 'reseller_api') {
    return [
      mode === 'seats'
        ? `WHOLESALE-SEAT-${generateRandomCode('B2B-', 12)}`
        : `WHOLESALE-TOKEN-${generateRandomCode('B2B-', 12)}`,
    ];
  }
  if (mode === 'manual') {
    return [
      `专属工单号: ${input.orderNo} | 经理将在 15 分钟内完成官方代充/企业席位开通，并发送确认邮件至 ${input.contactEmail}。`,
    ];
  }
  const startsAt = endSeat - input.quantity + 1;
  const pins = crypto.getRandomValues(new Uint32Array(input.quantity));
  return Array.from({ length: input.quantity }, (_, i) => {
    const pin = String(1000 + ((pins[i] ?? 0) % 9000));
    return `车队编号: POD-${input.productId} | 专属席位 #${startsAt + i} | 专属 PIN: ${pin} | 邀请/登录凭证: ${generateRandomCode('SEAT-', 12)}`;
  });
}

/**
 * 统一混合履约引擎（100% Drizzle ORM）：
 * 优先原子认领本地库存（卡密 / API 算力 / 拼车席位 / 手动库存），
 * 当本地库存耗尽或商品配置为 upstream_only 时自动无缝切换多源上游实时采购。
 */
export async function executeUnifiedFulfillment(
  env: Env,
  input: UnifiedFulfillmentInput
): Promise<UnifiedFulfillmentResult> {
  const {
    orderNo,
    channel,
    paymentMethod,
    productId,
    productTitle,
    spec,
    quantity,
    stockMode,
    deliveryType,
    contactEmail,
    totalAmount,
    originUrl,
    customInputs,
    availability,
    priorCardClaims = [],
    paymentStock,
    postLocalStock,
    guard,
    renewLease,
  } = input;

  const db = createDb(env.DB);
  const postStock =
    postLocalStock ??
    (paymentStock
      ? (mode: 'cards' | 'seats' | 'manual') =>
          postPaidOrderStock(db, { ...paymentStock, productId, quantity, mode })
      : undefined);
  const { hasHealthyUpstream, forceUpstreamOnly, localCardAvail } = availability;
  const deliveredLines: string[] = [];
  let fulfillmentSource: 'local' | 'upstream' = 'local';
  let upstreamSourceId: number | null = null;
  let upstreamOrderNo = '';
  let upstreamCostTotal = 0;
  let upstreamStatus: 'none' | 'pending' | 'delivered' | 'failed' = 'none';
  let upstreamError = '';
  let orderStatus: 'paid' | 'delivered' | 'upstream_pending' | 'fulfillment_failed' =
    channel === 'web' && deliveryType === 'manual' ? 'paid' : 'delivered';

  const makeFailure = (conflictError: string): UnifiedFulfillmentResult => ({
    ok: false,
    conflictError,
    deliveredLines,
    orderStatus,
    fulfillmentSource,
    upstreamSourceId,
    upstreamOrderNo,
    upstreamCostTotal,
    upstreamStatus,
    upstreamError,
  });
  if (deliveryType === 'api_key') return makeFailure('API 算力商品尚未接入可验证的开通服务。');

  const cardOwnerAgentId = input.productOwnerAgentId ?? 0;
  const isTenantPrivate = cardOwnerAgentId > 0;
  const requiresUpstream =
    !isTenantPrivate &&
    !paymentStock?.alreadyClaimed &&
    (forceUpstreamOnly || (await isUpstreamOnlySpecRepo(db, productId, spec.id)));
  let shouldUseUpstream =
    !isTenantPrivate &&
    (requiresUpstream ||
      (hasHealthyUpstream && stockMode === 'cards' && localCardAvail + priorCardClaims.length < quantity));

  if (!shouldUseUpstream && stockMode === 'cards') {
    const claimedIds = priorCardClaims.map((card) => card.id);
    deliveredLines.push(
      ...(await Promise.all(
        priorCardClaims.map((card) => readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE))
      ))
    );
    const candidateLimit = Math.max(quantity + 12, quantity * 2);
    const candidates = await listCandidateAvailableCards(
      db,
      productId,
      spec.id,
      candidateLimit,
      cardOwnerAgentId
    );

    const loopCandidates: Array<{ id: number; cardContent: string }> = [];
    for (const card of candidates) {
      if (deliveredLines.length >= quantity) break;
      if (Number(card.isLoop || 0) === 1) {
        loopCandidates.push(card);
        continue;
      }
      const credential = await readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE);
      const claimed = await claimSingleCardAtomic(db, card.id, orderNo, guard);
      if (claimed) {
        claimedIds.push(card.id);
        deliveredLines.push(credential);
      }
    }

    // 若存在循环卡密，可重复发放且保持 available 不标记 sold
    if (deliveredLines.length < quantity && loopCandidates.length > 0) {
      let idx = 0;
      while (deliveredLines.length < quantity) {
        const loopCard = loopCandidates[idx % loopCandidates.length];
        const credential = await readStoredCredential(env, loopCard.cardContent, INVENTORY_CREDENTIAL_SCOPE);
        deliveredLines.push(credential);
        idx += 1;
      }
    }

    if (deliveredLines.length < quantity) {
      await renewLease?.();
      await releaseClaimedCards(db, claimedIds, orderNo, guard);
      deliveredLines.length = 0;
      if (hasHealthyUpstream) {
        shouldUseUpstream = true;
      } else {
        return makeFailure(`该规格库存刚刚被抢空，仅剩 ${claimedIds.length} 件，已自动取消扣款。`);
      }
    } else if (postStock) {
      if ((await postStock('cards')) === null) {
        throw new Error('本地卡密库存入账未完成');
      }
    } else {
      await incrementProductSalesCount(db, productId, quantity, guard);
    }
  } else if (!shouldUseUpstream && stockMode === 'seats') {
    const endSeat = postStock
      ? await postStock('seats')
      : await claimSeatsAtomic(db, productId, quantity, guard);
    if (endSeat === null) {
      return makeFailure('该车队剩余席位不足，已自动取消扣款。');
    }
    deliveredLines.push(...buildLocalOrderDelivery(input, 'seats', endSeat));
  } else if (!shouldUseUpstream) {
    const ok = postStock
      ? (await postStock('manual')) !== null
      : await decrementManualStockAtomic(db, productId, quantity, guard);
    if (!ok) {
      if (hasHealthyUpstream) {
        shouldUseUpstream = true;
      } else {
        return makeFailure('库存不足，已自动取消扣款。');
      }
    } else {
      deliveredLines.push(...buildLocalOrderDelivery(input, 'manual'));
    }
  }

  if (shouldUseUpstream) {
    await renewLease?.();
    if (priorCardClaims.length > 0) {
      await releaseClaimedCards(
        db,
        priorCardClaims.map((card) => card.id),
        orderNo,
        guard
      );
    }
    fulfillmentSource = 'upstream';
    const upRes = await executeUpstreamProcurement(env, {
      localOrderNo: orderNo,
      productId,
      specId: spec.id,
      quantity,
      contactEmail,
      originUrl,
      purpose: 'order_fulfill',
      customInputs,
      guard,
      renewLease,
    });

    upstreamSourceId = upRes.upstreamSourceId;
    upstreamOrderNo = upRes.upstreamOrderNo;
    upstreamCostTotal = upRes.upstreamCostTotal;
    upstreamError = upRes.errorMessage;

    if (upRes.status === 'delivered') {
      orderStatus = 'delivered';
      upstreamStatus = 'delivered';
      deliveredLines.push(...upRes.cards);
    } else if (upRes.status === 'upstream_pending') {
      orderStatus = 'upstream_pending';
      upstreamStatus = 'pending';
      if (channel === 'web') {
        deliveredLines.push(
          `订单 ${orderNo} 正在高速自动出卡通道处理中，预计数秒至 2 分钟内自动交付并发送邮件至 ${contactEmail}，请稍候刷新查单页。`
        );
      }
    } else {
      void dispatchOpsNotification(env, 'upstream_alert', '【紧急】上游实时出卡失败告警', [
        `本地订单：${orderNo}（${paymentMethod === 'balance' || channel === 'reseller_api' ? '余额支付·已自动秒退' : '在线实付·已转异常待履约队列'}）`,
        `商品：${productTitle} (${spec.name}) × ${quantity}`,
        `客户邮箱：${contactEmail} · 实付 ¥${totalAmount.toFixed(2)}`,
        `失败原因：${upRes.errorMessage}`,
      ]);

      if (paymentMethod === 'balance' || channel === 'reseller_api') {
        return {
          ...makeFailure(
            channel === 'reseller_api'
              ? 'Supply channel temporarily out of stock, agent balance automatically refunded.'
              : '当前供货通道瞬时波动或库存不足，系统已自动全额退回您的站内余额，请稍后再试。'
          ),
          upstreamStatus: 'failed',
        };
      }

      orderStatus = 'fulfillment_failed';
      upstreamStatus = 'failed';
      deliveredLines.push(
        `您的订单 ${orderNo} 已成功付款！当前高速发卡通道正在紧急补货，系统已自动通知专属值班客服优先为您补发凭证，您可稍后刷新查单或联系在线客服。`
      );
    }
  }

  return {
    ok: true,
    deliveredLines,
    orderStatus,
    fulfillmentSource,
    upstreamSourceId,
    upstreamOrderNo,
    upstreamCostTotal,
    upstreamStatus,
    upstreamError,
  };
}
