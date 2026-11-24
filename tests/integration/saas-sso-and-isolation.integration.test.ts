import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentTiers,
  categories,
  categoryGroups,
  coupons,
  helpArticles,
  paymentPlugins,
  productCards,
  products,
  users,
} from '../../worker/db/schema/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('Phase 2 SaaS 集成测试：分站域名自治、跨站 SSO 免登与优惠券/帮助中心隔离', () => {
  let ctx: TestAppContext;
  let adminAuth: { Authorization: string };
  let agentAToken: string;
  let agentASlug: string;
  let agentAId: number;
  let agentBSlug: string;
  let platformProductId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    adminAuth = await ctx.adminHeaders();

    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'ai', name: 'AI 专区', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'gpt', name: 'ChatGPT', sortOrder: 1 })
      .returning();
    const [prod] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId: cat.id,
        slug: 'gpt-plus',
        title: 'ChatGPT Plus 月卡',
        basePrice: 100,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'month', name: '月卡', price: 100 }]),
        isActive: 1,
      })
      .returning();
    platformProductId = prod.id;
    await ctx.db.insert(productCards).values([
      {
        ownerAgentId: 0,
        productId: prod.id,
        specId: 'month',
        cardContent: 'GPT-CARD-1',
        status: 'available',
      },
      {
        ownerAgentId: 0,
        productId: prod.id,
        specId: 'month',
        cardContent: 'GPT-CARD-2',
        status: 'available',
      },
    ]);

    await ctx.db
      .insert(paymentPlugins)
      .values({
        id: 'demo_instant',
        name: '内置演示直付',
        description: '测试演示通道',
        enabled: 1,
        configJson: '{}',
      })
      .onConflictDoNothing();

    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'gold',
        name: '金牌代理',
        levelRank: 2,
        minRecharge: 100,
        discountRate: 0.8, // 平台代销拿货底价 = 100 * 0.8 = ¥80
      })
      .returning();

    // 开通分站 A 与分站 B
    const regA = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'agent-a@example.com', password: 'Password123!' }),
    });
    agentAToken = regA.data.token;
    await ctx.db.update(users).set({ balance: 300 }).where(eq(users.id, regA.data.user.id));
    const openA = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ target_tier_id: tier.id, payment_method: 'balance' }),
    });
    agentAId = openA.data.agent.id;
    agentASlug = openA.data.agent.slug;

    const regB = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'agent-b@example.com', password: 'Password123!' }),
    });
    await ctx.db.update(users).set({ balance: 300 }).where(eq(users.id, regB.data.user.id));
    const openB = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${regB.data.token}` },
      body: JSON.stringify({ target_tier_id: tier.id, payment_method: 'balance' }),
    });
    agentBSlug = openB.data.agent.slug;
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 跨站 60 秒一次性 SSO 免登全闭环：签发、目标域原子核销、防二次重放、防跨站窃取', async () => {
    // 主站查询我的分站入口
    const entry = await ctx.jsonRequest<{ slug: string; target_origin: string }>(
      'http://localhost/api/agent/my-store-entry',
      { headers: { Authorization: `Bearer ${agentAToken}` } }
    );
    expect(entry.status).toBe(200);
    expect(entry.data.slug).toBe(agentASlug);
    expect(entry.data.target_origin).toBe(`http://${agentASlug}.localhost`);

    // 主站签发一次性 SSO 票据
    const issued = await ctx.jsonRequest<{ ticket: string; redirect_url: string }>(
      'http://localhost/api/auth/sso/issue',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ redirect_path: '/agent' }),
      }
    );
    expect(issued.status).toBe(200);
    expect(issued.data.ticket).toMatch(/^ahsso_/);
    expect(issued.data.redirect_url).toContain(`http://${agentASlug}.localhost/sso/callback`);

    // 尝试在主站核销 -> 403 拒绝
    const mainExchange = await ctx.jsonRequest('http://localhost/api/auth/sso/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket: issued.data.ticket }),
    });
    expect(mainExchange.status).toBe(403);

    // 尝试在 B 分站窃取核销 A 的票据 -> 401 拒绝
    const crossExchange = await ctx.jsonRequest(`http://${agentBSlug}.localhost/api/auth/sso/exchange`, {
      method: 'POST',
      body: JSON.stringify({ ticket: issued.data.ticket }),
    });
    expect(crossExchange.status).toBe(401);

    // 在 A 分站自身域名原子核销成功并拿到独立 JWT
    const okExchange = await ctx.jsonRequest<{ ok: boolean; token: string; redirect_path: string }>(
      `http://${agentASlug}.localhost/api/auth/sso/exchange`,
      {
        method: 'POST',
        body: JSON.stringify({ ticket: issued.data.ticket }),
      }
    );
    expect(okExchange.status).toBe(200);
    expect(okExchange.data.ok).toBe(true);
    expect(okExchange.data.token.length).toBeGreaterThan(20);
    expect(okExchange.data.redirect_path).toBe('/agent');

    // 二次重放同一票据 -> 401 拒绝
    const replay = await ctx.jsonRequest(`http://${agentASlug}.localhost/api/auth/sso/exchange`, {
      method: 'POST',
      body: JSON.stringify({ ticket: issued.data.ticket }),
    });
    expect(replay.status).toBe(401);
  });

  it('2. 分站域名自治守卫：主站与他站域名严禁操作本分站后台，仅允许在自身分站域名下操作', async () => {
    // 在主站调用 PUT /api/agent/brand -> 403 拦截
    const mainWrite = await ctx.jsonRequest('http://localhost/api/agent/brand', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ brand_name: '非法主站修改' }),
    });
    expect(mainWrite.status).toBe(403);

    // 在 B 分站调用 PUT /api/agent/brand -> 跨站会话/自治守卫拒绝（401 或 403）
    const otherWrite = await ctx.jsonRequest(`http://${agentBSlug}.localhost/api/agent/brand`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ brand_name: '非法跨站修改' }),
    });
    expect([401, 403]).toContain(otherWrite.status);

    // 在 A 分站自身域名正常更新品牌与独立站点偏好（关闭 API 文档入口 & 不继承平台帮助）
    const okBrand = await ctx.jsonRequest(`http://${agentASlug}.localhost/api/agent/brand`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ brand_name: 'A 站独立旗舰店' }),
    });
    expect(okBrand.status).toBe(200);

    const okPrefs = await ctx.jsonRequest(`http://${agentASlug}.localhost/api/agent/site-settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ show_api_docs: false, inherit_platform_help: false }),
    });
    expect(okPrefs.status).toBe(200);

    const bootA = await ctx.jsonRequest<{
      tenant: {
        brandName: string;
        capabilities?: { show_api_docs?: boolean; inherit_platform_help?: boolean };
      };
    }>(`http://${agentASlug}.localhost/api/storefront/bootstrap`);
    expect(bootA.status).toBe(200);
    expect(bootA.data.tenant.brandName).toBe('A 站独立旗舰店');
    expect(bootA.data.tenant.capabilities?.show_api_docs).toBe(false);
    expect(bootA.data.tenant.capabilities?.inherit_platform_help).toBe(false);
  });

  it('3. 优惠券按租户严格隔离且分站大额券绝不击穿平台代销拿货底价；帮助中心支持继承/独立切换', async () => {
    const aOrigin = `http://${agentASlug}.localhost`;

    // 主站创建一张主站券 MAIN50
    await ctx.db.insert(coupons).values({
      ownerAgentId: 0,
      code: 'MAIN50',
      name: '主站满减券',
      discountType: 'fixed',
      discountValue: 50,
      minOrderAmount: 0,
      maxUses: 10,
      isActive: 1,
    });

    // 分站 A 创建一张大额立减券 SUB50（面额 ¥50，商品原价 ¥100、分站拿货底价 ¥80）
    const createSubCoupon = await ctx.jsonRequest<{ ok: boolean }>(`${aOrigin}/api/agent/coupons`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({
        code: 'SUB50',
        name: 'A站大额券',
        discount_type: 'fixed',
        discount_value: 50,
        min_order_amount: 0,
        max_uses: 10,
      }),
    });
    expect(createSubCoupon.status).toBe(201);

    // 隔离校验：主站券 MAIN50 在分站 A 预检报错不可用；分站券 SUB50 在主站不可用
    const mainCouponOnA = await ctx.jsonRequest(`${aOrigin}/api/storefront/coupon-preview`, {
      method: 'POST',
      body: JSON.stringify({ code: 'MAIN50', subtotal: 100 }),
    });
    expect(mainCouponOnA.status).toBe(404);

    const subCouponOnMain = await ctx.jsonRequest('http://localhost/api/storefront/coupon-preview', {
      method: 'POST',
      body: JSON.stringify({ code: 'SUB50', subtotal: 100 }),
    });
    expect(subCouponOnMain.status).toBe(404);

    // 在 A 站注册一个会员下单平台商品（售价 ¥100、站长拿货底价 ¥80）使用 ¥50 分站券 -> 折扣自动钳位到 ¥20，实付绝不低于 ¥80
    const buyerReg = await ctx.jsonRequest<{ token: string }>(`${aOrigin}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email: 'buyer-a@example.com', password: 'Password123!' }),
    });
    const orderRes = await ctx.jsonRequest<{
      order: { total_amount: number; discount_amount: number; status: string };
    }>(`${aOrigin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyerReg.data.token}` },
      body: JSON.stringify({
        product_id: platformProductId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer-a@example.com',
        payment_method: 'demo_instant',
        coupon_code: 'SUB50',
      }),
    });
    // 默认分站加价 12%（售价 ¥112），拿货底价 ¥80 -> ¥50 分站券自动钳位到毛利上限 ¥32，实付绝不低于拿货底价 ¥80
    expect(orderRes.status).toBe(200);
    expect(orderRes.data.order.discount_amount).toBe(32);
    expect(orderRes.data.order.total_amount).toBe(80);
    expect(orderRes.data.order.status).toBe('delivered');

    // 帮助中心隔离与继承校验
    await ctx.db.insert(helpArticles).values({
      ownerAgentId: 0,
      category: 'guide',
      title: '平台通用帮助文档',
      content: '主站内容',
      isActive: 1,
    });
    const createSubHelp = await ctx.jsonRequest(`${aOrigin}/api/agent/help`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({
        category: 'faq',
        title: 'A 站专属售后指南',
        content: '仅 A 站可见',
        is_active: true,
      }),
    });
    expect(createSubHelp.status).toBe(201);

    // 默认 inherit_platform_help = true：同时可见平台文章 + A 站文章
    const helpMerged = await ctx.jsonRequest<{ articles: Array<{ title: string }> }>(
      `${aOrigin}/api/storefront/help`
    );
    expect(helpMerged.status).toBe(200);
    expect(helpMerged.data.articles.map((a) => a.title)).toContain('平台通用帮助文档');
    expect(helpMerged.data.articles.map((a) => a.title)).toContain('A 站专属售后指南');

    // 关闭 inherit_platform_help = false：仅可见 A 站自建文章
    await ctx.jsonRequest(`${aOrigin}/api/agent/site-settings`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ inherit_platform_help: false }),
    });
    const helpIsolated = await ctx.jsonRequest<{ articles: Array<{ title: string }> }>(
      `${aOrigin}/api/storefront/help`
    );
    expect(helpIsolated.data.articles.map((a) => a.title)).toEqual(['A 站专属售后指南']);

    // 主站帮助列表绝对不泄露分站文章（总控管理列表也只返回 ownerAgentId=0）
    const mainHelp = await ctx.jsonRequest<{ articles: Array<{ title: string }> }>(
      'http://localhost/api/storefront/help'
    );
    expect(mainHelp.data.articles.map((a) => a.title)).toEqual(['平台通用帮助文档']);
    const adminOverview = await ctx.jsonRequest<{ help_articles: Array<{ title: string }> }>(
      'http://localhost/api/admin/overview',
      { headers: adminAuth }
    );
    expect(adminOverview.data.help_articles.map((a) => a.title)).toEqual(['平台通用帮助文档']);
    expect(agentAId).toBeGreaterThan(0);
  });
});
