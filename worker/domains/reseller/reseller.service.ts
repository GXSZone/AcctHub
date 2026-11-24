import { buildWarrantySummaryTemplate, normalizeWarrantyType } from '@shared/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { readDeliveryPayload, sealDeliveryPayload } from '../../infra/credential-storage';
import { generateBizNo, sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { getClientIp } from '../../infra/security';
import { getUserBalance } from '../account/wallet.repo';
import { settleRecursiveOrderProfits } from '../agent/settlement.service';
import { checkSpecAvailability, executeUnifiedFulfillment } from '../fulfillment/fulfillment.service';
import { postBalanceOrderStock } from '../orders/orders.balance-recovery.repo';
import {
  claimOrderSlotAtomic,
  finalizeProcessingOrderCas,
  findActiveProductForOrder,
  releaseAbortedOrderSlotRepo,
} from '../orders/orders.repo';
import {
  balanceOrderActive,
  completeImmediateOrderAbort,
  postBalanceOrderDebit,
  renewBalanceOrder,
  requestImmediateOrderAbort,
} from '../orders/orders.wallet.repo';
import {
  type ActiveResellerAgent,
  findActiveResellerByApiKey,
  findResellerIdempotentOrder,
  findResellerOrderByNo,
} from './reseller.repo';

export { getResellerCompatCatalog, listResellerProducts } from './reseller.catalog.service';

export type ResellerAuthResult = { agent: ActiveResellerAgent } | { error: string; status: 401 | 403 };

async function buildIdempotentReplayResponse(
  env: Env,
  dup: NonNullable<Awaited<ReturnType<typeof findResellerIdempotentOrder>>>,
  agent: ActiveResellerAgent
) {
  const dupCards = (
    dup.status === 'delivered' ? await readDeliveryPayload(env, dup.orderNo, dup.deliveredPayload || '') : ''
  )
    .split('\n')
    .filter(Boolean);
  return {
    status: 200,
    body: {
      ok: true,
      idempotent: true,
      order_no: dup.orderNo,
      status: dup.status,
      tier_name: agent.tierName,
      discount_rate: agent.tierDiscountRate,
      unit_wholesale_price: Number(dup.unitPrice),
      total_deducted:
        dup.status === 'processing' ? null : dup.status === 'refunded' ? 0 : Number(dup.totalAmount),
      remaining_balance: agent.balance,
      cards: dupCards,
      order: {
        order_no: dup.orderNo,
        status: dup.status,
        product_id: dup.productId,
        spec_id: dup.specId,
        quantity: dup.quantity,
        unit_price: dup.unitPrice,
        total_amount: dup.totalAmount,
      },
    },
  };
}

export async function getResellerOrderStatus(
  env: Env,
  agent: ActiveResellerAgent,
  lookup: { orderNo?: string; idempotencyKey?: string }
) {
  if (!lookup.orderNo && !lookup.idempotencyKey) {
    return { status: 400, body: { error: 'order_no or idempotency_key is required' } };
  }
  const db = createDb(env.DB);
  const row = lookup.orderNo
    ? await findResellerOrderByNo(db, agent.id, lookup.orderNo)
    : await findResellerIdempotentOrder(db, agent.id, `b2b:${agent.id}:${lookup.idempotencyKey}`);
  if (!row) return { status: 404, body: { error: 'Order not found' } };
  return buildIdempotentReplayResponse(env, row, agent);
}

/** B2B 批采 API Key 鉴权（仅支持 Bearer / X-API-Key 请求头，禁止 URL ?api_key= 防日志泄露，并执行 IP 白名单校验） */
export async function authenticateResellerKey(req: Request, env: Env): Promise<ResellerAuthResult> {
  const auth = req.headers.get('Authorization') || '';
  const url = new URL(req.url);
  let apiKey = '';
  if (auth.startsWith('Bearer ')) apiKey = auth.slice(7).trim();
  else if (req.headers.get('X-API-Key')) apiKey = (req.headers.get('X-API-Key') || '').trim();
  if (!apiKey) {
    if (url.searchParams.has('api_key')) {
      return {
        error:
          'Passing API key via URL query (?api_key=) is disabled; use Authorization: Bearer or X-API-Key header',
        status: 401,
      };
    }
    return { error: 'Invalid or missing reseller API key', status: 401 };
  }

  const db = createDb(env.DB);
  const agent = await findActiveResellerByApiKey(db, apiKey);
  if (!agent) return { error: 'Invalid or suspended reseller API key', status: 401 };

  const rawWl = agent.apiIpWhitelist.trim();
  if (rawWl) {
    const allowed = new Set(
      rawWl
        .split(/[\r\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const callerIp = getClientIp(req);
    if (allowed.size > 0 && !allowed.has(callerIp)) {
      return {
        error: `IP_NOT_IN_WHITELIST: 请求 IP (${callerIp}) 不在对接白名单中`,
        status: 403,
      };
    }
  }

  return { agent };
}

/** 构造代理余额与折扣信息响应 */
export function buildResellerBalancePayload(agent: ActiveResellerAgent) {
  return {
    agent_slug: agent.slug,
    brand_name: agent.brandName,
    tier_name: agent.tierName,
    tier_discount_rate: agent.tierDiscountRate,
    balance: agent.balance,
    total_recharged: agent.totalRecharged,
    total_commission: agent.totalCommission,
  };
}

/** B2B 批采自动出卡下单（L1 先抢占订单槽位 + 幂等防重 + CAS 余额扣款 + S8 延迟分润 + L5 竞态保护） */
export async function createResellerOrder(
  env: Env,
  agent: ActiveResellerAgent,
  body: {
    product_id?: number;
    spec_id?: string;
    quantity?: number;
    customer_ref?: string;
    idempotency_key?: string;
    out_trade_no?: string;
  },
  headerIdemKey: string | undefined,
  originUrl: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!body.product_id) return { status: 400, body: { error: 'product_id is required' } };

  const rawQty = body.quantity === undefined ? 1 : Number(body.quantity);
  if (!Number.isInteger(rawQty) || rawQty < 1 || rawQty > 20) {
    return { status: 400, body: { error: 'quantity must be an integer between 1 and 20' } };
  }
  const qty = rawQty;
  const db = createDb(env.DB);

  const rawIdemKey = (body.idempotency_key || body.out_trade_no || headerIdemKey || '').trim();
  if (rawIdemKey.length > 64) {
    return { status: 400, body: { error: 'Idempotency key exceeds 64 characters' } };
  }
  const scopedIdemKey = rawIdemKey ? `b2b:${agent.id}:${rawIdemKey}` : null;
  const contactEmail = String(body.customer_ref || agent.ownerEmail).trim();
  const productId = Number(body.product_id);
  const requestedSpec = body.spec_id || '';
  const requestDigest = scopedIdemKey
    ? await sha256Hex(JSON.stringify([productId, requestedSpec, qty, contactEmail]))
    : null;
  const replay = async (dup: NonNullable<Awaited<ReturnType<typeof findResellerIdempotentOrder>>>) => {
    const matches = dup.resellerRequestDigest
      ? dup.resellerRequestDigest === requestDigest
      : dup.productId === productId &&
        dup.quantity === qty &&
        dup.contactEmail === contactEmail &&
        (!requestedSpec || requestedSpec === dup.specId);
    if (!matches) {
      return { status: 409, body: { error: 'Idempotency key was already used with a different order' } };
    }
    if (dup.status === 'processing') {
      if (await completeImmediateOrderAbort(db, dup.orderNo)) {
        const refunded = await findResellerOrderByNo(db, agent.id, dup.orderNo);
        if (refunded)
          return buildIdempotentReplayResponse(env, refunded, {
            ...agent,
            balance: await getUserBalance(db, agent.userId),
          });
      }
      return { status: 409, body: { error: 'Duplicate request is currently processing' } };
    }
    return buildIdempotentReplayResponse(env, dup, agent);
  };
  if (scopedIdemKey) {
    const dup = await findResellerIdempotentOrder(db, agent.id, scopedIdemKey);
    if (dup) return replay(dup);
  }

  const product = await findActiveProductForOrder(db, productId);
  if (!product) return { status: 404, body: { error: 'Product not found' } };

  const tierDiscount = agent.tierDiscountRate;
  const specs = safeJsonParse<ProductSpec[]>(product.specsJson || '[]', []);
  const matchedSpec = specs.find((s) => s.id === body.spec_id);
  if (body.spec_id && !matchedSpec && !(specs.length === 0 && body.spec_id === 'default')) {
    return { status: 400, body: { error: 'Invalid spec_id for product' } };
  }
  const spec = matchedSpec || specs[0] || { id: 'default', name: '标准版', price: Number(product.basePrice) };

  const baseMainTotal = Number((spec.price * qty).toFixed(2));
  const unitPrice = Number((spec.price * tierDiscount).toFixed(2));
  const totalAmount = Number((unitPrice * qty).toFixed(2));

  const stockMode = product.stockMode || 'cards';
  const deliveryType = product.deliveryType || 'auto';
  const availability = await checkSpecAvailability(env, {
    productId: product.id,
    spec,
    specsCount: specs.length,
    quantity: qty,
    stockMode,
    deliveryType,
    manualStock: Number(product.manualStock || 0),
    seatTotal: Number(product.seatTotal || 5),
    seatUsed: Number(product.seatUsed || 0),
  });
  if (!availability.available) {
    return { status: 409, body: { error: availability.errorMessage || 'Insufficient stock' } };
  }

  const snapWarrantyType = normalizeWarrantyType(product.warrantyType);
  const snapWarrantyDays = Math.max(
    0,
    Math.floor(Number(product.warrantyDays ?? (snapWarrantyType === 'none' ? 0 : 30)))
  );
  const snapWarrantySummary =
    (product.warrantySummary || '').trim() ||
    buildWarrantySummaryTemplate(snapWarrantyType, snapWarrantyDays);
  // L1 核心防线：在扣款和上游下单前，用数据库唯一索引原子抢占 processing 占位单
  let orderNo = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidateNo = generateBizNo('B2B');
    const claim = await claimOrderSlotAtomic(db, {
      orderNo: candidateNo,
      idempotencyKey: scopedIdemKey,
      resellerRequestDigest: requestDigest,
      userId: agent.userId,
      agentId: agent.id,
      tenantSlug: agent.slug,
      contactEmail,
      productId: product.id,
      productTitle: product.title,
      specId: spec.id,
      specName: spec.name,
      quantity: qty,
      unitPrice,
      totalAmount,
      commissionAmount: 0,
      paymentMethod: 'balance',
      channel: 'reseller_api',
      status: 'processing',
      deliveredPayload: '',
      warrantyType: snapWarrantyType,
      warrantyDays: snapWarrantyDays,
      warrantySummary: snapWarrantySummary,
    });
    if (claim.claimed) {
      orderNo = candidateNo;
      break;
    }
    if (claim.reason === 'idempotency' && scopedIdemKey) {
      const dup = await findResellerIdempotentOrder(db, agent.id, scopedIdemKey);
      if (dup) return replay(dup);
      return { status: 409, body: { error: 'Duplicate request is currently processing' } };
    }
  }
  if (!orderNo) return { status: 409, body: { error: 'Order allocation conflict, please retry' } };

  const rollback = async () => {
    await requestImmediateOrderAbort(db, orderNo);
    await releaseAbortedOrderSlotRepo(db, orderNo, 'processing').catch(() => undefined);
  };
  const deducted = await postBalanceOrderDebit(db, {
    orderNo,
    userId: agent.userId,
    amount: totalAmount,
    note: `API 批采「${product.title} (${spec.name}) × ${qty}」`,
  }).catch(async (error: unknown) => {
    await rollback();
    throw error;
  });
  if (!deducted) {
    await releaseAbortedOrderSlotRepo(db, orderNo, 'processing').catch(() => undefined);
    return {
      status: 402,
      body: { error: `Insufficient agent balance. Required ¥${totalAmount}, available ¥${agent.balance}` },
    };
  }
  const guard = totalAmount > 0 ? balanceOrderActive(db, orderNo) : undefined;
  const renewLease = guard ? () => renewBalanceOrder(db, orderNo) : undefined;

  let fulfill: Awaited<ReturnType<typeof executeUnifiedFulfillment>>;
  try {
    fulfill = await executeUnifiedFulfillment(env, {
      orderNo,
      channel: 'reseller_api',
      paymentMethod: 'balance',
      productId: product.id,
      productTitle: product.title,
      spec,
      specsCount: specs.length,
      quantity: qty,
      stockMode,
      deliveryType,
      contactEmail,
      totalAmount,
      originUrl,
      availability,
      guard,
      renewLease,
      postLocalStock: guard
        ? (mode) =>
            postBalanceOrderStock(db, orderNo, {
              productId: product.id,
              quantity: qty,
              mode,
              guard,
            })
        : undefined,
    });
  } catch (err) {
    if (!guard) await rollback();
    throw err;
  }

  if (!fulfill.ok) {
    await rollback();
    return {
      status: 409,
      body: { error: fulfill.conflictError || 'Insufficient stock, balance refunded.' },
    };
  }

  // S8 防护：仅在明确交付(delivered)或人工接单(paid)时结算上级极差，upstream_pending 延后至出卡时结算
  let commissionAmount = 0;
  if (fulfill.orderStatus === 'delivered' || fulfill.orderStatus === 'paid') {
    const settlement = await settleRecursiveOrderProfits({
      env,
      orderNo,
      sellingAgentId: agent.id,
      baseMainTotal,
      totalAmount,
      mode: 'b2b_api',
      guard,
    });
    commissionAmount = settlement.totalSettledToChain;
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
    return { status: 409, body: { error: 'Order recovery is in progress' } };
  }

  // L5 抢跑防护：若上游回调已在几毫秒内先一步交付，直接使用最新终态与卡密
  const finalStatus = casRes.updated ? fulfill.orderStatus : casRes.current?.status || fulfill.orderStatus;
  const finalCards =
    finalStatus !== 'delivered'
      ? []
      : casRes.updated
        ? fulfill.deliveredLines
        : (await readDeliveryPayload(env, orderNo, casRes.current?.deliveredPayload || ''))
            .split('\n')
            .filter(Boolean);

  const remainingBalance = await getUserBalance(db, agent.userId);

  return {
    status: 200,
    body: {
      ok: true,
      order_no: orderNo,
      status: finalStatus,
      tier_name: agent.tierName,
      discount_rate: tierDiscount,
      unit_wholesale_price: unitPrice,
      total_deducted: finalStatus === 'refunded' ? 0 : totalAmount,
      remaining_balance: remainingBalance,
      cards: finalCards,
      order: {
        order_no: orderNo,
        status: finalStatus,
        product_id: product.id,
        spec_id: spec.id,
        quantity: qty,
        unit_price: unitPrice,
        total_amount: totalAmount,
      },
    },
  };
}
