import { describe, expect, it } from 'vitest';
import { hashPassword } from '../../worker/infra/auth-crypto';
import { createTestApp } from './helpers/test-app';

const setupSecret = 'integration-setup-secret';
const payload = {
  setup_secret: setupSecret,
  admin_email: 'initial-admin@example.test',
  admin_password: 'IntegrationPassword42',
  admin_display_name: '管理者',
  brand_name: '测试商城',
};

function initialize(app: ReturnType<typeof createTestApp>, input = payload) {
  return app.jsonRequest('/api/setup/initialize', { method: 'POST', body: JSON.stringify(input) });
}

describe('安装及沙盒运行边界', () => {
  it.each(['production', 'staging', 'preview', ''])(
    '[S19] 非显式开发或测试环境 %s 禁止开启模拟支付',
    async (environment) => {
      const app = createTestApp({ APP_ENV: environment, SANDBOX_MODE: 'true' });
      try {
        const gateway = await app.request('/api/payments/sandbox/mock-gateway?intent=PAY12345678901234');
        expect(gateway.status).toBe(404);
        const payment = await app.jsonRequest('/api/payments/sandbox/simulate-pay', {
          method: 'POST',
          body: JSON.stringify({ intent_no: 'PAY12345678901234' }),
        });
        expect(payment.status).toBe(404);
      } finally {
        app.close();
      }
    }
  );

  it('[S20] 沙盒收银台将查询参数限制为已知通道与标准支付单号', async () => {
    const app = createTestApp();
    try {
      const valid = await app.request(
        '/api/payments/sandbox/mock-gateway?intent=PAY12345678901234&provider=epay'
      );
      expect(valid.status).toBe(200);
      expect(await valid.text()).toContain('PAY12345678901234');
      for (const query of [
        'intent=PAY12345678901234&provider=unknown',
        'intent=unexpected%20format&provider=epay',
      ]) {
        const invalid = await app.request(`/api/payments/sandbox/mock-gateway?${query}`);
        expect(invalid.status).toBe(400);
      }
    } finally {
      app.close();
    }
  });

  it('[B22] 配置写入失败时回滚管理员及安装标志并允许重试', async () => {
    const app = createTestApp({ ADMIN_SECRET: setupSecret });
    try {
      await app.d1.prepare('ALTER TABLE payment_plugins RENAME TO test_hold_payment_plugins').run();
      expect((await initialize(app)).status).toBe(500);
      expect(await app.d1.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").first('n')).toBe(0);
      expect(
        await app.d1.prepare("SELECT value FROM site_settings WHERE key = 'system_initialized'").first()
      ).toBeNull();
      await app.d1.prepare('ALTER TABLE test_hold_payment_plugins RENAME TO payment_plugins').run();
      expect((await initialize(app)).status).toBe(200);
      expect((await initialize(app)).status).toBe(409);
    } finally {
      app.close();
    }
  });

  it('[B22] 已中断安装仅允许口令和现存管理员密码均验证成功后续办', async () => {
    const app = createTestApp({ ADMIN_SECRET: setupSecret });
    try {
      const hash = await hashPassword(payload.admin_password);
      const admin = await app.d1
        .prepare(
          "INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, 'admin') RETURNING id"
        )
        .bind(payload.admin_email, hash, '原管理员')
        .first<{ id: number }>();
      expect(admin).toBeTruthy();
      const status = await app.jsonRequest('/api/setup/status');
      expect(status.data).toMatchObject({ initialized: false, requires_setup: true });
      expect((await initialize(app, { ...payload, setup_secret: 'incorrect-secret' })).status).toBe(403);
      expect((await initialize(app, { ...payload, admin_password: 'incorrect-password' })).status).toBe(403);
      expect((await initialize(app, { ...payload, admin_email: 'other@example.test' })).status).toBe(403);
      const completed = await initialize(app);
      expect(completed.status).toBe(200);
      expect(completed.data.user).toMatchObject({ id: admin?.id, display_name: '原管理员' });
      expect(await app.d1.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").first('n')).toBe(1);
      expect(await app.d1.prepare('SELECT count(*) AS n FROM payment_plugins').first('n')).toBe(6);
      expect((await initialize(app)).status).toBe(409);
    } finally {
      app.close();
    }
  });
});
