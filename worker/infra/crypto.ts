import { type Env, isDevOrTestEnv } from '../env';
import { AppError } from './errors';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateRandomCode(prefix: string, length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let body = '';
  for (let i = 0; i < length; i++) {
    body += chars[(bytes[i] ?? 0) % chars.length];
  }
  return `${prefix}${body}`;
}

/** 基于 CSPRNG 生成标准时间戳 + N 位高熵数字后缀的业务单号（默认 6 位随机） */
export function generateBizNo(prefix: string, randomDigits = 6): string {
  const safeDigits = Math.min(9, Math.max(2, Math.floor(randomDigits)));
  const min = 10 ** (safeDigits - 1);
  const span = 9 * min;
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  const ts = Date.now().toString().slice(-8);
  const suffix = String(min + ((rand[0] ?? 0) % span));
  return `${prefix}${ts}${suffix}`;
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}****`;
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

// =========================================================================
// 1. Password Hashing (PBKDF2-SHA256)
// =========================================================================
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2$${toHex(salt)}$${toHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const salt = fromHex(parts[1] ?? '');
  const expectedHex = parts[2] ?? '';
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return timingSafeEqual(toHex(new Uint8Array(derived)), expectedHex);
}

// =========================================================================
// 2. AES-256-GCM Vault Secret Encryption
// =========================================================================
const KEY_ID = /^[a-zA-Z0-9_-]{1,32}$/;
const DEV_DATA_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const DEV_FINGERPRINT_KEY = 'QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8=';
const DEV_DATA_KEYS = JSON.stringify({ active: 'dev', keys: { dev: DEV_DATA_KEY } });

function dataKeys(env: Env): { active: string; keys: Record<string, string> } {
  try {
    const raw = env.DATA_ENCRYPTION_KEYS ?? (isDevOrTestEnv(env) ? DEV_DATA_KEYS : '');
    const { active, keys } = JSON.parse(raw);
    if (
      typeof active !== 'string' ||
      !KEY_ID.test(active) ||
      !keys ||
      typeof keys !== 'object' ||
      !Object.hasOwn(keys, active)
    ) {
      throw new Error();
    }
    for (const [id, encoded] of Object.entries(keys)) {
      if (typeof encoded !== 'string' || !KEY_ID.test(id)) throw new Error();
      const key = fromBase64(encoded);
      if (key.length !== 32 || toBase64(key) !== encoded) throw new Error();
      if (!isDevOrTestEnv(env) && (encoded === DEV_DATA_KEY || encoded === DEV_FINGERPRINT_KEY)) {
        throw new Error();
      }
    }
    return { active, keys };
  } catch {
    throw new AppError('CONFIGURATION_ERROR', 'DATA_ENCRYPTION_KEYS invalid or missing', { expose: false });
  }
}

function invalidCiphertext(): AppError {
  return new AppError('CONFIGURATION_ERROR', 'Encrypted data cannot be read', { expose: false });
}

export function isEncryptedSecret(value: string): boolean {
  return /^v[123]\./.test(value);
}

export function activeDataKeyVersion(env: Env): string {
  return dataKeys(env).active;
}

/** 盲索引使用专用稳定密钥，轮换数据加密密钥时维持历史去重结果。 */
export async function keyedDataDigest(env: Env, scope: string, value: string): Promise<string> {
  let raw: Uint8Array;
  try {
    const encoded = env.DATA_FINGERPRINT_KEY ?? (isDevOrTestEnv(env) ? DEV_FINGERPRINT_KEY : '');
    raw = fromBase64(encoded);
    if (raw.length !== 32 || toBase64(raw) !== encoded) throw new Error();
    if (!isDevOrTestEnv(env) && (encoded === DEV_DATA_KEY || encoded === DEV_FINGERPRINT_KEY)) {
      throw new Error();
    }
  } catch {
    throw new AppError('CONFIGURATION_ERROR', 'DATA_FINGERPRINT_KEY invalid or missing', { expose: false });
  }
  const key = await crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return toHex(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([scope, value]))))
  );
}

export async function encryptSecret(env: Env, plaintext: string, scope = 'vault'): Promise<string> {
  if (!plaintext) return '';
  const { active, keys } = dataKeys(env);
  const key = await crypto.subtle.importKey(
    'raw',
    fromBase64(keys[active]).buffer as ArrayBuffer,
    'AES-GCM',
    false,
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = encoder.encode(JSON.stringify(['accthub-data', 'v3', active, scope]));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    encoder.encode(plaintext)
  );
  return `v3.${active}.${toBase64(iv)}.${toBase64(new Uint8Array(enc))}`;
}

export async function decryptSecret(env: Env, ciphertext: string, scope = 'vault'): Promise<string> {
  if (!ciphertext) return '';
  const [version, ...parts] = ciphertext.split('.');
  try {
    let rawKey: ArrayBuffer;
    let additionalData: Uint8Array<ArrayBuffer> | undefined;
    if (version === 'v3' && parts.length === 3) {
      const id = parts.shift();
      const { keys } = dataKeys(env);
      if (!id || !Object.hasOwn(keys, id)) throw invalidCiphertext();
      rawKey = fromBase64(keys[id]).buffer as ArrayBuffer;
      additionalData = encoder.encode(JSON.stringify(['accthub-data', version, id, scope]));
    } else if ((version === 'v1' || version === 'v2') && parts.length === 2) {
      const legacySecret = env.LEGACY_VAULT_SECRET;
      if (!legacySecret) throw invalidCiphertext();
      const prefix = version === 'v1' ? 'totp-vault' : 'accthub-vault-v2';
      rawKey = await crypto.subtle.digest('SHA-256', encoder.encode(`${prefix}:${legacySecret}`));
    } else {
      throw invalidCiphertext();
    }
    const iv = fromBase64(parts[0]);
    const data = fromBase64(parts[1]);
    if (iv.length !== 12 || data.length < 16 || toBase64(iv) !== parts[0] || toBase64(data) !== parts[1]) {
      throw invalidCiphertext();
    }
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, additionalData },
      key,
      data.buffer as ArrayBuffer
    );
    return decoder.decode(dec);
  } catch {
    throw invalidCiphertext();
  }
}

// =========================================================================
// 3. SHA-256 / HMAC-SHA256 & Pure-TS RFC-1321 MD5 (Zero Node Dependencies)
// =========================================================================
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toHex(new Uint8Array(sig));
}

export function md5Hex(input: string): string {
  const bytes = encoder.encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) + 1) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5,
    9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6,
    10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(offset + j * 4, true);

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const sum = (F + A + (K[i] ?? 0) + (M[g] ?? 0)) >>> 0;
      A = D;
      D = C;
      C = B;
      const shift = s[i] ?? 0;
      B = (B + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return toHex(out);
}
