import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents, agentTiers, tenantDomains, users } from '../../worker/db/schema/index';
import { ensureDemoSeeded } from '../../worker/db/seeds';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('Phase 1 SaaS 集成测试：纯 Host 多租户底座与分站域名授权体系', () => {
  let ctx: TestAppContext;
  let adminAuth: { Authorization: string };
  let agentToken: string;
  let agentId: number;
  let agentSlug: string;
  let tierId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp({ MAIN_HOSTNAMES: 'main.accthub.example' });
    adminAuth = await ctx.adminHeaders();

    // 1. 创建允许绑定最多 2 个独立域名的代理等级
    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'pro_saas',
        name: '旗舰分站版',
        levelRank: 2,
        minRecharge: 100,
        discountRate: 0.75,
        allowCustomDomain: 1,
        maxCustomDomains: 2,
      })
      .returning();
    tierId = tier.id;

    // 2. 注册并激活分站站长
    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'domain-owner@example.com', password: 'Password123!' }),
    });
    agentToken = reg.data.token;
    await ctx.db.update(users).set({ balance: 500 }).where(eq(users.id, reg.data.user.id));

    const open = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ target_tier_id: tierId, payment_method: 'balance' }),
    });
    expect(open.status).toBe(200);
    agentId = open.data.agent.id;
    agentSlug = open.data.agent.slug;
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 未知域名与不存在子域强制 403 硬拦截，严禁静默回落主站，且彻底忽略 ?tenant= 与 X-Tenant-Slug', async () => {
    // 未知独立域名访问 API 返回 403 UNAUTHORIZED_DOMAIN
    const api403 = await ctx.jsonRequest<{ code?: string }>(
      'https://unknown-evil.example.com/api/storefront/bootstrap'
    );
    expect(api403.status).toBe(403);
    expect(api403.data.code).toBe('UNAUTHORIZED_DOMAIN');

    // 未知独立域名访问前台 HTML 页面同样返回 403
    const page403 = await ctx.request('https://unknown-evil.example.com/');
    expect(page403.status).toBe(403);

    // 不存在的本地开发子域返回 403
    const badLocalSub = await ctx.jsonRequest<{ code?: string }>(
      'http://ghost-store.localhost/api/storefront/bootstrap'
    );
    expect(badLocalSub.status).toBe(403);
    expect(badLocalSub.data.code).toBe('UNAUTHORIZED_DOMAIN');

    // 主站携带历史 ?tenant= 与 X-Tenant-Slug 参数时完全忽略，始终只返回主站上下文
    const spoofedMain = await ctx.jsonRequest<{ tenant: { isSubAgent: boolean; slug: string | null } }>(
      `http://localhost/api/storefront/bootstrap?tenant=${agentSlug}`,
      { headers: { 'X-Tenant-Slug': agentSlug } }
    );
    expect(spoofedMain.status).toBe(200);
    expect(spoofedMain.data.tenant.isSubAgent).toBe(false);
    expect(spoofedMain.data.tenant.slug).toBeNull();

    // 分站本地子域严禁访问总控 /api/admin/*（返回 404 反溯源隐藏总控）
    const subAdminBlocked = await ctx.jsonRequest(`http://${agentSlug}.localhost/api/admin/overview`, {
      headers: adminAuth,
    });
    expect(subAdminBlocked.status).toBe(404);
  });

  it('2. 独立域名绑定受等级配额约束，未审批/过期/吊销均 403 拦截，审批激活后按 Host 精准路由', async () => {
    const agentHost = `http://${agentSlug}.localhost`;

    // 绑定第一个独立域名（人工审批模式进入 pending_review）
    const bind1 = await ctx.jsonRequest<{
      ok: boolean;
      domain: { id: number; hostname: string; status: string };
    }>(`${agentHost}/api/agent/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ hostname: 'shop-one.brand.example', is_primary: true }),
    });
    expect(bind1.status).toBe(200);
    expect(bind1.data.domain.hostname).toBe('shop-one.brand.example');
    expect(bind1.data.domain.status).toBe('pending_review');
    const domain1Id = bind1.data.domain.id;

    // 未审批激活前，通过该域名访问前台必须 403 拦截
    const pendingRes = await ctx.jsonRequest<{ code?: string }>(
      'https://shop-one.brand.example/api/storefront/bootstrap'
    );
    expect(pendingRes.status).toBe(403);
    expect(pendingRes.data.code).toBe('UNAUTHORIZED_DOMAIN');

    // 绑定第二个独立域名
    const bind2 = await ctx.jsonRequest<{ domain: { id: number } }>(`${agentHost}/api/agent/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ hostname: 'shop-two.brand.example' }),
    });
    expect(bind2.status).toBe(200);
    const domain2Id = bind2.data.domain.id;

    // 超出等级配额（max_custom_domains = 2）绑定第三个域名被 403 拒绝
    const bind3 = await ctx.jsonRequest(`${agentHost}/api/agent/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ hostname: 'shop-three.brand.example' }),
    });
    expect(bind3.status).toBe(403);

    // 总控查询待审域名列表并批准第一个域名（设置未来有效期）
    const adminList = await ctx.jsonRequest<{ items: Array<{ id: number; hostname: string }> }>(
      '/api/admin/domains',
      { headers: adminAuth }
    );
    expect(adminList.status).toBe(200);
    expect(adminList.data.items.some((d) => d.id === domain1Id)).toBe(true);

    const futureExpiry = new Date(Date.now() + 86_400_000 * 30).toISOString().replace('T', ' ').slice(0, 19);
    const approveRes = await ctx.jsonRequest(`/api/admin/domains/${domain1Id}/authorize`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ action: 'approve', expires_at: futureExpiry }),
    });
    expect(approveRes.status).toBe(200);

    // 批准激活后，通过独立域名访问精准路由至该分站
    const activeBoot = await ctx.jsonRequest<{
      tenant: { isSubAgent: boolean; slug: string; agentId: number };
    }>('https://shop-one.brand.example/api/storefront/bootstrap');
    expect(activeBoot.status).toBe(200);
    expect(activeBoot.data.tenant.isSubAgent).toBe(true);
    expect(activeBoot.data.tenant.slug).toBe(agentSlug);
    expect(activeBoot.data.tenant.agentId).toBe(agentId);

    // 模拟域名授权到期 -> 立即 403 拦截
    const pastExpiry = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
    await ctx.db.update(tenantDomains).set({ expiresAt: pastExpiry }).where(eq(tenantDomains.id, domain1Id));
    const expiredRes = await ctx.jsonRequest<{ code?: string; error?: string }>(
      'https://shop-one.brand.example/api/storefront/bootstrap'
    );
    expect(expiredRes.status).toBe(403);
    expect(expiredRes.data.code).toBe('UNAUTHORIZED_DOMAIN');
    expect(expiredRes.data.error).toContain('过期');

    // 总控执行吊销 -> 立即 403 拦截
    await ctx.jsonRequest(`/api/admin/domains/${domain1Id}/authorize`, {
      method: 'POST',
      headers: adminAuth,
      body: JSON.stringify({ action: 'revoke', note: '合规下架测试' }),
    });
    const revokedRes = await ctx.jsonRequest<{ code?: string; error?: string }>(
      'https://shop-one.brand.example/api/storefront/bootstrap'
    );
    expect(revokedRes.status).toBe(403);
    expect(revokedRes.data.code).toBe('UNAUTHORIZED_DOMAIN');
    expect(revokedRes.data.error).toContain('吊销');

    // 分站切换主域与解绑释放配额
    const setPrimary = await ctx.jsonRequest(`${agentHost}/api/agent/domains/${domain2Id}/primary`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(setPrimary.status).toBe(200);

    const del1 = await ctx.jsonRequest(`${agentHost}/api/agent/domains/${domain1Id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(del1.status).toBe(200);

    // 总控全局 SaaS 策略支持主站域名白名单动态读写
    const updPolicy = await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ main_hostnames: 'accthub.example.com, main.accthub.example' }),
    });
    expect(updPolicy.status).toBe(200);

    const mainAllowed = await ctx.jsonRequest<{ tenant: { isSubAgent: boolean } }>(
      'https://accthub.example.com/api/storefront/bootstrap'
    );
    expect(mainAllowed.status).toBe(200);
    expect(mainAllowed.data.tenant.isSubAgent).toBe(false);
  });

  it('3. 禁用独立域名能力的等级无法绑定任何自定义域名', async () => {
    await ctx.db
      .update(agentTiers)
      .set({ allowCustomDomain: 0, maxCustomDomains: 0 })
      .where(eq(agentTiers.id, tierId));
    await ctx.db.update(agents).set({ tierId }).where(eq(agents.id, agentId));

    const denied = await ctx.jsonRequest(`http://${agentSlug}.localhost/api/agent/domains`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ hostname: 'denied-tier.example.com' }),
    });
    expect(denied.status).toBe(403);
  });

  it('4. 本地开发环境全新空库执行演示种子 ensureDemoSeeded 零报错且 @studio 分站可正常路由', async () => {
    const devCtx = createTestApp({ APP_ENV: 'development', SANDBOX_MODE: 'true' });
    try {
      await ensureDemoSeeded(devCtx.env);
      const studioBoot = await devCtx.jsonRequest<{ tenant: { isSubAgent: boolean; slug: string } }>(
        'http://studio.localhost/api/storefront/bootstrap'
      );
      expect(studioBoot.status).toBe(200);
      expect(studioBoot.data.tenant.isSubAgent).toBe(true);
      expect(studioBoot.data.tenant.slug).toBe('studio');
    } finally {
      devCtx.close();
    }
  });
});
