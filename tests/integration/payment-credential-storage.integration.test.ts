import { expect, it } from 'vitest';
import { paymentPlugins } from '../../worker/db/schema/index';
import { loadPaymentPluginConfig } from '../../worker/domains/payment/payment.gateway';
import { rekeyStoredCredentials } from '../../worker/infra/credential-rekey';
import { createTestApp } from './helpers/test-app';

const firstKey = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8=';
const secondKey = 'YGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6e3x9fn8=';
const originalKeyring = JSON.stringify({ active: 'first', keys: { first: firstKey } });
const pluginCases = [
  ['epay', { pid: 'fixture-pid' }, { key: 'epay-fixture-signing' }],
  [
    'stripe',
    { currency: 'cny' },
    { secret_key: 'stripe-fixture-signing', webhook_secret: 'stripe-fixture-webhook' },
  ],
  ['alipay_f2f', { app_id: 'alipay-fixture-id' }, { private_key: 'alipay-fixture-private' }],
  ['usdt_trc20', { wallet_address: 'trc20-fixture-address' }, { trongrid_api_key: 'trongrid-fixture-key' }],
  ['usdt_bep20', { wallet_address: 'bep20-fixture-address' }, { explorer_api_key: 'bep20-fixture-key' }],
  ['usdt_erc20', { wallet_address: 'erc20-fixture-address' }, { explorer_api_key: 'erc20-fixture-key' }],
] as const;

it('[S35][S40] 后台支付配置逐字段加密，留空保留原值，轮转后可退休旧数据密钥', async () => {
  const app = createTestApp({ DATA_ENCRYPTION_KEYS: originalKeyring });
  try {
    const headers = await app.adminHeaders();
    const update = (id: string, config: Record<string, string>) =>
      app.jsonRequest(`/api/admin/payment-plugins/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: true, config }),
      });
    const readStorage = async (id: string) =>
      JSON.parse(
        (await app.d1
          .prepare('SELECT config_json FROM payment_plugins WHERE id = ?')
          .bind(id)
          .first<string>('config_json')) ?? '{}'
      );
    const old = new Map<string, Record<string, string>>();
    for (const [id, settings, secrets] of pluginCases) {
      await app.db.insert(paymentPlugins).values({ id, name: id, description: '测试' });
      const result = await update(id, { ...settings, ...secrets });
      expect(result.status).toBe(200);
      const stored = await readStorage(id);
      expect(stored).toMatchObject(settings);
      for (const [field, value] of Object.entries(secrets)) {
        expect(stored[field]).toMatch(/^v3\.first\./);
        expect(JSON.stringify(stored)).not.toContain(value);
        expect(JSON.stringify(result.data)).not.toContain(value);
      }
      const blankSecrets = Object.fromEntries(Object.keys(secrets).map((field) => [field, '  ']));
      expect((await update(id, blankSecrets)).status).toBe(200);
      expect(await readStorage(id)).toEqual(stored);
      old.set(id, stored);
    }

    const overview = await app.jsonRequest<{
      payment_plugins: {
        id: string;
        config_json: string;
        secrets_configured: Record<string, boolean>;
      }[];
    }>('/api/admin/overview', { headers });
    expect(overview.status).toBe(200);
    for (const [id, settings, secrets] of pluginCases) {
      const plugin = overview.data.payment_plugins.find((entry) => entry.id === id);
      expect(JSON.parse(plugin?.config_json ?? '{}')).toMatchObject(settings);
      for (const [field, value] of Object.entries(secrets)) {
        expect(plugin?.secrets_configured[field]).toBe(true);
        expect(JSON.parse(plugin?.config_json ?? '{}')).not.toHaveProperty(field);
        expect(JSON.stringify(plugin)).not.toContain(value);
        expect(JSON.stringify(plugin)).not.toContain(old.get(id)?.[field]);
      }
    }

    const transition = {
      ...app.env,
      DATA_ENCRYPTION_KEYS: JSON.stringify({
        active: 'second',
        keys: { first: firstKey, second: secondKey },
      }),
    };
    expect(await rekeyStoredCredentials(transition)).toMatchObject({
      updated: pluginCases.length,
      failed: 0,
    });
    expect(await rekeyStoredCredentials(transition)).toEqual({ updated: 0, pending: 0, failed: 0 });
    const retired = {
      ...transition,
      JWT_SECRET: 'fixture-replaced-and-independent-jwt-key',
      DATA_ENCRYPTION_KEYS: JSON.stringify({ active: 'second', keys: { second: secondKey } }),
    };
    for (const [id, settings, secrets] of pluginCases) {
      const stored = await readStorage(id);
      for (const field of Object.keys(secrets)) {
        expect(stored[field]).toMatch(/^v3\.second\./);
        expect(stored[field]).not.toBe(old.get(id)?.[field]);
      }
      expect(await loadPaymentPluginConfig(retired, id)).toEqual({
        enabled: true,
        config: { ...settings, ...secrets },
      });
    }
  } finally {
    app.close();
  }
});

it('[S40] 轮转封存历史支付密钥并拒绝在不同字段间调换密文', async () => {
  const app = createTestApp({ DATA_ENCRYPTION_KEYS: originalKeyring });
  try {
    const former = {
      currency: 'cny',
      secret_key: 'fixture-historical-api',
      webhook_secret: 'fixture-historical-webhook',
    };
    await app.db.insert(paymentPlugins).values({
      id: 'stripe',
      name: 'Stripe',
      description: '测试',
      configJson: JSON.stringify(former),
    });
    expect(await rekeyStoredCredentials(app.env)).toMatchObject({ updated: 1, failed: 0 });
    expect(await loadPaymentPluginConfig(app.env, 'stripe')).toEqual({ enabled: false, config: former });
    const row = await app.d1
      .prepare("SELECT config_json FROM payment_plugins WHERE id = 'stripe'")
      .first<string>('config_json');
    const stored = JSON.parse(row ?? '{}');
    expect(stored.secret_key).toMatch(/^v3\.first\./);
    expect(stored.webhook_secret).toMatch(/^v3\.first\./);
    await app.d1
      .prepare("UPDATE payment_plugins SET config_json = ? WHERE id = 'stripe'")
      .bind(
        JSON.stringify({ ...stored, secret_key: stored.webhook_secret, webhook_secret: stored.secret_key })
      )
      .run();
    await expect(loadPaymentPluginConfig(app.env, 'stripe')).rejects.toThrow('Encrypted data cannot be read');
  } finally {
    app.close();
  }
});
