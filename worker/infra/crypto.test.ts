import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  hmacSha256Hex,
  md5Hex,
  timingSafeEqual,
  verifyPassword,
} from './crypto';

const mockEnv = {
  APP_ENV: 'production',
  JWT_SECRET: 'unit-test-secret-key-at-least-24-chars',
  DATA_ENCRYPTION_KEYS: JSON.stringify({
    active: 'first',
    keys: { first: 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=' },
  }),
} as Env;

describe('worker/infra/crypto', () => {
  it('computes RFC-1321 MD5 vectors accurately', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
  });

  it('[S40] decrypts the same data after JWT rotation and authenticates the data key id', async () => {
    const cipher = await encryptSecret(mockEnv, 'sk-live-secret-123456');
    expect(cipher.startsWith('v3.first.')).toBe(true);
    const priorKey = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
    const rotated = {
      ...mockEnv,
      JWT_SECRET: 'other-unit-test-secret-at-least-24-chars',
      DATA_ENCRYPTION_KEYS: JSON.stringify({
        active: 'second',
        keys: {
          first: priorKey,
          alias: priorKey,
          second: 'YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8=',
        },
      }),
    };
    const plain = await decryptSecret(rotated, cipher);
    expect(plain).toBe('sk-live-secret-123456');
    expect(await encryptSecret(rotated, 'new secret')).toMatch(/^v3\.second\./);
    await expect(decryptSecret(rotated, cipher.replace('.first.', '.alias.'))).rejects.toThrow();
    await expect(
      encryptSecret({ ...mockEnv, DATA_ENCRYPTION_KEYS: undefined } as Env, 'cannot store')
    ).rejects.toThrow();
  });

  it('hashes and verifies passwords with PBKDF2-SHA256', async () => {
    const hash = await hashPassword('StrongPass!2026');
    expect(await verifyPassword('StrongPass!2026', hash)).toBe(true);
    expect(await verifyPassword('WrongPass', hash)).toBe(false);
  });

  it('signs HMAC-SHA256 and checks timing-safe equality', async () => {
    const sig = await hmacSha256Hex('secret', 'payload');
    expect(sig).toHaveLength(64);
    expect(timingSafeEqual(sig, sig)).toBe(true);
    expect(timingSafeEqual(sig, `${sig.slice(0, 63)}0`)).toBe(false);
  });
});
