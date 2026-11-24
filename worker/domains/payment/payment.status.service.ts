import { type Env, isSandboxEnabled, type TenantContext } from '../../env';
import { timingSafeEqual } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { dispatchOpsNotification } from '../../infra/notify';
import { getUserBalance } from '../account/wallet.repo';
import { getAuthUser } from '../auth/auth.service';
import { sanitizeOrderForUser } from '../orders/order-snapshot.repo';
import { buyerOrderNumber, lockedOrder, mayReadOrder } from '../orders/orders.access';
import {
  findUsdtTransferCandidatesRepo,
  listMatchedProviderTradeNosRepo,
  listUsdtMatchCandidatesRepo,
} from './payment.fulfill.repo';
import { syncLiveExchangeRates } from './payment.fx';
import {
  fetchRecentUsdtChainTransfers,
  isUsdtProvider,
  loadPaymentPluginConfig,
  type UsdtChainProvider,
  type UsdtPluginConfig,
} from './payment.gateway';
import { expireOverdueIntentsAndOrders, findOrderByNo, markPaymentIntentExpired } from './payment.order.repo';
import { mayFulfillPayment } from './payment.provenance';
import { parsePaymentMinorUnits } from './payment.receipt';
import { recoverSinglePaidIntent, recoverUnfulfilledPaidIntents } from './payment.recovery';
import { findPaymentIntentByNo, type PaymentIntentRow } from './payment.repo';
import { completePaymentIntent } from './payment.service';
import { usdtAtomicAmount } from './payment.usdt';

/** 单笔支付单主动查链 15 秒防抖节流桶（S4 防刷爆链上浏览器 API 配额） */
const usdtCheckThrottle = new Map<string, number>();

function tryAcquireUsdtCheckSlot(intentNo: string): boolean {
  const now = Date.now();
  const last = usdtCheckThrottle.get(intentNo) ?? 0;
  if (now - last < 15_000) return false;
  if (usdtCheckThrottle.size > 1000) {
    for (const [k, ts] of usdtCheckThrottle.entries()) {
      if (now - ts >= 60_000) usdtCheckThrottle.delete(k);
    }
  }
  usdtCheckThrottle.set(intentNo, now);
  return true;
}

