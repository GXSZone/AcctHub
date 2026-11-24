/**
 * 纯 Web Crypto API 的 RFC 6238 TOTP（HMAC-SHA1，6 位 30 秒步长）实现
 * 兼容 Google Authenticator / 1Password / Microsoft Authenticator，零第三方依赖。
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成 20 字节（160 位）高熵 Base32 TOTP 密钥 */
export function generateTotpSecretBase32(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(secret: string): Uint8Array {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 计算指定时间计数器对应的 6 位 TOTP 动态码 */
export async function computeTotpCodeAtStep(secretBase32: string, step: number): Promise<string> {
  const keyBytes = decodeBase32(secretBase32);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  const high = Math.floor(step / 0x100000000);
  const low = step >>> 0;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** 生成当前时刻 6 位 TOTP 验证码 */
export async function generateCurrentTotpCode(secretBase32: string, nowMs = Date.now()): Promise<string> {
  const step = Math.floor(nowMs / 30_000);
  return computeTotpCodeAtStep(secretBase32, step);
}

/** 校验 6 位 TOTP 动态码（允许 ±1 个 30 秒时间窗口时钟偏移） */
export async function verifyTotpCode(
  secretBase32: string,
  inputCode: string,
  nowMs = Date.now()
): Promise<boolean> {
  const clean = inputCode.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const currentStep = Math.floor(nowMs / 30_000);
  for (const delta of [-1, 0, 1]) {
    const expected = await computeTotpCodeAtStep(secretBase32, currentStep + delta);
    if (expected === clean) return true;
  }
  return false;
}

/** 构建标准 otpauth:// 二维码 URI */
export function buildTotpOtpAuthUri(params: {
  issuer: string;
  accountEmail: string;
  secretBase32: string;
}): string {
  const issuer = encodeURIComponent(params.issuer.trim() || 'AcctHub');
  const label = `${issuer}:${encodeURIComponent(params.accountEmail)}`;
  return `otpauth://totp/${label}?secret=${encodeURIComponent(params.secretBase32)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
