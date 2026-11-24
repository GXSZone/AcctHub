import { afterEach, describe, expect, it } from 'vitest';
import { type D1Harness, startD1Harness } from './runtime-harness';

describe('workerd 安装事务', () => {
  let runtime: D1Harness | undefined;

  afterEach(async () => {
    await runtime?.harness.close();
    runtime = undefined;
  });

  it('[B22] D1 安装失败回滚，两个并行续办请求只提交一次安装', async () => {
    runtime = await startD1Harness();
    const { d1, worker } = runtime;
    const setup = (email: string, brandName: string) =>
      worker.fetch('/api/setup/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_email: email,
          admin_password: 'IntegrationPassword42',
          setup_secret: 'only-for-local-d1-setup-gate',
          brand_name: brandName,
        }),
      });

    await d1.prepare('ALTER TABLE payment_plugins RENAME TO test_hold_payment_plugins').run();
    expect((await setup('first@example.test', '第一站点')).status).toBe(500);
    expect(await d1.prepare("SELECT count(*) FROM users WHERE role = 'admin'").first('count(*)')).toBe(0);
    expect(await d1.prepare("SELECT value FROM site_settings WHERE key = 'system_initialized'").first()).toBe(
      null
    );
    await d1.prepare('ALTER TABLE test_hold_payment_plugins RENAME TO payment_plugins').run();

    const responses = await Promise.all([
      setup('first@example.test', '第一站点'),
      setup('second@example.test', '第二站点'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const winningEmail = responses[0].ok ? 'first@example.test' : 'second@example.test';
    const winningBrand = responses[0].ok ? '第一站点' : '第二站点';
    expect(await d1.prepare("SELECT email FROM users WHERE role='admin'").first('email')).toBe(winningEmail);
    expect(await d1.prepare("SELECT value FROM site_settings WHERE key='brand_name'").first('value')).toBe(
      winningBrand
    );
    expect(
      await d1
        .prepare("SELECT count(*) FROM admin_audit_logs WHERE action='setup.initialize'")
        .first('count(*)')
    ).toBe(1);
  });
});