/** 扫描活跃 + 2 小时宽限期内的 USDT 支付单并匹配未被占用的链上交易（S5 防一笔多核 + L3 防漏单） */
async function matchUsdtIntentsOnChain(
  env: Env,
  intents: PaymentIntentRow[],
  chainProvider: UsdtChainProvider,
  originUrl: string
): Promise<number> {
  const plugin = await loadPaymentPluginConfig<UsdtPluginConfig>(env, chainProvider);
  if (!plugin.enabled || !plugin.config.wallet_address) return 0;

  let oldestCreatedMs = Date.now() - 30 * 60 * 1000;
  for (const intent of intents) {
    const ms = Date.parse(`${intent.created_at.replace(' ', 'T')}Z`);
    if (Number.isFinite(ms) && ms > 0 && ms < oldestCreatedMs) {
      oldestCreatedMs = ms;
    }
  }

  let transfers: Awaited<ReturnType<typeof fetchRecentUsdtChainTransfers>>;
  try {
    transfers = await fetchRecentUsdtChainTransfers(
      chainProvider,
      plugin.config,
      Math.max(0, oldestCreatedMs - 60_000)
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[USDT_CHAIN_FETCH_FAILED] ${chainProvider}:`, errMsg);
    void dispatchOpsNotification(
      env,
      'upstream_alert',
      `【USDT 链上核单异常】${chainProvider.toUpperCase()}`,
      [`链上转账查询失败（非空交易，已暂停本轮核单等待重试）：${errMsg}`]
    );
    return 0;
  }

  if (transfers.length === 0) return 0;
  const db = createDb(env.DB);
  const usedTxIds = await listMatchedProviderTradeNosRepo(
    db,
    chainProvider,
    transfers.map((t) => t.transactionId)
  );

  const wallet = plugin.config.wallet_address.trim();
  const recipient = chainProvider === 'usdt_trc20' ? wallet : wallet.toLowerCase();

  let matchedCount = 0;
  for (const intent of intents) {
    if (intent.currency !== 'USDT' || !mayFulfillPayment(env, intent)) continue;
    if (
      (chainProvider === 'usdt_trc20' ? intent.qr_content : intent.qr_content.toLowerCase()) !== recipient
    ) {
      continue;
    }
    const amtKey = parsePaymentMinorUnits(intent.pay_amount, 4);
    if (amtKey === null) continue;
    const createdMs = Date.parse(`${intent.created_at.replace(' ', 'T')}Z`);
    const validUntilMs = Date.parse(`${intent.expires_at.replace(' ', 'T')}Z`) + 2 * 3600_000;
    if (!Number.isFinite(createdMs) || !Number.isFinite(validUntilMs)) continue;
    const expectedAtomic = usdtAtomicAmount(chainProvider, amtKey);
    const match = transfers.find(
      (tx) =>
        !usedTxIds.has(tx.transactionId) &&
        tx.blockTimestampMs >= createdMs &&
        tx.blockTimestampMs <= validUntilMs &&
        tx.amountAtomic === expectedAtomic
    );
    if (!match) continue;
    const candidates = await findUsdtTransferCandidatesRepo(db, {
      provider: chainProvider,
      recipient,
      payAmount: intent.pay_amount,
      timestamp: new Date(match.blockTimestampMs).toISOString().replace('T', ' ').slice(0, 19),
    });
    if (candidates.length !== 1 || candidates[0].id !== intent.id) continue;

    usedTxIds.add(match.transactionId);
    const res = await completePaymentIntent(env, {
      intentNo: intent.intent_no,
      receipt: {
        provider: chainProvider,
        currency: 'USDT',
        tradeNo: match.transactionId,
        amountMinor: amtKey,
      },
      originUrl,
    });
    if (res.ok && !res.alreadyPaid) matchedCount += 1;
  }

  return matchedCount;
}

async function readPaymentAccess(
  env: Env,
  db: ReturnType<typeof createDb>,
  req: Request,
  tenant: TenantContext,
  intent: PaymentIntentRow
) {
  const extra = safeJsonParse<Record<string, unknown>>(intent.payload_json, {});
  const user = await getAuthUser(req, env, tenant).catch(() => null);
  const accountOwner = user?.role === 'admin' || (user !== null && user.id === intent.user_id);
  const token = (req.headers.get('X-Intent-Token') || '').trim();
  const guestSession = Boolean(
    intent.user_id === null &&
      token &&
      typeof extra.view_token === 'string' &&
      timingSafeEqual(token, extra.view_token)
  );
  if (intent.biz_type !== 'order' || (!accountOwner && !guestSession)) {
    return { authorized: accountOwner, accountOwner, order: null, extra };
  }
  const order = await findOrderByNo(db, intent.biz_ref);
  const authorized = Boolean(
    order &&
      order.userId === intent.user_id &&
      (order.agentId ?? 0) === intent.site_agent_id &&
      (await mayReadOrder(order, user, { authorized: guestSession, checkoutSession: true }))
  );
  return { authorized, accountOwner, order, extra };
}

/** 未授权轮询只返回状态。支付参数和订单正文需要归属账号或原收银台会话。 */
export async function getPaymentIntentStatus(
  env: Env,
  req: Request,
  tenant: TenantContext,
  intentNo: string
) {
  const db = createDb(env.DB);
  let intent = await findPaymentIntentByNo(db, intentNo);
  if (!intent || intent.site_agent_id !== (tenant.agentId ?? 0) || !mayFulfillPayment(env, intent)) {
    throw Errors.notFound('支付单不存在');
  }

  const access = await readPaymentAccess(env, db, req, tenant, intent);
  if (!access.authorized) {
    return {
      locked: true as const,
      intent: { intent_no: intent.intent_no, status: intent.status },
      order: intent.status === 'paid' && intent.biz_type === 'order' ? lockedOrder : null,
    };
  }

  if (intent.status === 'pending') {
    const expMs = Date.parse(`${intent.expires_at.replace(' ', 'T')}Z`);
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      await markPaymentIntentExpired(db, intentNo);
      intent = (await findPaymentIntentByNo(db, intentNo)) ?? intent;
    }
  }

  let userBalance: number | undefined;
  // 仅当调用方为已登录订单归属人或总控管理员时返回最新余额，匿名轮询绝不透出他人账户余额
  if (
    intent.status === 'paid' &&
    (intent.biz_type !== 'wallet_recharge' || intent.fulfill_status === 'done') &&
    intent.user_id &&
    access.accountOwner
  ) {
    userBalance = await getUserBalance(db, intent.user_id);
  }

  return {
    intent: {
      intent_no: intent.intent_no,
      biz_type: intent.biz_type,
      biz_ref: access.order ? buyerOrderNumber(access.order) : intent.biz_ref,
      provider: intent.provider,
      currency: intent.currency,
      amount_cny: Number(intent.amount_cny),
      pay_amount: Number(intent.pay_amount),
      pay_url: intent.pay_url,
      qr_content: intent.qr_content,
      status: intent.status,
      fulfill_status: intent.fulfill_status,
      expires_at: intent.expires_at,
      paid_at: intent.paid_at,
      sandbox_simulated: access.extra.sandbox_simulated === true && isSandboxEnabled(env),
    },
    order: intent.status === 'paid' && access.order ? await sanitizeOrderForUser(env, access.order) : null,
    balance: userBalance,
  };
}

/** 定时维护：先核销含 2h 宽限窗的 USDT 链上转账 → 再清理过期单据 → 汇率同步 → L2 补偿未履约单 */
export async function runScheduledPaymentMaintenance(
  env: Env,
  originUrl = ''
): Promise<{ expiredIntents: number; matchedUsdt: number; recoveredPaid: number }> {
  const db = createDb(env.DB);
  let matchedUsdt = 0;

  // L3：在过期关单之前先扫链上转账，让临近过期压线付款的订单直接正常成单
  const usdtCandidates = await listUsdtMatchCandidatesRepo(db);
  if (usdtCandidates.length > 0) {
    const grouped = new Map<UsdtChainProvider, PaymentIntentRow[]>();
    for (const intent of usdtCandidates) {
      if (!isUsdtProvider(intent.provider)) continue;
      const list = grouped.get(intent.provider) || [];
      list.push(intent);
      grouped.set(intent.provider, list);
    }
    for (const [chainProvider, intents] of grouped.entries()) {
      matchedUsdt += await matchUsdtIntentsOnChain(env, intents, chainProvider, originUrl);
    }
  }

  const expiredIntents = await expireOverdueIntentsAndOrders(db);
  await syncLiveExchangeRates(env).catch(() => undefined);

  const compRes = await recoverUnfulfilledPaidIntents(env, originUrl).catch(() => ({
    recovered: 0,
    failed: 0,
  }));

  return { expiredIntents, matchedUsdt, recoveredPaid: compRes.recovered };
}

/** S4 解耦加固：单笔支付单按需即时检查（绝不触发全站汇率同步与全量维护扫描，对 USDT 实行 15s 防抖） */
export async function checkPaymentIntentNow(env: Env, req: Request, tenant: TenantContext, intentNo: string) {
  const db = createDb(env.DB);
  let intent = await findPaymentIntentByNo(db, intentNo);
  if (
    !intent ||
    intent.site_agent_id !== (tenant.agentId ?? 0) ||
    !mayFulfillPayment(env, intent) ||
    !(await readPaymentAccess(env, db, req, tenant, intent)).authorized
  ) {
    throw Errors.notFound('支付单不存在');
  }
  const originUrl = new URL(req.url).origin;

  if (intent.status === 'paid' && intent.fulfill_status !== 'done') {
    await recoverSinglePaidIntent(env, intentNo, originUrl);
    intent = (await findPaymentIntentByNo(db, intentNo)) ?? intent;
  } else if (
    isUsdtProvider(intent.provider) &&
    (intent.status === 'pending' ||
      (intent.status === 'expired' &&
        Date.parse(`${intent.expires_at.replace(' ', 'T')}Z`) >= Date.now() - 2 * 3600_000))
  ) {
    if (tryAcquireUsdtCheckSlot(intentNo)) {
      const targetProvider = intent.provider;
      await matchUsdtIntentsOnChain(env, [intent], targetProvider, originUrl);
      intent = (await findPaymentIntentByNo(db, intentNo)) ?? intent;
    }
  } else if (intent.status === 'pending') {
    const expMs = Date.parse(`${intent.expires_at.replace(' ', 'T')}Z`);
    if (Number.isFinite(expMs) && expMs <= Date.now()) {
      await markPaymentIntentExpired(db, intentNo);
      intent = (await findPaymentIntentByNo(db, intentNo)) ?? intent;
    }
  }

  return { ok: true, status: intent.status, paid_at: intent.paid_at };
}
