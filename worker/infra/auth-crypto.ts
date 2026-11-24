import { timingSafeEqual } from './crypto';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/** 使用 PBKDF2-SHA256（60,000 次迭代）加盐哈希用户密码 */
export async function hashPassword(password: string, existingSalt?: string): Promise<string> {
  const enc = new TextEncoder();
  const saltBytes = existingSalt ? fromBase64Url(existingSalt) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 60000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return `${toBase64Url(saltBytes)}.${toBase64Url(new Uint8Array(derived))}`;
}

/** 常量时间校验明文密码与已存储哈希 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split('.');
  if (!salt || !hash) return false;
  const computed = await hashPassword(password, salt);
  return timingSafeEqual(computed, stored);
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

/** 签发 HS256 JWT 令牌 */
export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
  exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
): Promise<string> {
  const header = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify({ ...payload, exp })));
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

/** 常量时间验签并解析 HS256 JWT（拒绝非 HS256 算法与过期令牌） */
export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = await hmacSign(`${header}.${body}`, secret);
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const parsedHeader = JSON.parse(new TextDecoder().decode(fromBase64Url(header))) as { alg?: string };
    if (parsedHeader.alg !== 'HS256') return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as Record<string, unknown>;
    if (!Number.isSafeInteger(payload.exp) || Number(payload.exp) <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/** 平台保留子域黑名单，防止代理抢注系统级子域 */
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'admin',
  'app',
  'edge',
  'mail',
  'smtp',
  'cdn',
  'static',
  'assets',
  'root',
  'system',
  'support',
  'help',
  'docs',
  'auth',
  'login',
  'oauth',
  'pay',
  'billing',
  'status',
  'ns1',
  'ns2',
  'ftp',
  'localhost',
]);

/** 规范化代理分站子域 Slug */
export function normalizeSubdomainSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 24);
}

/** 生成高熵分段随机凭证/API Key/CDK 码 */
export function generateRandomCode(prefix: string, length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let body = '';
  for (let i = 0; i < length; i++) {
    body += chars[bytes[i] % chars.length];
    if (i > 0 && (i + 1) % 4 === 0 && i < length - 1) body += '-';
  }
  return `${prefix}${body}`;
}
