import {
  aiOptimizeProductInputSchema,
  createOrderInputSchema,
  loginInputSchema,
  updateAiConfigInputSchema,
} from '@shared/index';
import {
  type Env,
  getRequiredJwtSecret,
  isDevOrTestEnv,
  isSandboxEnabled,
  resolveAdminExpectedSecret,
} from '@worker/env';
import { executePayment } from '@worker/infra/payment';
import { describe, expect, it } from 'vitest';

describe('production security & contract guardrails', () => {
  it('只有显式开发环境可以启用演示账号、默认签名密钥和安装口令', () => {
    for (const name of [undefined, '', ' ', 'unknown', 'staging', 'production']) {
      const env = { APP_ENV: name, SANDBOX_MODE: 'true' } as Env;
      expect(isDevOrTestEnv(env)).toBe(false);
      expect(isSandboxEnabled(env)).toBe(false);
      expect(resolveAdminExpectedSecret(env)).toBe('');
      expect(() => getRequiredJwtSecret(env)).toThrow();
    }
    for (const name of ['test', 'development']) {
      const env = { APP_ENV: name } as Env;
      expect(isDevOrTestEnv(env)).toBe(true);
      expect(isSandboxEnabled(env)).toBe(true);
      expect(resolveAdminExpectedSecret(env)).toBeTruthy();
      expect(getRequiredJwtSecret(env)).toBeTruthy();
    }
  });

  it('rejects default/weak JWT_SECRET in production (Fail-Fast)', () => {
    const prodBadEnv = {
      APP_ENV: 'production',
      JWT_SECRET: 'accthub-edge-hmac-secret-change-in-prod',
    } as Env;
    expect(() => getRequiredJwtSecret(prodBadEnv)).toThrow(/Production JWT_SECRET/);

    const prodGoodEnv = {
      APP_ENV: 'production',
      JWT_SECRET: 'prod-strong-random-secret-key-2026-accthub',
    } as Env;
    expect(getRequiredJwtSecret(prodGoodEnv)).toBe('prod-strong-random-secret-key-2026-accthub');
  });

  it('blocks sandbox demo_instant payment in production unless explicitly enabled', async () => {
    const prodEnv = { APP_ENV: 'production' } as Env;
    expect(isSandboxEnabled(prodEnv)).toBe(false);
    await expect(
      executePayment(prodEnv, { method: 'demo_instant', amount: 10, orderNo: 'AH123' })
    ).rejects.toThrow(/已关闭内置演示收银台/);

    const devEnv = { APP_ENV: 'development' } as Env;
    expect(isSandboxEnabled(devEnv)).toBe(true);
    const res = await executePayment(devEnv, { method: 'demo_instant', amount: 10, orderNo: 'AH123' });
    expect(res.paid).toBe(true);
  });

  it('enforces shared Zod contracts and blocks removed builtin_demo AI provider', () => {
    expect(loginInputSchema.safeParse({ email: 'bad', password: '123' }).success).toBe(false);
    expect(
      createOrderInputSchema.safeParse({ product_id: 1, quantity: 99, contact_email: 'a@b.com' }).success
    ).toBe(false);
    expect(updateAiConfigInputSchema.safeParse({ provider: 'builtin_demo' }).success).toBe(false);
    expect(
      updateAiConfigInputSchema.safeParse({ provider: 'anthropic', model: 'claude-sonnet-4-6' }).success
    ).toBe(true);
    expect(
      aiOptimizeProductInputSchema.safeParse({
        scope: 'all',
        tone: 'editorial',
        product: { title: 'Claude Pro' },
      }).success
    ).toBe(true);
  });
});
