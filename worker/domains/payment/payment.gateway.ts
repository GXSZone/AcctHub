import type { AsyncPaymentProvider } from '@shared/constants/enums';
import { and, eq } from 'drizzle-orm';
import { paymentPlugins, tenantPaymentPlugins } from '../../db/schema/index';
import { type Env, isSandboxEnabled } from '../../env';
import { hmacSha256Hex, md5Hex, timingSafeEqual } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { assertSafeOutboundUrl } from '../../infra/http';
import {
  parsePaymentPluginConfig,
  readPaymentPluginCredentials,
} from '../../infra/payment-credential-storage';
import { loadCachedFxSnapshot } from './payment.fx';
import { isSimulatedTrade } from './payment.provenance';

export type { AlipayF2FConfig } from './payment.alipay';
export {
  buildAlipaySignContent,
  createAlipayFaceToFaceSession,
  signAlipayRsa2,
  verifyAlipayRsa2Callback,
} from './payment.alipay';
export {
  allocateUniqueUsdtAmount,
  fetchRecentUsdtChainTransfers,
  type UsdtChainProvider,
} from './payment.usdt';

export interface EpayPluginConfig {
  api_url?: string;
  pid?: string;
  key?: string;
  pay_type?: string; // alipay / wxpay / qqpay
}

export interface StripePluginConfig {
  publishable_key?: string;
  secret_key?: string;
  webhook_secret?: string;
  currency?: string; // usd / cny / hkd
  usd_cny_rate?: string | number;
  hkd_cny_rate?: string | number;
  auto_fx?: string | boolean;
}

export function isStripeLiveSecret(key: string) {
  return /^(?:sk|rk)_live_[A-Za-z0-9_]+$/.test(key);
}

export function requireLiveStripeKeys(cfg: StripePluginConfig) {
  if (!isStripeLiveSecret(cfg.secret_key?.trim() || '')) {
    throw Errors.validation('当前环境仅允许 Stripe 正式 Secret Key');
  }
  const publishable = cfg.publishable_key?.trim();
  if (publishable && !/^pk_live_[A-Za-z0-9_]+$/.test(publishable)) {
    throw Errors.validation('当前环境仅允许 Stripe 正式 Publishable Key');
  }
}

export function validateStripeCurrencyConfig(cfg: StripePluginConfig): 'usd' | 'cny' | 'hkd' {
  const currency = (cfg.currency ?? 'usd').trim().toLowerCase();
  if (currency !== 'usd' && currency !== 'cny' && currency !== 'hkd') {
    throw Errors.validation('Stripe 币种仅支持 USD、CNY 和 HKD');
  }
  const rate = currency === 'hkd' ? cfg.hkd_cny_rate : currency === 'usd' ? cfg.usd_cny_rate : undefined;
  if (
    (currency === 'hkd' || (rate !== undefined && rate !== '')) &&
    (!Number.isFinite(Number(rate)) || Number(rate) <= 0)
  ) {
    throw Errors.validation(`Stripe ${currency.toUpperCase()} 兑人民币汇率必须为有限正数`);
  }
  return currency;
}

export interface UsdtPluginConfig {
  wallet_address?: string;
  usdt_cny_rate?: string | number;
  rate_markup?: string | number;
  auto_fx?: string | boolean;
  trongrid_api_key?: string;
  explorer_api_key?: string;
}

export interface GatewayCreateSessionResult {
  currency: string;
  payAmount: number;
  payUrl: string;
  qrContent: string;
  providerTradeNo: string;
  sandboxSimulated: boolean;
}

export function isUsdtProvider(method: string): method is 'usdt_trc20' | 'usdt_bep20' | 'usdt_erc20' {
  return method === 'usdt_trc20' || method === 'usdt_bep20' || method === 'usdt_erc20';
}

export function isAsyncPaymentProvider(method: string): method is AsyncPaymentProvider {
  return method === 'epay' || method === 'stripe' || method === 'alipay_f2f' || isUsdtProvider(method);
}

// =========================================================================
// 1. 易支付通用网关（标准 MD5 签名发单 & 异步回调验签）
// =========================================================================
export function buildEpaySignString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function signEpayParams(params: Record<string, string>, merchantKey: string): string {
  const base = buildEpaySignString(params);
  return md5Hex(`${base}${merchantKey}`).toLowerCase();
}

