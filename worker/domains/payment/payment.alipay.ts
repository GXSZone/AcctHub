import { type Env, isSandboxEnabled } from '../../env';
import { Errors } from '../../infra/errors';
import type { GatewayCreateSessionResult } from './payment.gateway';

export interface AlipayF2FConfig {
  app_id?: string;
  private_key?: string;
  alipay_public_key?: string;
  gateway_url?: string;
}

function stripPemHeaders(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function decodeBase64Bytes(b64: string): Uint8Array {
  const clean = stripPemHeaders(b64);
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * 构建支付宝标准待签名串：按 ASCII 键名升序拼接 `k=v`，默认排除 `sign`（回调验签时同时排除 `sign_type`）
 */
export function buildAlipaySignContent(
  params: Record<string, string>,
  opts?: { omitSignType?: boolean }
): string {
  return Object.keys(params)
    .filter((k) => {
      if (k === 'sign') return false;
      if (opts?.omitSignType && k === 'sign_type') return false;
      const v = params[k];
      return v !== undefined && v !== null && v !== '';
    })
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** 使用纯 Web Crypto RSASSA-PKCS1-v1_5 + SHA-256 生成支付宝 RSA2 签名（兼容 Cloudflare Workers 边缘隔离运行时） */
export async function signAlipayRsa2(params: Record<string, string>, privateKeyPem: string): Promise<string> {
  const der = decodeBase64Bytes(privateKeyPem);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const content = buildAlipaySignContent(params, { omitSignType: false });
  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(content));
  return encodeBase64Bytes(new Uint8Array(sigBuf));
}

/** 使用纯 Web Crypto 支付宝 SPKI 公钥校验异步通知 RSA2 签名 */
export async function verifyAlipayRsa2Callback(
  params: Record<string, string>,
  alipayPublicKeyPem: string
): Promise<{ valid: boolean; reason?: string }> {
  const pubClean = stripPemHeaders(alipayPublicKeyPem);
  if (!pubClean) {
    return { valid: false, reason: '支付宝公钥未配置' };
  }
  const sign = (params.sign || '').trim();
  if (!sign) {
    return { valid: false, reason: '缺少支付宝回调签名 sign' };
  }
  const status = (params.trade_status || '').toUpperCase();
  if (status && status !== 'TRADE_SUCCESS' && status !== 'TRADE_FINISHED') {
    return { valid: false, reason: `非成功交易状态：${status}` };
  }

  try {
    const pubDer = decodeBase64Bytes(pubClean);
    const sigBytes = decodeBase64Bytes(sign);
    const key = await crypto.subtle.importKey(
      'spki',
      pubDer.buffer as ArrayBuffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const content = buildAlipaySignContent(params, { omitSignType: true });
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      sigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(content)
    );
    return ok ? { valid: true } : { valid: false, reason: '支付宝 RSA2 签名验证失败' };
  } catch (err) {
    return {
      valid: false,
      reason: `支付宝公钥或签名解析失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatAlipayTimestamp(date = new Date()): string {
  // 支付宝要求北京时间 YYYY-MM-DD HH:MM:SS（UTC+8）
  const cn = new Date(date.getTime() + 8 * 3600 * 1000);
  return cn.toISOString().replace('T', ' ').slice(0, 19);
}

/** 调用支付宝 alipay.trade.precreate 创建当面付收款二维码 */
export async function createAlipayFaceToFaceSession(
  env: Env,
  cfg: AlipayF2FConfig,
  input: {
    intentNo: string;
    subject: string;
    amountCny: number;
    originUrl: string;
  }
): Promise<GatewayCreateSessionResult> {
  const notifyOrigin = input.originUrl.replace(/\/+$/, '');
  const appId = (cfg.app_id || '').trim();
  const privateKey = (cfg.private_key || '').trim();
  const payAmount = Number(input.amountCny.toFixed(2));

  if (!appId || !privateKey) {
    if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
      const sandboxUrl = `${input.originUrl}/api/payments/sandbox/mock-gateway?intent=${encodeURIComponent(input.intentNo)}&provider=alipay_f2f`;
      return {
        currency: 'CNY',
        payAmount,
        payUrl: sandboxUrl,
        qrContent: sandboxUrl,
        providerTradeNo: `ALIPAY-SBX-${input.intentNo}`,
        sandboxSimulated: true,
      };
    }
    throw Errors.validation('支付宝当面付尚未完成 AppID 与应用私钥配置');
  }

  const gatewayUrl = (cfg.gateway_url || '').trim() || 'https://openapi.alipay.com/gateway.do';
  const params: Record<string, string> = {
    app_id: appId,
    method: 'alipay.trade.precreate',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: formatAlipayTimestamp(),
    version: '1.0',
    notify_url: `${notifyOrigin}/api/payments/webhook/alipay`,
    biz_content: JSON.stringify({
      out_trade_no: input.intentNo,
      total_amount: payAmount.toFixed(2),
      subject: input.subject.slice(0, 64),
      timeout_express: '20m',
    }),
  };

  params.sign = await signAlipayRsa2(params, privateKey);

  const form = new URLSearchParams(params);
  const resp = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    alipay_trade_precreate_response?: {
      code?: string;
      msg?: string;
      sub_msg?: string;
      qr_code?: string;
      out_trade_no?: string;
    };
  };
  const body = data.alipay_trade_precreate_response;
  if (!resp.ok || !body || body.code !== '10000' || !body.qr_code) {
    throw Errors.upstream(`支付宝当面付预下单失败：${body?.sub_msg || body?.msg || `HTTP ${resp.status}`}`);
  }

  return {
    currency: 'CNY',
    payAmount,
    payUrl: body.qr_code,
    qrContent: body.qr_code,
    providerTradeNo: '',
    sandboxSimulated: false,
  };
}
