import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from './helpers/test-app';

describe('M1 集成测试：生产冷启动 /setup、总控操作审计脱敏与 Turnstile 护盾', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('冷启动 /api/setup/initialize 需校验 ADMIN_SECRET、创建管理员后永久锁死并记录脱敏审计日志', async () => {
    const app = createTestApp({ ADMIN_SECRET: 'setup-super-secret-2026' });
    try {
      // 1. 空白数据库状态下 requires_setup = true
      const statusBefore = await app.jsonRequest<{ initialized: boolean; requires_setup: boolean }>(
        '/api/setup/status'
      );
      expect(statusBefore.ok).toBe(true);
      expect(statusBefore.data.initialized).toBe(false);
      expect(statusBefore.data.requires_setup).toBe(true);

      // 2. 错误口令尝试初始化被 403 拒绝（防止公网部署瞬间被抢注）
      const badSecretRes = await app.jsonRequest('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'wrong-secret',
          admin_email: 'hacker@evil.com',
          admin_password: 'Password#123',
          brand_name: 'FakeShop',
        }),
      });
      expect(badSecretRes.status).toBe(403);

      // 3. 正确口令完成初始化并获签管理员 JWT
      const okRes = await app.jsonRequest<{ ok: boolean; token: string; user: { role: string } }>(
        '/api/setup/initialize',
        {
          method: 'POST',
          body: JSON.stringify({
            setup_secret: 'setup-super-secret-2026',
            admin_email: 'root@accthub.io',
            admin_password: 'StrongPassword#2026',
            admin_display_name: '总控架构师',
            brand_name: 'AcctHub Cloud',
          }),
        }
      );
      expect(okRes.status).toBe(200);
      expect(okRes.data.ok).toBe(true);
      expect(okRes.data.user.role).toBe('admin');
      const adminToken = okRes.data.token;

      // 4. 二次调用 /api/setup/initialize 永久返回 409 冲突锁死
      const lockRes = await app.jsonRequest('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'setup-super-secret-2026',
          admin_email: 'another@accthub.io',
          admin_password: 'StrongPassword#2026',
          brand_name: 'Reset',
        }),
      });
      expect(lockRes.status).toBe(409);

      // 5. 更新支付插件并验证审计仅记录密钥更新状态
      const pluginRes = await app.jsonRequest('/api/admin/payment-plugins/stripe', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          enabled: true,
          config: {
            publishable_key: 'pk_live_demo_visible',
            secret_key: 'sk_live_MUST_BE_MASKED_998877',
            webhook_secret: 'whsec_MUST_BE_MASKED_554433',
          },
        }),
      });
      expect(pluginRes.ok).toBe(true);

      const logsRes = await app.jsonRequest<{
        logs: Array<{ action: string; actorEmail: string; afterJson: string }>;
      }>('/api/admin/audit-logs', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(logsRes.ok).toBe(true);
      expect(logsRes.data.logs.length).toBeGreaterThanOrEqual(2);

      const pluginAudit = logsRes.data.logs.find((l) => l.action.includes('payment-plugins'));
      expect(pluginAudit).toBeTruthy();
      expect(pluginAudit?.actorEmail).toBe('root@accthub.io');
      expect(pluginAudit?.afterJson).not.toContain('sk_live_MUST_BE_MASKED_998877');
      expect(pluginAudit?.afterJson).not.toContain('whsec_MUST_BE_MASKED_554433');
      expect(JSON.parse(pluginAudit?.afterJson ?? '{}')).toEqual({
        enabled: true,
        credentials_updated: true,
      });

      // 6. 验证审计日志 CSV 导出包含表头
      const csvRes = await app.request('/api/admin/audit-logs/csv', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(csvRes.ok).toBe(true);
      const csvText = await csvRes.text();
      expect(csvText).toContain('操作人');
      expect(csvText).toContain('root@accthub.io');
    } finally {
      app.close();
    }
  });

  it('Turnstile 护盾在配置 TURNSTILE_SECRET 时拦截未验证的注册与 CDK 兑换请求，验证通过则放行', async () => {
    const app = createTestApp({
      ADMIN_SECRET: 'setup-secret-ts',
      TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    });

    try {
      await app.jsonRequest('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'setup-secret-ts',
          admin_email: 'admin@ts.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'TurnstileShop',
        }),
      });

      // 1. 缺少 turnstile token 的注册被 403 拦截
      const blockedReg = await app.jsonRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'bot@ts.dev',
          password: 'BotPassword#123',
          display_name: '机器人',
        }),
      });
      expect(blockedReg.status).toBe(403);

      // 2. 模拟 Cloudflare Turnstile siteverify 返回成功且 action 匹配
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('challenges.cloudflare.com/turnstile')) {
          return new Response(JSON.stringify({ success: true, action: 'register' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const okReg = await app.jsonRequest<{ token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'human@ts.dev',
          password: 'HumanPassword#123',
          display_name: '真人会员',
          turnstile_token: 'valid-turnstile-token-mock',
        }),
      });
      expect(okReg.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // 3. 同一会员兑换 CDK 缺少 Turnstile token 同样被 403 拦截
      const blockedCdk = await app.jsonRequest('/api/account/redeem-cdk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${okReg.data.token}` },
        body: JSON.stringify({ code: 'CDK-TEST-1234' }),
      });
      expect(blockedCdk.status).toBe(403);
    } finally {
      app.close();
    }
  });
});