export function verifyEpayCallback(
  params: Record<string, string>,
  merchantKey: string
): { valid: boolean; reason?: string } {
  if (!merchantKey.trim()) {
    return { valid: false, reason: '易支付商户密钥未配置' };
  }
  const provided = (params.sign || '').trim().toLowerCase();
  if (!provided) {
    return { valid: false, reason: '缺少易支付回调签名 sign' };
  }
  const expected = signEpayParams(params, merchantKey.trim());
  if (!timingSafeEqual(provided, expected)) {
    return { valid: false, reason: '易支付 MD5 签名校验失败' };
  }
  if ((params.trade_status || '').toUpperCase() !== 'TRADE_SUCCESS') {
    return { valid: false, reason: `非成功交易状态：${params.trade_status || 'unknown'}` };
  }
  return { valid: true };
}

export async function createEpaySession(
  env: Env,
  cfg: EpayPluginConfig,
  input: {
    intentNo: string;
    subject: string;
    amountCny: number;
    originUrl: string;
    returnUrl: string;
  }
): Promise<GatewayCreateSessionResult> {
  const notifyOrigin = input.originUrl.replace(/\/+$/, '');
  const apiUrl = (cfg.api_url || '').trim().replace(/\/+$/, '');
  const pid = (cfg.pid || '').trim();
  const key = (cfg.key || '').trim();

  if (!apiUrl || !pid || !key) {
    if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
      const sandboxUrl = `${input.originUrl}/api/payments/sandbox/mock-gateway?intent=${encodeURIComponent(input.intentNo)}&provider=epay`;
      return {
        currency: 'CNY',
        payAmount: Number(input.amountCny.toFixed(2)),
        payUrl: sandboxUrl,
        qrContent: sandboxUrl,
        providerTradeNo: `EPAY-SBX-${input.intentNo}`,
        sandboxSimulated: true,
      };
    }
    throw Errors.validation('易支付网关尚未完成商户 PID / 网关地址 / 密钥配置');
  }

  assertSafeOutboundUrl(apiUrl, false);
  const params: Record<string, string> = {
    pid,
    type: (cfg.pay_type || 'alipay').trim(),
    out_trade_no: input.intentNo,
    notify_url: `${notifyOrigin}/api/payments/webhook/epay`,
    return_url: input.returnUrl,
    name: input.subject.slice(0, 60),
    money: input.amountCny.toFixed(2),
    sign_type: 'MD5',
  };
  params.sign = signEpayParams(params, key);

  const query = new URLSearchParams(params).toString();
  const submitUrl = `${apiUrl}/submit.php?${query}`;
  return {
    currency: 'CNY',
    payAmount: Number(input.amountCny.toFixed(2)),
    payUrl: submitUrl,
    qrContent: submitUrl,
    providerTradeNo: '',
    sandboxSimulated: false,
  };
}

// =========================================================================
// 2. Stripe Checkout（Hosted Checkout Session 创建 & HMAC-SHA256 防重放验签）
// =========================================================================
export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300
): Promise<{ valid: boolean; reason?: string }> {
  if (!webhookSecret.trim()) {
    return { valid: false, reason: 'Stripe Webhook Secret 未配置' };
  }
  const parts = signatureHeader.split(',').map((s) => s.trim());
  let timestamp = '';
  const signatures: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k === 't' && v) timestamp = v;
    if (k === 'v1' && v) signatures.push(v.toLowerCase());
  }
  if (!timestamp || signatures.length === 0) {
    return { valid: false, reason: '缺少有效的 Stripe-Signature 头' };
  }
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    return { valid: false, reason: 'Stripe 签名时间戳不合法' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > toleranceSeconds) {
    return { valid: false, reason: 'Stripe 回调时间戳超出防重放窗口' };
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = (await hmacSha256Hex(webhookSecret.trim(), signedPayload)).toLowerCase();
  const matched = signatures.some((sig) => timingSafeEqual(sig, expected));
  if (!matched) {
    return { valid: false, reason: 'Stripe HMAC-SHA256 签名验证失败' };
  }
  return { valid: true };
}

