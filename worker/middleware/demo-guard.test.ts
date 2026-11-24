import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppBindings, Env } from '../env';
import { assertDemoAccountMutable, createPublicDemoGuardMiddleware } from './demo-guard.middleware';

function createDemoApp() {
  const app = new Hono<AppBindings>();
  app.use('/api/*', createPublicDemoGuardMiddleware());
  app.all('/api/*', (c) => c.json({ ok: true }));
  return app;
}

const demoEnv = {
  APP_ENV: 'development',
  SANDBOX_MODE: 'true',
  PUBLIC_DEMO_MODE: 'true',
} as Env;

const normalDevEnv = {
  APP_ENV: 'development',
  SANDBOX_MODE: 'true',
} as Env;

describe('公开演示站安全护盾中间件', () => {
  it('未开启 PUBLIC_DEMO_MODE 时不拦截任何本地开发请求', async () => {
    const app = createDemoApp();
    const res = await app.request(
      'http://127.0.0.1/api/admin/risk/emergency',
      { method: 'POST' },
      normalDevEnv
    );
    expect(res.status).toBe(200);
  });

  it('开启 PUBLIC_DEMO_MODE 时拦截高危后台与外发 SSRF 写接口，但放行只读与普通购卡演示', async () => {
    const app = createDemoApp();

    for (const [method, path] of [
      ['POST', '/api/admin/2fa/enable'],
      ['POST', '/api/admin/risk/emergency'],
      ['POST', '/api/admin/risk/ip-blacklist'],
      ['PUT', '/api/admin/members/1/password'],
      ['DELETE', '/api/admin/members/2'],
      ['PUT', '/api/admin/mail-config'],
      ['POST', '/api/admin/upstreams'],
      ['PUT', '/api/agent/domain'],
    ] as const) {
      const res = await app.request(`http://127.0.0.1${path}`, { method }, demoEnv);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'DEMO_MODE_READONLY' });
    }

    for (const [method, path] of [
      ['GET', '/api/admin/risk/overview'],
      ['POST', '/api/orders'],
      ['POST', '/api/payments/sandbox/simulate-pay'],
      ['POST', '/api/admin/cdks/generate'],
    ] as const) {
      const res = await app.request(`http://127.0.0.1${path}`, { method }, demoEnv);
      expect(res.status, `${method} ${path}`).toBe(200);
    }
  });

  it('保护内置演示账号密码不可篡改，但允许访客自注册新账号测试改密', () => {
    expect(() => assertDemoAccountMutable(demoEnv, 'admin@accthub.dev')).toThrow(/公开演示环境/);
    expect(() => assertDemoAccountMutable(demoEnv, 'demo@accthub.dev')).toThrow(/公开演示环境/);
    expect(() => assertDemoAccountMutable(demoEnv, 'visitor@example.com')).not.toThrow();
    expect(() => assertDemoAccountMutable(normalDevEnv, 'admin@accthub.dev')).not.toThrow();
  });
});
