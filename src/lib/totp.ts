// RFC 6238 浏览器原生 Web Crypto TOTP 动态验证码生成器与 otpauth URI 解析工具
import { BUSINESS_LIMITS } from '@shared/constants/limits';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function cleanSecret(input: string): string {
  const trimmed = String(input || '').trim();
  // 支持提取含连字符或空格分隔的 secret 参数（直到 & 或 # 或空白结束）
  const uriMatch = trimmed.match(/[?&]secret=([^&#\s]+)/i) || trimmed.match(/^secret=([^&#\s]+)/i);
  const raw = uriMatch ? decodeURIComponent(uriMatch[1]) : trimmed;
  return raw
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
    .slice(0, BUSINESS_LIMITS.MAX_BASE32_SECRET_LENGTH);
}

export function parseOtpAuthUri(input: string): {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
} {
  const trimmed = String(input || '').trim();
  if (!trimmed.toLowerCase().startsWith('otpauth://')) {
    return {
      secret: cleanSecret(trimmed),
      issuer: '',
      account: '',
      digits: 6,
      period: 30,
    };
  }
  try {
    const url = new URL(trimmed);
    const label = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    let issuer = url.searchParams.get('issuer') || '';
    let account = label;
    if (label.includes(':')) {
      const idx = label.indexOf(':');
      if (!issuer) issuer = label.slice(0, idx).trim();
      account = label.slice(idx + 1).trim();
    }
    const secret = cleanSecret(url.searchParams.get('secret') || '');
    const digits = Number(url.searchParams.get('digits')) === 8 ? 8 : 6;
    const period = Number(url.searchParams.get('period')) === 60 ? 60 : 30;
    return { secret, issuer, account, digits, period };
  } catch {
    return { secret: cleanSecret(trimmed), issuer: '', account: '', digits: 6, period: 30 };
  }
}

export function buildOtpAuthUri(params: {
  secret: string;
  issuer?: string;
  account?: string;
  digits?: number;
  period?: number;
}): string {
  const secret = cleanSecret(params.secret);
  const issuer = (params.issuer || 'AcctHub').trim();
  const account = (params.account || 'account').trim();
  const label = encodeURIComponent(issuer ? `${issuer}:${account}` : account);
  const sp = new URLSearchParams({
    secret,
    issuer,
    digits: String(params.digits === 8 ? 8 : 6),
    period: String(params.period === 60 ? 60 : 30),
  });
  return `otpauth://totp/${label}?${sp.toString()}`;
}

export function generateRandomBase32Secret(length = 32): string {
  const safeLen = Math.min(
    BUSINESS_LIMITS.MAX_BASE32_SECRET_LENGTH,
    Math.max(8, Math.floor(Number(length) || 32))
  );
  const bytes = crypto.getRandomValues(new Uint8Array(safeLen));
  let out = '';
  for (let i = 0; i < safeLen; i++) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return out;
}

function base32ToBytes(base32: string): Uint8Array {
  const bounded = base32.slice(0, BUSINESS_LIMITS.MAX_BASE32_SECRET_LENGTH);
  let bits = '';
  for (const ch of bounded) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function computeTotpAtCounter(keyBytes: Uint8Array, counter: number, digits: number): Promise<string> {
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );

  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binCode % 10 ** digits).toString().padStart(digits, '0');
}

export async function generateTOTP(
  rawSecret: string,
  period = 30,
  digits = 6
): Promise<{ code: string; nextCode: string; remaining: number; progress: number }> {
  const secret = cleanSecret(rawSecret);
  if (secret.length < 8) {
    throw new Error('INVALID_BASE32_SECRET');
  }

  // 防御 period <= 0 或 NaN/Infinity 导致除零产生 NaN
  const safePeriod = Number.isFinite(period) && period > 0 ? Math.min(300, Math.floor(period)) : 30;
  const safeDigits = digits === 8 ? 8 : 6;

  const keyBytes = base32ToBytes(secret);
  const nowSec = Math.floor(Date.now() / 1000);
  const counter = Math.floor(nowSec / safePeriod);
  const remaining = safePeriod - (nowSec % safePeriod);
  const progress = remaining / safePeriod;

  const [code, nextCode] = await Promise.all([
    computeTotpAtCounter(keyBytes, counter, safeDigits),
    computeTotpAtCounter(keyBytes, counter + 1, safeDigits),
  ]);

  return { code, nextCode, remaining, progress };
}
