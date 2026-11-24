import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentProductOverrides,
  agentProductPrices,
  agents,
  agentTiers,
  announcements,
  categories,
  categoryGroups,
  coupons,
  helpArticles,
  paymentPlugins,
  productCards,
  products,
  productUpstreamBindings,
  restockSubscriptions,
  siteSettings,
  upstreamSources,
  users,
} from '../../worker/db/schema/index';
import { hashPassword } from '../../worker/infra/auth-crypto';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B2 垂直领域集成测试：Catalog 与 Storefront 前台商城（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let productId: number;
  let hiddenProductId: number;
  let agentId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();

    // 写入全站配置（故意混入敏感总控项验证脱敏）
    await ctx.db.insert(siteSettings).values([
      { key: 'brand_name', value: 'AcctHub 主站' },
      { key: 'ai_api_key', value: 'sk-secret-must-not-leak' },
      { key: 'cf_saas_api_token', value: 'cf-secret-must-not-leak' },
      { key: 'notify_webhook_url', value: 'https://internal.hook/secret' },
    ]);

    // 写入分组与分类
    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'ai-tools', name: 'AI 工具', nameEn: 'AI Tools', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'claude', name: 'Claude 专区', nameEn: 'Claude', sortOrder: 1 })
      .returning();

    // 写入代理等级、店主用户与分站
    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'gold',
        name: '金牌代理',
        levelRank: 1,
        minRecharge: 100,
        discountRate: 0.85,
      })
      .returning();

    const [owner] = await ctx.db
      .insert(users)
      .values({
        siteAgentId: 0,
        email: 'partner@accthub.dev',
        displayName: 'Partner',
        passwordHash: await hashPassword('Partner123!'),
        role: 'agent',
      })
      .returning();

    const [agent] = await ctx.db
      .insert(agents)
      .values({
        userId: owner.id,
        tierId: tier.id,
        slug: 'beta',
        brandName: 'Beta 严选小店',
        brandTagline: 'Beta 专属副标题',
        markupPercent: 20,
        apiKey: 'ah_agent_beta_test_key',
        status: 'active',
      })
      .returning();
    agentId = agent.id;

    // 写入 2 件商品（含成本价 cost_price 验证前端脱敏，以及 translations_json 5语种数据）
    const [prod1, prod2] = await ctx.db
      .insert(products)
      .values([
        {
          categoryId: cat.id,
          slug: 'claude-pro-seat',
          title: 'Claude Pro 独享席位',
          titleEn: 'Claude Pro Dedicated Seat',
          subtitle: '稳定编程与深度推理',
          basePrice: 100,
          costPrice: 62,
          stockMode: 'cards',
          tagsJson: JSON.stringify(['编程', '独享']),
          translationsJson: JSON.stringify({ ja: { title: 'Claude Pro 専用' } }),
          specsJson: JSON.stringify([
            { id: 'month', name: '月卡', price: 100, cost_price: 62, original_price: 150 },
            { id: 'quarter', name: '季卡', price: 280, cost_price: 180 },
          ]),
          isFeatured: 1,
          isActive: 1,
          salesCount: 120,
        },
        {
          categoryId: cat.id,
          slug: 'hidden-by-beta',
          title: '仅主站销售测试商品',
          basePrice: 50,
          stockMode: 'manual',
          manualStock: 20,
          specsJson: JSON.stringify([{ id: 'default', name: '标准版', price: 50 }]),
          isFeatured: 1,
          isActive: 1,
          salesCount: 10,
        },
      ])
      .returning();
    productId = prod1.id;
    hiddenProductId = prod2.id;

    // 写入本地卡密（月卡 2 张，季卡 1 张）
    await ctx.db.insert(productCards).values([
      { productId: prod1.id, specId: 'month', cardContent: 'CARD-M-1', status: 'available' },
      { productId: prod1.id, specId: 'month', cardContent: 'CARD-M-2', status: 'available' },
      { productId: prod1.id, specId: 'quarter', cardContent: 'CARD-Q-1', status: 'available' },
      { productId: prod1.id, specId: 'month', cardContent: 'CARD-SOLD', status: 'sold' },
    ]);

    // 写入健康上游源（余额 ¥300，单价 ¥60 -> 最多可买 5 件，绑定库存 8 -> 取 min(8,5)=5）
    const [src] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: '测试上游',
        cachedBalance: 300,
        status: 'active',
      })
      .returning();
    await ctx.db.insert(productUpstreamBindings).values({
      productId: prod1.id,
      specId: 'month',
      sourceId: src.id,
      upstreamItemId: 'up-claude-1',
      fulfillmentMode: 'local_first',
      cachedCost: 60,
      cachedStock: 8,
      isEnabled: 1,
      circuitBrokenReason: '',
    });

    // 分站 Beta：隐藏第 2 件商品、覆写第 1 件标题，并仅给 month 规格设自定义价 ¥138（季卡沿用 +20% 加价）
    await ctx.db.insert(agentProductOverrides).values([
      { agentId: agent.id, productId: prod1.id, isListed: 1, customTitle: 'Beta 定制 Claude Pro' },
      { agentId: agent.id, productId: prod2.id, isListed: 0 },
    ]);
    await ctx.db.insert(agentProductPrices).values({
      agentId: agent.id,
      productId: prod1.id,
      specId: 'month',
      customPrice: 138,
    });

    // 公告、帮助文档、支付插件、优惠券
    await ctx.db.insert(announcements).values([
      { ownerAgentId: 0, audience: 'storefront', title: '主站公告', content: '主站内容', isActive: 1 },
      {
        ownerAgentId: agent.id,
        audience: 'storefront',
        title: 'Beta 专属公告',
        content: '分站内容',
        isActive: 1,
      },
    ]);
    await ctx.db.insert(helpArticles).values({
      category: '入门',
      title: '如何使用 2FA',
      content: '操作步骤...',
      translationsJson: JSON.stringify({ en: { title: 'How to use 2FA' } }),
      isActive: 1,
    });
    await ctx.db.insert(paymentPlugins).values({
      id: 'epay',
      name: '易支付',
      description: '支付宝/微信',
      enabled: 1,
    });
    await ctx.db.insert(coupons).values([
      {
        code: 'SAVE20',
        name: '立减 20',
        discountType: 'fixed',
        discountValue: 20,
        minOrderAmount: 100,
        maxUses: 10,
        usedCount: 0,
        isActive: 1,
      },
      {
        code: 'EXPIRED10',
        name: '已过期券',
        discountType: 'fixed',
        discountValue: 10,
        minOrderAmount: 0,
        maxUses: 10,
        usedCount: 0,
        expiresAt: '2020-01-01T00:00:00Z',
        isActive: 1,
      },
    ]);
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. /bootstrap 严格脱敏总控密钥、实现分站白牌与隐藏商品计数隔离', async () => {
    const mainBoot = await ctx.jsonRequest<{
      settings: Record<string, string>;
      counts: { all: number; featured: number };
      announcements: Array<{ title: string }>;
    }>('/api/storefront/bootstrap?nocache=1');
    expect(mainBoot.status).toBe(200);
    expect(mainBoot.data.settings.brand_name).toBe('AcctHub 主站');
    expect(mainBoot.data.settings.ai_api_key).toBeUndefined();
    expect(mainBoot.data.settings.cf_saas_api_token).toBeUndefined();
    expect(mainBoot.data.settings.notify_webhook_url).toBeUndefined();
    expect(mainBoot.data.counts.all).toBe(2);
    expect(mainBoot.data.announcements[0].title).toBe('主站公告');

    // 子分站域名访问：隐藏商品从 counts 剔除，且品牌与公告完全隔离
    const subBoot = await ctx.jsonRequest<{
      settings: Record<string, string>;
      counts: { all: number };
      announcements: Array<{ title: string }>;
    }>('http://beta.localhost/api/storefront/bootstrap?nocache=1');
    expect(subBoot.status).toBe(200);
    expect(subBoot.data.settings.brand_name).toBe('Beta 严选小店');
    expect(subBoot.data.counts.all).toBe(1);
    expect(subBoot.data.announcements[0].title).toBe('Beta 专属公告');
  });

  it('2. /products 与 /products/:idOrSlug 准确合并本地+上游库存、应用多规格自定义定价并脱敏 cost_price', async () => {
    // 主站列表：总可用库存 = 本地 3 张 + 上游按余额可购 5 张 = 8
    const list = await ctx.jsonRequest<{
      items: Array<{
        id: number;
        slug: string;
        available_stock: number;
        translations_json: string;
        specs: Array<{ id: string; price: number; cost_price?: number }>;
      }>;
    }>('/api/storefront/products?category=claude&nocache=1');
    expect(list.status).toBe(200);
    expect(list.data.items.length).toBe(2);
    const claude = list.data.items.find((i) => i.slug === 'claude-pro-seat');
    expect(claude).toBeTruthy();
    expect(claude?.available_stock).toBe(8);
    expect(claude?.translations_json).toContain('Claude Pro 専用');
    expect(claude?.specs[0].cost_price).toBeUndefined();

    // 子分站详情：月卡走定制价 ¥138，季卡走 +20% 加价 280 * 1.2 = ¥336，标题被覆写
    const subDetail = await ctx.jsonRequest<{
      product: {
        title: string;
        specs: Array<{ id: string; price: number }>;
        spec_stock: Record<string, number>;
      };
    }>(`http://beta.localhost/api/storefront/products/${productId}`);
    expect(subDetail.status).toBe(200);
    expect(subDetail.data.product.title).toBe('Beta 定制 Claude Pro');
    expect(subDetail.data.product.specs.find((s) => s.id === 'month')?.price).toBe(138);
    expect(subDetail.data.product.specs.find((s) => s.id === 'quarter')?.price).toBe(336);
    expect(subDetail.data.product.spec_stock.month).toBe(7); // 本地 2 + 上游 5
    expect(subDetail.data.product.spec_stock.quarter).toBe(1); // 本地 1

    // 分站下架商品详情返回 404
    const hiddenDetail = await ctx.jsonRequest(
      `http://beta.localhost/api/storefront/products/${hiddenProductId}`
    );
    expect(hiddenDetail.status).toBe(404);
  });

  it('3. 智能导购、帮助中心、优惠券预检与缺货订阅幂等闭环', async () => {
    const match = await ctx.jsonRequest<{ items: Array<{ slug: string }> }>(
      '/api/storefront/concierge/match',
      { method: 'POST', body: JSON.stringify({ prompt: '我要写代码用 claude' }) }
    );
    expect(match.status).toBe(200);
    expect(match.data.items[0].slug).toBe('claude-pro-seat');

    const help = await ctx.jsonRequest<{ articles: Array<{ title: string; translations_json: string }> }>(
      '/api/storefront/help'
    );
    expect(help.status).toBe(200);
    expect(help.data.articles[0].translations_json).toContain('How to use 2FA');

    // 优惠券预检：满额通过 / 门槛不足 400 / 已过期 400 / 不存在 404
    const okCoupon = await ctx.jsonRequest<{ discount_amount: number; final_amount: number }>(
      '/api/storefront/coupons/validate',
      { method: 'POST', body: JSON.stringify({ code: 'save20', subtotal: 120 }) }
    );
    expect(okCoupon.status).toBe(200);
    expect(okCoupon.data.discount_amount).toBe(20);
    expect(okCoupon.data.final_amount).toBe(100);

    const lowSub = await ctx.jsonRequest('/api/storefront/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code: 'SAVE20', subtotal: 50 }),
    });
    expect(lowSub.status).toBe(400);

    const expired = await ctx.jsonRequest('/api/storefront/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code: 'EXPIRED10', subtotal: 50 }),
    });
    expect(expired.status).toBe(400);

    // 缺货提醒：重复订阅走 ON CONFLICT DO UPDATE 幂等，数据库仅存 1 条记录
    const sub1 = await ctx.jsonRequest('http://beta.localhost/api/storefront/restock-subscribe', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, spec_id: 'month', email: 'Wait@Example.com' }),
    });
    const sub2 = await ctx.jsonRequest('http://beta.localhost/api/storefront/restock-subscribe', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, spec_id: 'month', email: 'wait@example.com' }),
    });
    expect(sub1.status).toBe(200);
    expect(sub2.status).toBe(200);

    const rows = await ctx.db
      .select()
      .from(restockSubscriptions)
      .where(eq(restockSubscriptions.email, 'wait@example.com'));
    expect(rows.length).toBe(1);
    expect(rows[0].siteAgentId).toBe(agentId);
  });
});
