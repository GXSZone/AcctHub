import type { AsyncPaymentProvider, PaymentBizType } from '@shared/constants/enums';
import { type Env, isSandboxEnabled } from '../../env';
import { generateRandomCode } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { dispatchOpsNotification } from '../../infra/notify';
import {
  type AlipayF2FConfig,
  allocateUniqueUsdtAmount,
  createAlipayFaceToFaceSession,
  createEpaySession,
  createStripeCheckoutSession,
  type EpayPluginConfig,
  isUsdtProvider,
  loadPaymentPluginConfig,
  type StripePluginConfig,
  type UsdtPluginConfig,
} from './payment.gateway';
import { isSimulatedTrade, mayFulfillPayment } from './payment.provenance';
import { type PaymentReceipt, validatePaymentReceipt } from './payment.receipt';
import { executeFulfillForPaidIntent, finalizeFulfilledPayment } from './payment.recovery';
import {
  claimPaidIntentForFulfillRetryAtomic,
  findPaymentIntentByNo,
  insertPaymentIntentRecord,
  isPaymentUniqueConflict,
  lockPaymentIntentPaidAtomic,
  markIntentFulfillFailedRepo,
  type PaymentIntentRow,
} from './payment.repo';

export {
  checkPaymentIntentNow,
  getPaymentIntentStatus,
  runScheduledPaymentMaintenance,
} from './payment.status.service';
export {
  processAlipayWebhook,
  processEpayWebhook,
  processStripeWebhook,
  simulateSandboxPayment,
} from './payment.webhook.service';
export type { PaymentIntentRow };

function generatePaymentIntentNo(): string {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const ts = Date.now().toString().slice(-8);
  const suffix = String(100000 + (rand[0] % 900000));
  return `PAY${ts}${suffix}`;
}

function formatSqlUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** 统一创建异步支付单（支持 USDT 并发尾数唯一冲突自动重试） */
export async function createPaymentIntent(
  env: Env,
  input: {
    bizType: PaymentBizType;
    bizRef: string;
    userId: number | null;
    siteAgentId: number;
    paymentOwnerAgentId?: number;
    settlementMode?: 'platform_collect' | 'tenant_direct_collect';
    provider: AsyncPaymentProvider;
    amountCny: number;
    subject: string;
    originUrl: string;
    returnUrl: string;
    customerEmail?: string;
    payload?: Record<string, unknown>;
    ttlMinutes?: number;
  }
): Promise<PaymentIntentRow & { sandbox_simulated: boolean }> {
  const intentNo = generatePaymentIntentNo();
  const ttlMs = Math.max(5, Math.min(60, input.ttlMinutes ?? 20)) * 60 * 1000;
  const expiresAt = formatSqlUtc(Date.now() + ttlMs);

  let currency = 'CNY';
  let payAmount = Number(input.amountCny.toFixed(2));
  let payUrl = '';
  let qrContent = '';
  let providerTradeNo = '';
  let sandboxSimulated = false;
  let usdtConfig: UsdtPluginConfig | null = null;
  const paymentOwnerId = input.paymentOwnerAgentId ?? 0;
  const settlementMode =
    input.settlementMode ?? (paymentOwnerId > 0 ? 'tenant_direct_collect' : 'platform_collect');

  if (input.provider === 'epay') {
    const plugin = await loadPaymentPluginConfig<EpayPluginConfig>(env, 'epay', paymentOwnerId);
    if (!plugin.enabled) throw Errors.validation('易支付网关尚未启用，请切换其他支付方式');
    const session = await createEpaySession(env, plugin.config, {
      intentNo,
      subject: input.subject,
      amountCny: input.amountCny,
      originUrl: input.originUrl,
      returnUrl: input.returnUrl,
    });
    ({ currency, payAmount, payUrl, qrContent, providerTradeNo, sandboxSimulated } = session);
  } else if (input.provider === 'stripe') {
    const plugin = await loadPaymentPluginConfig<StripePluginConfig>(env, 'stripe', paymentOwnerId);
    if (!plugin.enabled) throw Errors.validation('Stripe 国际卡支付尚未启用，请切换其他支付方式');
    const session = await createStripeCheckoutSession(env, plugin.config, {
      intentNo,
      subject: input.subject,
      amountCny: input.amountCny,
      originUrl: input.originUrl,
      returnUrl: input.returnUrl,
      customerEmail: input.customerEmail,
    });
    ({ currency, payAmount, payUrl, qrContent, providerTradeNo, sandboxSimulated } = session);
  } else if (input.provider === 'alipay_f2f') {
    const plugin = await loadPaymentPluginConfig<AlipayF2FConfig>(env, 'alipay_f2f', paymentOwnerId);
    if (!plugin.enabled) throw Errors.validation('支付宝当面付尚未启用，请切换其他支付方式');
    const session = await createAlipayFaceToFaceSession(env, plugin.config, {
      intentNo,
      subject: input.subject,
      amountCny: input.amountCny,
      originUrl: input.originUrl,
    });
    ({ currency, payAmount, payUrl, qrContent, providerTradeNo, sandboxSimulated } = session);
  } else if (isUsdtProvider(input.provider)) {
    const plugin = await loadPaymentPluginConfig<UsdtPluginConfig>(env, input.provider, paymentOwnerId);
    if (!plugin.enabled) {
      throw Errors.validation(`${input.provider.toUpperCase()} 链上支付尚未启用，请切换其他支付方式`);
    }
    usdtConfig = plugin.config;
    const usdt = await allocateUniqueUsdtAmount(env, input.amountCny, plugin.config, input.provider);
    currency = 'USDT';
    payAmount = usdt.payAmount;
    qrContent = usdt.walletAddress;
    sandboxSimulated = usdt.sandboxSimulated;
  }

  const db = createDb(env.DB);
  const viewToken = generateRandomCode('vt_', 24);
  const maxAttempts = usdtConfig ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0 && usdtConfig && isUsdtProvider(input.provider)) {
      const usdt = await allocateUniqueUsdtAmount(env, input.amountCny, usdtConfig, input.provider);
      payAmount = usdt.payAmount;
    }
    try {
      const created = await insertPaymentIntentRecord(db, {
        intentNo,
        bizType: input.bizType,
        bizRef: input.bizRef,
        userId: input.userId,
        siteAgentId: input.siteAgentId,
        paymentOwnerAgentId: paymentOwnerId,
        settlementMode,
        provider: input.provider,
        currency,
        amountCny: Number(input.amountCny.toFixed(2)),
        payAmount,
        payUrl,
        qrContent,
        providerTradeNo,
        payloadJson: JSON.stringify({
          ...(input.payload || {}),
          sandbox_simulated: sandboxSimulated,
          view_token: viewToken,
        }),
        expiresAt,
      });
      if (!created) throw Errors.validation('创建异步支付单失败');
      return { ...created, view_token: viewToken, sandbox_simulated: sandboxSimulated };
    } catch (err) {
      const isUsdtAmountConflict =
        usdtConfig && isPaymentUniqueConflict(err, 'uq_usdt_active_pay_amount', 'pay_amount');
      if (isUsdtAmountConflict && attempt + 1 < maxAttempts) {
        continue;
      }
      throw err;
    }
  }
  throw Errors.conflict('当前该金额收款通道拥堵，请稍后重试');
}

