import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentTiers,
  categories,
  categoryGroups,
  paymentPlugins,
  productCards,
  products,
  users,
} from '../../worker/db/schema/index';
import { signEpayParams } from '../../worker/domains/payment/payment.gateway';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('Phase 3 SaaS 集成测试：分站私有商品与自有加密卡密的反洗钱强隔离闭环', () => {
  let ctx: TestAppContext;
  let adminAuth: { Authorization: string };
  let categoryId: number;
  let tierId: number;
  let agentAUserId: number;
  let agentAToken: string;
  let agentAId: number;
  let agentASlug: string;
  let agentBSlug: string;

  const AGENT_A_EPAY_KEY = 'agent_a_private_direct_key_888';

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
      .values({ groupId: grp.id, slug: 'tools', name: '独立工具', sortOrder: 1 })
      .returning();
    categoryId = cat.id;

    // 平台公共商品与卡密，验证私有商品下单绝不动平台库存
    const [platformProd] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId,
        slug: 'platform-item',
        title: '平台公共商品',
        basePrice: 50,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'default', name: '标准版', price: 50 }]),
        isActive: 1,
      })
      .returning();
    await ctx.db.insert(productCards).values({
      ownerAgentId: 0,
      productId: platformProd.id,
      specId: 'default',
      cardContent: 'PLATFORM-KEY-001',
      status: 'available',
    });

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

    // 等级默认未开启自有收款与私有商品权限
    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'vip',
        name: '尊享分站',
        levelRank: 2,
        minRecharge: 100,
        discountRate: 0.8,
        allowPrivateProducts: 0,
        allowOwnPayment: 0,
      })
      .returning();
    tierId = tier.id;

    const regA = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'priv-a@example.com', password: 'Password123!' }),
    });
    agentAToken = regA.data.token;
    agentAUserId = regA.data.user.id;
    await ctx.db.update(users).set({ balance: 100 }).where(eq(users.id, agentAUserId));
    const openA = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({ target_tier_id: tierId, payment_method: 'balance' }),
    });
    agentAId = openA.data.agent.id;
    agentASlug = openA.data.agent.slug;

    const regB = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'priv-b@example.com', password: 'Password123!' }),
    });
    await ctx.db.update(users).set({ balance: 100 }).where(eq(users.id, regB.data.user.id));
    const openB = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${regB.data.token}` },
      body: JSON.stringify({ target_tier_id: tierId, payment_method: 'balance' }),
    });
    agentBSlug = openB.data.agent.slug;
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 私有商品强依赖自有收款（全局+等级+单店覆写），且未启用自有收款账户时严禁上架私有商品', async () => {
    const aOrigin = `http://${agentASlug}.localhost`;

    // 仅开启私有商品但未开启自有收款 -> 403 硬拦截（防止私有商品走主站资金流水）
    await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        saas_allow_private_products_global: true,
        saas_allow_own_payment_global: false,
      }),
    });
    await ctx.jsonRequest(`/api/admin/agent-tiers/${tierId}`, {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ allow_private_products: true, allow_own_payment: false }),
    });
    const deniedNoOwnPay = await ctx.jsonRequest(`${aOrigin}/api/agent/private-products`, {
      headers: { Authorization: `Bearer ${agentAToken}` },
    });
    expect(deniedNoOwnPay.status).toBe(403);

    // 全局与等级同时开启自有收款 + 私有商品 -> 允许进入列表页 200
    await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ saas_allow_private_products_global: true, saas_allow_own_payment_global: true }),
    });
    await ctx.jsonRequest(`/api/admin/agent-tiers/${tierId}`, {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ allow_private_products: true, allow_own_payment: true }),
    });
    const allowedList = await ctx.jsonRequest(`${aOrigin}/api/agent/private-products`, {
      headers: { Authorization: `Bearer ${agentAToken}` },
    });
    expect(allowedList.status).toBe(200);

    // 分站尚未启用任何自有收款账户时，直接上架私有商品 -> 403 拦截！
    const createWithoutPay = await ctx.jsonRequest(`${aOrigin}/api/agent/private-products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({
        category_id: categoryId,
        title: '未配收款的私有商品',
        base_price: 99,
        is_active: true,
      }),
    });
    expect(createWithoutPay.status).toBe(403);

    // 单店强制禁用自有收款（0）-> 同步剥夺私有商品权限 403
    await ctx.jsonRequest(`/api/admin/agents/${agentAId}`, {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ allow_own_payment_override: 0 }),
    });
    const deniedOverride = await ctx.jsonRequest(`${aOrigin}/api/agent/private-products`, {
      headers: { Authorization: `Bearer ${agentAToken}` },
    });
    expect(deniedOverride.status).toBe(403);
  });

  it('2. 私有商品严禁走平台余额/主站通道，必须强制经分站自有收款账户直收，且零进入主站资金流水与站长钱包', async () => {
    const aOrigin = `http://${agentASlug}.localhost`;
    const bOrigin = `http://${agentBSlug}.localhost`;

    // 开启全局 + 单店自有收款与私有商品权限
    await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ saas_allow_private_products_global: true, saas_allow_own_payment_global: true }),
    });
    await ctx.jsonRequest(`/api/admin/agents/${agentAId}`, {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ allow_own_payment_override: 1, allow_private_products_override: 1 }),
    });

    // 分站 A 先配置并启用自己的易支付收款账户
    const saveOwnPay = await ctx.jsonRequest(`${aOrigin}/api/agent/payment-plugins/epay`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({
        enabled: true,
        config: {
          api_url: 'https://agent-a-pay.example.com',
          pid: '30003',
          key: AGENT_A_EPAY_KEY,
          pay_type: 'alipay',
        },
      }),
    });
    expect(saveOwnPay.status).toBe(200);

    // 上架私有商品（售价 ¥100）并导入 2 条自有加密卡密
    const createRes = await ctx.jsonRequest<{ id: number }>(`${aOrigin}/api/agent/private-products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentAToken}` },
      body: JSON.stringify({
        category_id: categoryId,
        slug: 'agent-a-secret-key',
        title: 'A 站独家私有工具 Key',
        subtitle: '仅在 A 站自有收款出售',
        base_price: 100,
        specs: [{ id: 'std', name: '标准激活码', price: 100 }],
        is_active: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const privateProdId = createRes.data.id;

    const importCards = await ctx.jsonRequest<{ imported: number }>(
      `${aOrigin}/api/agent/private-products/${privateProdId}/cards`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentAToken}` },
        body: JSON.stringify({ spec_id: 'std', lines: 'PRIV-A-SECRET-001\nPRIV-A-SECRET-002' }),
      }
    );
    expect(importCards.status).toBe(201);
    expect(importCards.data.imported).toBe(2);

    // 验证数据库中私有卡密已加密且带 ownerAgentId 隔离
    const rawCards = await ctx.db
      .select()
      .from(productCards)
      .where(eq(productCards.productId, privateProdId));
    expect(rawCards.length).toBe(2);
    expect(rawCards[0].ownerAgentId).toBe(agentAId);
    expect(rawCards[0].cardContent).not.toBe('PRIV-A-SECRET-001');

    // 跨站完全不可见且跨站下单 404
    const mainList = await ctx.jsonRequest<{ items: Array<{ id: number }> }>(
      'http://localhost/api/storefront/products'
    );
    expect(mainList.data.items.some((p) => p.id === privateProdId)).toBe(false);

    const bList = await ctx.jsonRequest<{ items: Array<{ id: number }> }>(
      `${bOrigin}/api/storefront/products`
    );
    expect(bList.data.items.some((p) => p.id === privateProdId)).toBe(false);

    const mainBuyer = await ctx.jsonRequest<{ token: string }>('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'main-hacker@example.com', password: 'Password123!' }),
    });
    const crossOrderMain = await ctx.jsonRequest('http://localhost/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${mainBuyer.data.token}` },
      body: JSON.stringify({
        product_id: privateProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'main-hacker@example.com',
        payment_method: 'balance',
      }),
    });
    expect(crossOrderMain.status).toBe(404);

    // 本分站买家注册并充值 ¥500 余额，测试反洗钱红线：严禁使用 balance 或 demo_instant 买私有商品！
    const fanReg = await ctx.jsonRequest<{ token: string; user: { id: number } }>(
      `${aOrigin}/api/auth/register`,
      {
        method: 'POST',
        body: JSON.stringify({ email: 'fan@example.com', password: 'Password123!' }),
      }
    );
    await ctx.db.update(users).set({ balance: 500 }).where(eq(users.id, fanReg.data.user.id));

    const blockedBalance = await ctx.jsonRequest(`${aOrigin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fanReg.data.token}` },
      body: JSON.stringify({
        product_id: privateProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'fan@example.com',
        payment_method: 'balance',
      }),
    });
    expect(blockedBalance.status).toBe(403);

    const blockedDemo = await ctx.jsonRequest(`${aOrigin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fanReg.data.token}` },
      body: JSON.stringify({
        product_id: privateProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'fan@example.com',
        payment_method: 'demo_instant',
      }),
    });
    expect(blockedDemo.status).toBe(403);

    // 正常合规闭环：走分站自有易支付账户直收下单并完成分站密钥验签回调
    const beforeAgent = (await ctx.db.select().from(users).where(eq(users.id, agentAUserId)))[0];
    const buyOwn = await ctx.jsonRequest<{
      requires_payment: boolean;
      order: { total_amount: number };
      payment_intent: { intent_no: string; view_token: string; pay_amount: number };
    }>(`${aOrigin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${fanReg.data.token}` },
      body: JSON.stringify({
        product_id: privateProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'fan@example.com',
        payment_method: 'epay',
      }),
    });
    expect(buyOwn.status).toBe(200);
    expect(buyOwn.data.requires_payment).toBe(true);
    expect(buyOwn.data.order.total_amount).toBe(100);

    const cbParams: Record<string, string> = {
      pid: '30003',
      trade_no: 'PRIV-OWN-TRADE-001',
      out_trade_no: buyOwn.data.payment_intent.intent_no,
      type: 'alipay',
      name: 'Private',
      money: '100.00',
      trade_status: 'TRADE_SUCCESS',
    };
    const sign = signEpayParams(cbParams, AGENT_A_EPAY_KEY);
    const cbRes = await ctx.request(
      `${aOrigin}/api/payments/webhook/epay?${new URLSearchParams({ ...cbParams, sign, sign_type: 'MD5' }).toString()}`
    );
    expect(await cbRes.text()).toBe('success');
    expect(cbRes.status).toBe(200);

    // 验证买家拿到分站自有卡密、平台卡密毫发无损、站长主站钱包余额零变动、主站财务对账 GMV 零计入
    const poll = await ctx.jsonRequest<{ order: { status: string; delivered_payload: string } }>(
      `${aOrigin}/api/payments/intents/${buyOwn.data.payment_intent.intent_no}`,
      {
        headers: {
          Authorization: `Bearer ${fanReg.data.token}`,
          'X-Intent-Token': buyOwn.data.payment_intent.view_token,
        },
      }
    );
    expect(poll.data.order.status).toBe('delivered');
    expect(poll.data.order.delivered_payload).toBe('PRIV-A-SECRET-001');

    const afterAgent = (await ctx.db.select().from(users).where(eq(users.id, agentAUserId)))[0];
    expect(afterAgent.balance).toBe(beforeAgent.balance);

    const platformCards = await ctx.db.select().from(productCards).where(eq(productCards.ownerAgentId, 0));
    expect(platformCards.every((c) => c.status === 'available')).toBe(true);

    const finRes = await ctx.jsonRequest<{ summary: { gross_gmv: number; paid_orders: number } }>(
      '/api/admin/finance/reconciliation?days=30',
      { headers: adminAuth }
    );
    expect(finRes.status).toBe(200);
    expect(finRes.data.summary.gross_gmv).toBe(0);
    expect(finRes.data.summary.paid_orders).toBe(0);
  });
});
