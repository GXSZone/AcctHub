import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { createRateLimitMiddleware, resetRateLimitBucketsForTest } from './security';

function createRateLimitApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('/api/*', createRateLimitMiddleware());
  app.all('/api/*', (c) => c.json({ ok: true }));
  return app;
}

describe('分层滑动窗口限流中间件', () => {
  beforeEach(() => {
    resetRateLimitBucketsForTest();
  });

  it('管理端与工作台读接口独立分桶并按凭据指纹隔离，不挤占默认或登录限流桶', async () => {
    const app = createRateLimitApp();
    const env = {} as Env;

    const adminRes = await app.request(
      'http://127.0.0.1/api/admin/overview',
      { headers: { Authorization: 'Bearer admin-token-alpha-0001' } },
      env
    );
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get('X-RateLimit-Policy')).toBe('admin_api;w=60');
    expect(adminRes.headers.get('X-RateLimit-Limit')).toBe('300');

    const meRes = await app.request(
      'http://127.0.0.1/api/auth/me',
      { headers: { Authorization: 'Bearer member-token-beta-0002' } },
      env
    );
    expect(meRes.status).toBe(200);
    expect(meRes.headers.get('X-RateLimit-Policy')).toBe('portal_read;w=60');
    expect(meRes.headers.get('X-RateLimit-Limit')).toBe('240');

    const defaultRes = await app.request('http://127.0.0.1/api/account/profile', { method: 'POST' }, env);
    expect(defaultRes.status).toBe(200);
    expect(defaultRes.headers.get('X-RateLimit-Policy')).toBe('api_default;w=60');
    expect(defaultRes.headers.get('X-RateLimit-Limit')).toBe('120');
  });

  it('高危登录接口保持严格限流且代理 Open API 按 X-API-Key 独立隔离', async () => {
    const app = createRateLimitApp();
    const env = {} as Env;

    for (let i = 0; i < 12; i++) {
      const res = await app.request('http://127.0.0.1/api/auth/login', { method: 'POST' }, env);
      expect(res.status).toBe(200);
    }
    const blocked = await app.request('http://127.0.0.1/api/auth/login', { method: 'POST' }, env);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ code: 'RATE_LIMITED' });

    for (let i = 0; i < 60; i++) {
      const ok = await app.request(
        'http://127.0.0.1/api/v1/reseller/balance',
        { headers: { 'X-API-Key': 'reseller-key-alpha-1111' } },
        env
      );
      expect(ok.status).toBe(200);
    }
    const keyABlocked = await app.request(
      'http://127.0.0.1/api/v1/reseller/balance',
      { headers: { 'X-API-Key': 'reseller-key-alpha-1111' } },
      env
    );
    expect(keyABlocked.status).toBe(429);

    const keyBAllowed = await app.request(
      'http://127.0.0.1/api/v1/reseller/balance',
      { headers: { 'X-API-Key': 'reseller-key-beta-2222' } },
      env
    );
    expect(keyBAllowed.status).toBe(200);
  });
});