/**
 * 统一支付成功回调履约引擎（L2 加固版）：
 * 1) CAS 原子锁状态为 paid + fulfill_status = 'processing'，同时利用唯一流水约束防单笔重复核销多单；
 * 2) 若履约中途抛错，写 fulfill_status = 'failed' 并发出告警，重放回调可重入补偿继续履约，绝不静默丢单。
 */
export async function completePaymentIntent(
  env: Env,
  params: {
    intentNo: string;
    receipt: PaymentReceipt;
    originUrl: string;
  }
): Promise<{ ok: boolean; alreadyPaid?: boolean; bizType?: PaymentBizType; bizRef?: string; note?: string }> {
  const db = createDb(env.DB);
  let intent = await findPaymentIntentByNo(db, params.intentNo);
  if (!intent) return { ok: false, note: '支付单不存在' };

  const sandbox = isSandboxEnabled(env);
  if (!sandbox && (params.receipt.sandbox || isSimulatedTrade(params.receipt.tradeNo))) {
    return { ok: false, note: '此环境拒绝模拟支付收据' };
  }
  if (!mayFulfillPayment(env, intent)) return { ok: false, note: '此支付单不允许在当前环境核销' };

  const invalidReceipt = validatePaymentReceipt(intent, params.receipt);
  if (invalidReceipt) return { ok: false, note: invalidReceipt };

  let recovering = intent.status === 'paid';
  let claimed: PaymentIntentRow | null = null;
  if (!recovering) {
    const locked = await lockPaymentIntentPaidAtomic(db, intent, params.receipt.tradeNo);
    if (locked.locked) {
      claimed = locked.intent;
    } else {
      if (locked.reason === 'trade_conflict') return { ok: false, note: '外部交易流水已被其他支付单核销' };
      const latest = await findPaymentIntentByNo(db, params.intentNo);
      if (latest?.status !== 'paid') {
        return { ok: false, note: '支付单状态已变更，需重新核对收据' };
      }
      if (!mayFulfillPayment(env, latest)) return { ok: false, note: '此支付单不允许在当前环境核销' };
      const invalidLatestReceipt = validatePaymentReceipt(latest, params.receipt);
      if (invalidLatestReceipt) return { ok: false, note: invalidLatestReceipt };
      intent = latest;
      recovering = true;
    }
  }

  if (recovering && intent.fulfill_status !== 'done') {
    claimed = await claimPaidIntentForFulfillRetryAtomic(db, intent.intent_no, sandbox);
  }
  if (!claimed) return { ok: true, alreadyPaid: true, bizType: intent.biz_type, bizRef: intent.biz_ref };

  try {
    await executeFulfillForPaidIntent(env, claimed, params.originUrl, {
      allowProcessingRecovery: recovering,
    });
    const done = await finalizeFulfilledPayment(db, claimed);
    return { ok: true, alreadyPaid: recovering || !done, bizType: claimed.biz_type, bizRef: claimed.biz_ref };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const marked = await markIntentFulfillFailedRepo(db, claimed.intent_no, claimed.fulfill_lease_token, msg);
    if (marked) {
      void dispatchOpsNotification(env, 'upstream_alert', '支付已确认但履约失败，等待补偿', [
        `支付单号：${claimed.intent_no}（${claimed.biz_type} / ${claimed.biz_ref}）`,
        `交易流水：${params.receipt.tradeNo}`,
        `异常原因：${msg}`,
      ]);
    }
    return { ok: false, note: `支付单已付款但履约异常（已记录待补偿）：${msg}` };
  }
}