export async function createStripeCheckoutSession(
  env: Env,
  cfg: StripePluginConfig,
  input: {
    intentNo: string;
    subject: string;
    amountCny: number;
    originUrl: string;
    returnUrl: string;
    customerEmail?: string;
  }
): Promise<GatewayCreateSessionResult> {
  const secretKey = (cfg.secret_key || '').trim();
  const webhookSecret = (cfg.webhook_secret || '').trim();
  if (!isSandboxEnabled(env)) requireLiveStripeKeys(cfg);
  const currency = validateStripeCurrencyConfig(cfg);
  const autoFx = cfg.auto_fx !== false && String(cfg.auto_fx || '').toLowerCase() !== 'false';
  let rate =
    currency === 'hkd' ? Number(cfg.hkd_cny_rate) : currency === 'usd' ? Number(cfg.usd_cny_rate || 7.2) : 1;
  if (currency === 'usd' && autoFx) {
    const snap = await loadCachedFxSnapshot(env);
    if (snap.updated_at && snap.usd_cny > 0) rate = snap.usd_cny;
  }

  const unitAmount = Math.round((input.amountCny / rate) * 100);
  if (!Number.isSafeInteger(unitAmount) || unitAmount <= 0) {
    throw Errors.validation('Stripe 支付金额超出币种精度或金额范围');
  }
  const payAmount = unitAmount / 100;

  if (!secretKey || !webhookSecret) {
    if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
      const sandboxUrl = `${input.originUrl}/api/payments/sandbox/mock-gateway?intent=${encodeURIComponent(input.intentNo)}&provider=stripe`;
      return {
        currency: currency.toUpperCase(),
        payAmount,
        payUrl: sandboxUrl,
        qrContent: sandboxUrl,
        providerTradeNo: `cs_test_${input.intentNo}`,
        sandboxSimulated: true,
      };
    }
    throw Errors.validation('Stripe 尚未配置 Secret Key 与 Webhook Secret');
  }

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set(
    'success_url',
    `${input.returnUrl}${input.returnUrl.includes('?') ? '&' : '?'}pay_intent=${input.intentNo}`
  );
  form.set('cancel_url', input.returnUrl);
  form.set('client_reference_id', input.intentNo);
  form.set('metadata[intent_no]', input.intentNo);
  if (input.customerEmail) form.set('customer_email', input.customerEmail);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', currency);
  form.set('line_items[0][price_data][unit_amount]', String(unitAmount));
  form.set('line_items[0][price_data][product_data][name]', input.subject.slice(0, 80));

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    livemode?: boolean;
    error?: { message?: string };
  };
  if (!resp.ok || !data.url || typeof data.id !== 'string' || !/^cs_[A-Za-z0-9_-]{1,120}$/.test(data.id)) {
    throw Errors.upstream(`Stripe 创建收银台失败：${data.error?.message || `HTTP ${resp.status}`}`);
  }
  if (!isSandboxEnabled(env) && (data.livemode !== true || isSimulatedTrade(data.id))) {
    throw Errors.validation('Stripe 返回的 Checkout 会话不属于正式模式');
  }

  return {
    currency: currency.toUpperCase(),
    payAmount,
    payUrl: data.url,
    qrContent: data.url,
    providerTradeNo: data.id,
    sandboxSimulated: false,
  };
}

async function loadStoredPaymentPluginConfig(env: Env, pluginId: string, ownerAgentId = 0) {
  const db = createDb(env.DB);
  if (ownerAgentId > 0) {
    const tRows = await db
      .select({ enabled: tenantPaymentPlugins.enabled, configJson: tenantPaymentPlugins.configJson })
      .from(tenantPaymentPlugins)
      .where(
        and(eq(tenantPaymentPlugins.ownerAgentId, ownerAgentId), eq(tenantPaymentPlugins.pluginId, pluginId))
      )
      .limit(1);
    const tRow = tRows[0];
    return {
      enabled: tRow?.enabled === 1,
      config: tRow ? parsePaymentPluginConfig(tRow.configJson) : {},
    };
  }
  const rows = await db
    .select({ enabled: paymentPlugins.enabled, configJson: paymentPlugins.configJson })
    .from(paymentPlugins)
    .where(eq(paymentPlugins.id, pluginId))
    .limit(1);
  const row = rows[0];
  return {
    enabled: row?.enabled === 1,
    config: row ? parsePaymentPluginConfig(row.configJson) : {},
  };
}

export async function loadStripeCurrencyConfig(env: Env, ownerAgentId = 0) {
  const { config } = await loadStoredPaymentPluginConfig(env, 'stripe', ownerAgentId);
  const { currency, usd_cny_rate, hkd_cny_rate } = config as StripePluginConfig;
  return { currency, usd_cny_rate, hkd_cny_rate };
}

export async function loadPaymentPluginConfig<T extends object>(
  env: Env,
  pluginId: string,
  ownerAgentId = 0
): Promise<{ enabled: boolean; config: T }> {
  const { enabled, config } = await loadStoredPaymentPluginConfig(env, pluginId, ownerAgentId);
  return {
    enabled,
    config: (await readPaymentPluginCredentials(env, pluginId, config)) as T,
  };
}
