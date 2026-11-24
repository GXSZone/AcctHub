import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import {
  type AlipayF2FConfig,
  type EpayPluginConfig,
  isUsdtProvider,
  loadPaymentPluginConfig,
  requireLiveStripeKeys,
  type StripePluginConfig,
  verifyAlipayRsa2Callback,
  verifyEpayCallback,
  verifyStripeWebhookSignature,
} from './payment.gateway';
import { parsePaymentMinorUnits, parsePaymentTradeNo } from './payment.receipt';
import { findPaymentIntentByNo } from './payment.repo';
import { completePaymentIntent } from './payment.service';

/** 易支付异步回调验签与履约处理（按支付单归属租户严格隔离密钥，严防跨租户伪造回调） */
export async function processEpayWebhook(
  env: Env,
  params: Record<string, string>,
  originUrl: string
): Promise<{ ok: boolean; reason?: string }> {
  const intentNo = (params.out_trade_no || '').trim();
  if (!intentNo) return { ok: false, reason: 'missing out_trade_no' };
  const db = createDb(env.DB);
  const intent = await findPaymentIntentByNo(db, intentNo);
  const paymentOwnerId = intent?.payment_owner_agent_id ?? 0;

  const plugin = await loadPaymentPluginConfig<EpayPluginConfig>(env, 'epay', paymentOwnerId);
  const check = verifyEpayCallback(params, String(plugin.config.key || ''));
  if (!check.valid) return { ok: false, reason: check.reason || 'invalid signature' };

  const tradeNo = parsePaymentTradeNo(params.trade_no);
  const money = parsePaymentMinorUnits(params.money, 2);
  if (!tradeNo || money === null || (params.currency !== undefined && params.currency !== 'CNY')) {
    return { ok: false, reason: '无效的易支付收据币种、金额或流水号' };
  }
  if (plugin.config.pid?.trim() && params.pid !== plugin.config.pid.trim()) {
    return { ok: false, reason: '易支付商户 PID 不一致' };
  }

  const res = await completePaymentIntent(env, {
    intentNo,
    receipt: { provider: 'epay', currency: 'CNY', tradeNo, amountMinor: money },
    originUrl,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.note || 'complete failed' };
}

/** Stripe Webhook 验签与履约处理（按支付单归属租户严格隔离 webhook_secret） */
export async function processStripeWebhook(
  env: Env,
  rawBody: string,
  sigHeader: string,
  originUrl: string
): Promise<{ received: true }> {
  const preEvent = safeJsonParse<{
    data?: { object?: { client_reference_id?: string; metadata?: Record<string, string> } };
  }>(rawBody, {});
  const preIntentNo = parsePaymentTradeNo(
    preEvent?.data?.object?.client_reference_id || preEvent?.data?.object?.metadata?.intent_no
  );
  const db = createDb(env.DB);
  const intent = preIntentNo ? await findPaymentIntentByNo(db, preIntentNo) : null;
  const paymentOwnerId = intent?.payment_owner_agent_id ?? 0;

  const plugin = await loadPaymentPluginConfig<StripePluginConfig>(env, 'stripe', paymentOwnerId);
  const check = await verifyStripeWebhookSignature(
    rawBody,
    sigHeader,
    String(plugin.config.webhook_secret || '')
  );
  if (!check.valid) throw Errors.unauthorized(check.reason || 'Stripe 回调验签失败');

  const event = safeJsonParse<{
    type?: string;
    livemode?: boolean;
    data?: {
      object?: {
        id?: string;
        client_reference_id?: string;
        amount_total?: unknown;
        payment_status?: string;
        currency?: unknown;
        object?: string;
        mode?: string;
        livemode?: boolean;
        metadata?: Record<string, string>;
      };
    };
  }>(rawBody, {});

  if (!isSandboxEnabled(env)) {
    requireLiveStripeKeys(plugin.config);
    if (event?.livemode !== true) throw Errors.validation('当前环境拒绝 Stripe 非正式模式事件');
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const obj = event.data?.object;
    if (!isSandboxEnabled(env) && obj?.livemode !== true) {
      throw Errors.validation('当前环境拒绝 Stripe 非正式模式 Checkout 会话');
    }
    if (event.type === 'checkout.session.completed' && obj?.payment_status === 'unpaid') {
      // 延迟付款方式的完成事件尚未收款，等待 async_payment_succeeded。
      return { received: true };
    }
    const intentNo = parsePaymentTradeNo(obj?.client_reference_id);
    const tradeNo = parsePaymentTradeNo(obj?.id);
    const currency = typeof obj?.currency === 'string' ? obj.currency.toUpperCase() : '';
    const amountMinor = obj?.amount_total;
    if (
      obj?.object !== 'checkout.session' ||
      obj.mode !== 'payment' ||
      obj.payment_status !== 'paid' ||
      !intentNo ||
      obj.metadata?.intent_no !== intentNo ||
      !tradeNo?.startsWith('cs_') ||
      !['USD', 'CNY', 'HKD'].includes(currency) ||
      typeof amountMinor !== 'number' ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0
    ) {
      throw Errors.validation('Stripe 收据缺少有效的已付款状态、会话号、币种或金额');
    }
    const res = await completePaymentIntent(env, {
      intentNo,
      receipt: { provider: 'stripe', currency, tradeNo, amountMinor },
      originUrl,
    });
    if (!res.ok) throw Errors.validation(res.note || '处理支付单失败');
  }

  return { received: true };
}

/** 支付宝官方当面付异步通知 RSA2 验签与履约处理（按支付单归属租户隔离公钥与 app_id） */
export async function processAlipayWebhook(
  env: Env,
  params: Record<string, string>,
  originUrl: string
): Promise<{ ok: boolean; reason?: string }> {
  const intentNo = (params.out_trade_no || '').trim();
  if (!intentNo) return { ok: false, reason: 'missing out_trade_no' };
  const db = createDb(env.DB);
  const intent = await findPaymentIntentByNo(db, intentNo);
  const paymentOwnerId = intent?.payment_owner_agent_id ?? 0;

  const plugin = await loadPaymentPluginConfig<AlipayF2FConfig>(env, 'alipay_f2f', paymentOwnerId);
  const check = await verifyAlipayRsa2Callback(params, String(plugin.config.alipay_public_key || ''));
  if (!check.valid) return { ok: false, reason: check.reason || 'invalid signature' };

  const configuredAppId = String(plugin.config.app_id || '').trim();
  if (!configuredAppId || params.app_id !== configuredAppId) {
    return { ok: false, reason: 'app_id mismatch' };
  }

  const tradeNo = parsePaymentTradeNo(params.trade_no);
  const paidAmount = parsePaymentMinorUnits(params.total_amount, 2);
  if (!tradeNo || paidAmount === null || (params.currency !== undefined && params.currency !== 'CNY')) {
    return { ok: false, reason: '无效的支付宝收据币种、金额或流水号' };
  }

  const res = await completePaymentIntent(env, {
    intentNo,
    receipt: { provider: 'alipay_f2f', currency: 'CNY', tradeNo, amountMinor: paidAmount },
    originUrl,
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.note || 'complete failed' };
}

/** 仅供开发构建的沙盒回调路由使用。 */
export async function simulateSandboxPayment(env: Env, intentNo: string, originUrl: string) {
  if (!isSandboxEnabled(env)) {
    throw Errors.sandboxDisabled('生产环境已禁用本地沙盒模拟支付回调');
  }
  const db = createDb(env.DB);
  const intent = await findPaymentIntentByNo(db, intentNo);
  if (!intent) throw Errors.notFound('支付单不存在');
  const extra = safeJsonParse<Record<string, unknown>>(intent.payload_json, {});
  if (extra.sandbox_simulated !== true) throw Errors.validation('此支付单不是模拟支付单');

  const amountMinor = parsePaymentMinorUnits(intent.pay_amount, isUsdtProvider(intent.provider) ? 4 : 2);
  if (amountMinor === null) throw Errors.validation('模拟支付单金额无效');

  const tradeNo = `SBX-MOCK-${intentNo}`;
  const receipt = isUsdtProvider(intent.provider)
    ? { provider: intent.provider, currency: 'USDT' as const, amountMinor, tradeNo, sandbox: true }
    : { provider: intent.provider, currency: intent.currency, amountMinor, tradeNo, sandbox: true };
  const res = await completePaymentIntent(env, {
    intentNo,
    receipt,
    originUrl,
  });
  if (!res.ok) throw Errors.validation(res.note || '沙盒回调执行失败');
  return res;
}
