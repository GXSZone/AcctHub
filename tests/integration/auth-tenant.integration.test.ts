import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  siteSettings,
  tenantDomains,
  userLoginLogs,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { hashPassword } from '../../worker/infra/auth-crypto';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B1 垂直领域集成测试：Auth 鉴权与 Tenant 多租户隔离（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 完整注册 → /me → 登录 → 沙盒加款闭环，并验证钱包流水与登录审计日志落库', async () => {
    // 1.1 Zod 拦截非法参数
    const badReg = await ctx.jsonRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'invalid-email', password: '123' }),
    });
    expect(badReg.status).toBe(400);

    // 1.2 正常注册（沙盒模式赠送 ¥50）
    const reg = await ctx.jsonRequest<{
      token: string;
      user: { id: number; email: string; balance: number; role: string };
    }>('/api/auth/register', {
      method: 'POST',
      headers: { 'User-Agent': 'Vitest-Integration/1.0' },
      body: JSON.stringify({
        email: 'Alice@Example.com',
        password: 'Password123!',
        display_name: '爱丽丝',
      }),
    });
    expect(reg.status).toBe(200);
    expect(reg.data.token).toBeTruthy();
    expect(reg.data.user.email).toBe('alice@example.com');
    expect(reg.data.user.balance).toBe(50);

    // 校验 Drizzle 真实落库流水与登录审计
    const txs = await ctx.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, reg.data.user.id));
    expect(txs.length).toBe(1);
    expect(txs[0].amount).toBe(50);

    const logs = await ctx.db.select().from(userLoginLogs).where(eq(userLoginLogs.userId, reg.data.user.id));
    expect(logs.length).toBe(1);

    // 1.3 同站重复注册返回 409 Conflict
    const dup = await ctx.jsonRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', password: 'Password123!' }),
    });
    expect(dup.status).toBe(409);

    // 1.4 携带 Bearer Token 访问 /api/auth/me
    const me = await ctx.jsonRequest<{ user: { id: number; email: string } }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${reg.data.token}` },
    });
    expect(me.status).toBe(200);
    expect(me.data.user.id).toBe(reg.data.user.id);

    // 1.5 错误密码登录被拒（验证 5 语种错误翻译）
    const badLogin = await ctx.jsonRequest<{ error: string }>('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Lang': 'en' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'WrongPassword!' }),
    });
    expect(badLogin.status).toBe(401);
    expect(badLogin.data.error).not.toBe('邮箱或密码不正确');

    // 1.6 正确登录并执行沙盒余额加款
    const login = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'alice@example.com', password: 'Password123!' }),
    });
    expect(login.status).toBe(200);

    const topup = await ctx.jsonRequest<{ balance: number; added: number }>('/api/auth/topup-demo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.data.token}` },
      body: JSON.stringify({ amount: 120 }),
    });
    expect(topup.status).toBe(200);
    expect(topup.data.added).toBe(120);
    expect(topup.data.balance).toBe(170);
  });

  it('2. 严格多租户账号隔离、店主自家分站例外、禁止 admin 分站登录与反溯源防护', async () => {
    // 准备管理员、分站店主与两个代理分站（一个正常，一个已封禁）
    const adminHash = await hashPassword('AdminPass123!');
    const ownerHash = await hashPassword('OwnerPass123!');

    await ctx.db.insert(users).values([
      {
        siteAgentId: 0,
        email: 'admin@accthub.dev',
        displayName: '总控管理员',
        passwordHash: adminHash,
        role: 'admin',
        balance: 0,
      },
      {
        siteAgentId: 0,
        email: 'owner@accthub.dev',
        displayName: 'Alpha 店主',
        passwordHash: ownerHash,
        role: 'agent',
        balance: 500,
      },
    ]);

    const ownerUser = (await ctx.db.select().from(users).where(eq(users.email, 'owner@accthub.dev')))[0];

    await ctx.db.insert(agents).values([
      {
        userId: ownerUser.id,
        slug: 'alpha',
        brandName: 'Alpha 白牌严选',
        apiKey: 'ah_agent_alpha_test_key',
        markupPercent: 15,
        status: 'active',
      },
      {
        userId: 9999,
        slug: 'banned-shop',
        brandName: '违规分站',
        apiKey: 'ah_agent_banned_test_key',
        markupPercent: 10,
        status: 'suspended',
      },
    ]);

    await ctx.db.insert(siteSettings).values({
      key: 'saas_cname_target',
      value: 'ingress.neutral-edge.test',
    });

    const [alphaAgent] = await ctx.db.select().from(agents).where(eq(agents.slug, 'alpha'));
    await ctx.db.insert(tenantDomains).values({
      agentId: alphaAgent.id,
      hostname: 'shop.alpha.test',
      domainType: 'custom',
      isPrimary: 1,
      authMode: 'manual_approval',
      status: 'active',
      sslStatus: 'active',
    });

    // 2.1 主站与子分站可使用同一邮箱独立注册互不冲突
    const mainReg = await ctx.jsonRequest<{ token: string; user: { site_agent_id: number } }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'shared@example.com', password: 'MainUser123!' }),
      }
    );
    expect(mainReg.status).toBe(200);
    expect(mainReg.data.user.site_agent_id).toBe(0);

    const subReg = await ctx.jsonRequest<{ token: string; user: { site_agent_id: number } }>(
      'https://shop.alpha.test/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify({ email: 'shared@example.com', password: 'SubUser123!' }),
      }
    );
    expect(subReg.status).toBe(200);
    expect(subReg.data.user.site_agent_id).toBeGreaterThan(0);

    // 2.2 主站 Token 严禁跨站鉴权子分站（严格返回 user: null）
    const crossSiteMe = await ctx.jsonRequest<{ user: unknown }>('https://shop.alpha.test/api/auth/me', {
      headers: { Authorization: `Bearer ${mainReg.data.token}` },
    });
    expect(crossSiteMe.status).toBe(200);
    expect(crossSiteMe.data.user).toBeNull();

    // 2.3 分站店主可以在自家分站独立域名登录并鉴权
    const ownerLogin = await ctx.jsonRequest<{
      token: string;
      user: { email: string; agent: { slug: string } };
    }>('https://shop.alpha.test/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'owner@accthub.dev', password: 'OwnerPass123!' }),
    });
    expect(ownerLogin.status).toBe(200);
    expect(ownerLogin.data.user.agent.slug).toBe('alpha');

    // 2.4 禁止总控 admin 从子分站登录，且子分站自定义域名屏蔽 /api/admin 返回 404
    const adminOnSub = await ctx.jsonRequest('https://shop.alpha.test/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@accthub.dev', password: 'AdminPass123!' }),
    });
    expect(adminOnSub.status).toBe(401);

    const adminRouteOnSub = await ctx.jsonRequest('https://shop.alpha.test/api/admin/overview');
    expect(adminRouteOnSub.status).toBe(404);

    // 2.5 已封禁分站（通过真实子域名访问）返回 403，绝不降级回主站
    const suspendedRes = await ctx.jsonRequest('http://banned-shop.localhost/api/storefront/bootstrap');
    expect(suspendedRes.status).toBe(403);

    // 2.6 直接访问中性 CNAME 接入域返回 404 反溯源
    const cnameProbe = await ctx.request('https://ingress.neutral-edge.test/api/health');
    expect(cnameProbe.status).toBe(404);
  });

  it('3. 生产环境硬隔离：注册不发体验金且沙盒加款返回 404', async () => {
    const prodCtx = createTestApp({
      APP_ENV: 'production',
      SANDBOX_MODE: 'false',
      JWT_SECRET: 'production-super-strong-jwt-secret-key-2026',
    });
    try {
      const reg = await prodCtx.jsonRequest<{ token: string; user: { balance: number } }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'produser@example.com', password: 'ProdPassword123!' }),
        }
      );
      expect(reg.status).toBe(200);
      expect(reg.data.user.balance).toBe(0);

      const topup = await prodCtx.jsonRequest('/api/auth/topup-demo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${reg.data.token}` },
        body: JSON.stringify({ amount: 100 }),
      });
      expect(topup.status).toBe(404);
    } finally {
      prodCtx.close();
    }
  });
});
