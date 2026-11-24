import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentTiers,
  categories,
  categoryGroups,
  productCards,
  products,
  tenantPaymentPlugins,
  users,
} from '../../worker/db/schema/index';
import { signEpayParams } from '../../worker/domains/payment/payment.gateway';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('Phase 4 SaaS 集成测试：分站自有收款渠道、跨租户回调防伪造与代销余额风控闭环', () => {
  let ctx: TestAppContext;
  let adminAuth: { Authorization: string };
  let categoryId: number;
  let platformProductId: number;
  let agentUserId: number;
  let agentToken: string;
  let agentId: number;
  let agentSlug: string;

  const MAIN_EPAY_KEY = 'main_platform_secret_key_999';
  const AGENT_EPAY_KEY = 'agent_own_epay_secret_key_777';

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
      .values({ groupId: grp.id, slug: 'cloud', name: '云服务', sortOrder: 1 })
      .returning();
    categoryId = cat.id;

    // 平台代销商品：原价 ¥100，金牌代理 0.7 折拿货底价 = ¥70
    const [prod] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId,
        slug: 'cloud-pro',
        title: '平台代销云会员',
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
        cardContent: 'PLAT-CLOUD-001',
        status: 'available',
      },
      {
        ownerAgentId: 0,
        productId: prod.id,
        specId: 'month',
        cardContent: 'PLAT-CLOUD-002',
        status: 'available',
      },
    ]);

    // 主站配置并启用主站易支付（使用不同商户密钥以验证防跨租户回调伪造）
    await ctx.jsonRequest('/api/admin/payment-plugins/epay', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({
        enabled: true,
        config: {
          api_url: 'https://main-pay.example.com',
          pid: '10001',
          key: MAIN_EPAY_KEY,
          pay_type: 'alipay',
        },
      }),
    });

    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'partner',
        name: '旗舰合伙人',
        levelRank: 2,
        minRecharge: 100,
        discountRate: 0.7,
        allowPrivateProducts: 1,
        allowOwnPayment: 1,
      })
      .returning();

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'pay-owner@example.com', password: 'Password123!' }),
    });
    agentToken = reg.data.token;
    agentUserId = reg.data.user.id;
    await ctx.db.update(users).set({ balance: 100 }).where(eq(users.id, agentUserId));

    const open = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ target_tier_id: tier.id, payment_method: 'balance' }),
    });
    agentId = open.data.agent.id;
    agentSlug = open.data.agent.slug;
  });

  afterEach(() => {
    ctx.close();
  });

  function buildEpayCallbackUrl(
    origin: string,
    params: { pid: string; intentNo: string; tradeNo: string; money: string; key: string }
  ) {
    const base: Record<string, string> = {
      pid: params.pid,
      trade_no: params.tradeNo,
      out_trade_no: params.intentNo,
      type: 'alipay',
      name: 'Order',
      money: params.money,
      trade_status: 'TRADE_SUCCESS',
    };
    const sign = signEpayParams(base, params.key);
    const qs = new URLSearchParams({ ...base, sign, sign_type: 'MD5' }).toString();
    return `${origin}/api/payments/webhook/epay?${qs}`;
  }

  it('1. 权限开关严格生效、分站密钥加密入库并掩码返回、跨租户伪造回调被验签拒绝、私有商品直收零动平台钱包', async () => {
    const origin = `http://${agentSlug}.localhost`;

    // 全局开关未开 -> 403 拒绝配置自有收款
    const blocked = await ctx.jsonRequest(`${origin}/api/agent/payment-plugins`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    expect(blocked.status).toBe(403);

    // 总控开启全局私有商品 + 全局自有收款开关
    await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ saas_allow_private_products_global: true, saas_allow_own_payment_global: true }),
    });

    // 分站配置并启用自有易支付
    const savePlugin = await ctx.jsonRequest(`${origin}/api/agent/payment-plugins/epay`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({
        enabled: true,
        config: {
          api_url: 'https://agent-pay.example.com',
          pid: '20002',
          key: AGENT_EPAY_KEY,
          pay_type: 'alipay',
        },
      }),
    });
    expect(savePlugin.status).toBe(200);

    // 校验数据库密文存储 + GET 返回仅暴露 secrets_configured 脱敏态
    const dbRow = (
      await ctx.db.select().from(tenantPaymentPlugins).where(eq(tenantPaymentPlugins.ownerAgentId, agentId))
    )[0];
    expect(dbRow.configJson).not.toContain(AGENT_EPAY_KEY);

    const listed = await ctx.jsonRequest<{
      plugins: Array<{
        id: string;
        enabled: number;
        config_json: string;
        secrets_configured: Record<string, boolean>;
      }>;
    }>(`${origin}/api/agent/payment-plugins`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    const epayItem = listed.data.plugins.find((p) => p.id === 'epay');
    expect(epayItem?.enabled).toBe(1);
    expect(epayItem?.config_json).not.toContain(AGENT_EPAY_KEY);
    expect(epayItem?.secrets_configured.key).toBe(true);

    // 分站创建私有商品 + 自有卡密
    const privProd = await ctx.jsonRequest<{ id: number }>(`${origin}/api/agent/private-products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({
        category_id: categoryId,
        slug: 'own-pay-priv',
        title: '自有直收私有商品',
        base_price: 88,
        specs: [{ id: 's1', name: '永久码', price: 88 }],
        is_active: true,
      }),
    });
    await ctx.jsonRequest(`${origin}/api/agent/private-products/${privProd.data.id}/cards`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({ spec_id: 's1', lines: 'OWN-DIRECT-KEY-888' }),
    });

    // 买家在分站用易支付下单私有商品（站长余额当前为 ¥0）
    const directBuyer = await ctx.jsonRequest<{ token: string }>(`${origin}/api/auth/register`, {
      method: 'POST',
      body: JSON.stringify({ email: 'direct@example.com', password: 'Password123!' }),
    });
    const orderRes = await ctx.jsonRequest<{
      requires_payment: boolean;
      order: { order_no: string; status: string };
      payment_intent: { intent_no: string; view_token: string };
    }>(`${origin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${directBuyer.data.token}` },
      body: JSON.stringify({
        product_id: privProd.data.id,
        spec_id: 's1',
        quantity: 1,
        contact_email: 'direct@example.com',
        payment_method: 'epay',
      }),
    });
    expect(orderRes.status).toBe(200);
    expect(orderRes.data.requires_payment).toBe(true);
    const { intent_no: intentNo, view_token: viewToken } = orderRes.data.payment_intent;

    // 攻击模拟：尝试使用主站易支付密钥伪造该分站直收支付单回调 -> 必须 400 验签失败！
    const spoofUrl = buildEpayCallbackUrl(origin, {
      pid: '10001',
      intentNo,
      tradeNo: 'FAKE-MAIN-001',
      money: '88.00',
      key: MAIN_EPAY_KEY,
    });
    const spoofRes = await ctx.request(spoofUrl);
    expect(spoofRes.status).toBe(400);

    // 合法回调：使用分站自有易支付密钥 -> 200 success，直接出自有卡密且站长平台钱包余额零变动
    const okUrl = buildEpayCallbackUrl(origin, {
      pid: '20002',
      intentNo,
      tradeNo: 'AGENT-REAL-001',
      money: '88.00',
      key: AGENT_EPAY_KEY,
    });
    const okRes = await ctx.request(okUrl);
    const okText = await okRes.text();
    expect(okText).toBe('success');
    expect(okRes.status).toBe(200);

    const poll = await ctx.jsonRequest<{
      intent: { status: string };
      order: { status: string; delivered_payload: string };
    }>(`${origin}/api/payments/intents/${intentNo}`, {
      headers: { Authorization: `Bearer ${directBuyer.data.token}`, 'X-Intent-Token': viewToken },
    });
    expect(poll.data.intent.status).toBe('paid');
    expect(poll.data.order.status).toBe('delivered');
    expect(poll.data.order.delivered_payload).toBe('OWN-DIRECT-KEY-888');

    const agentAfter = (await ctx.db.select().from(users).where(eq(users.id, agentUserId)))[0];
    expect(agentAfter.balance).toBe(0);
  });

  it('2. 双轨收款硬隔离：分站自有收款严禁收取平台代销主站商品，主站商品强制走主站通道并自动分润', async () => {
    const origin = `http://${agentSlug}.localhost`;

    await ctx.jsonRequest('/api/admin/saas-policy', {
      method: 'PUT',
      headers: adminAuth,
      body: JSON.stringify({ saas_allow_own_payment_global: true }),
    });
    await ctx.jsonRequest(`${origin}/api/agent/payment-plugins/epay`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify({
        enabled: true,
        config: {
          api_url: 'https://agent-pay.example.com',
          pid: '20002',
          key: AGENT_EPAY_KEY,
          pay_type: 'alipay',
        },
      }),
    });

    // 买家在分站用易支付下单平台代销商品：因主站未启用易支付且双轨硬隔离禁止分站自有收款截流主站商品，必须 400 拦截
    const buyer2 = await ctx.jsonRequest<{ token: string; user: { id: number } }>(
      `${origin}/api/auth/register`,
      {
        method: 'POST',
        body: JSON.stringify({ email: 'buyer2@example.com', password: 'Password123!' }),
      }
    );
    const blockedRes = await ctx.jsonRequest<{ code: string }>(`${origin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer2.data.token}` },
      body: JSON.stringify({
        product_id: platformProductId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer2@example.com',
        payment_method: 'epay',
      }),
    });
    expect(blockedRes.status).toBe(400);
    expect(blockedRes.data.code).toBe('VALIDATION_ERROR');

    // 验证主站商品走主站余额收款通道可正常成交，自动履约平台卡密并向站长发放差价分润（售价 ¥112 - 拿货底价 ¥70 = ¥42）
    await ctx.db.update(users).set({ balance: 200 }).where(eq(users.id, buyer2.data.user.id));
    await ctx.db.update(users).set({ balance: 20 }).where(eq(users.id, agentUserId));

    const orderRes = await ctx.jsonRequest<{
      order: { order_no: string; status: string; delivered_payload: string; total_amount: number };
    }>(`${origin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer2.data.token}` },
      body: JSON.stringify({
        product_id: platformProductId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer2@example.com',
        payment_method: 'balance',
      }),
    });
    expect(orderRes.status).toBe(200);
    expect(orderRes.data.order.status).toBe('delivered');
    expect(orderRes.data.order.delivered_payload).toBe('PLAT-CLOUD-001');

    // 站长余额精准增加 ¥42 分润（¥20 + ¥42 = ¥62），买家余额精准扣 ¥112 剩 ¥88
    const agentBalAfter = (await ctx.db.select().from(users).where(eq(users.id, agentUserId)))[0];
    expect(agentBalAfter.balance).toBe(62);
    const buyerBalAfter = (await ctx.db.select().from(users).where(eq(users.id, buyer2.data.user.id)))[0];
    expect(buyerBalAfter.balance).toBe(88);
  });
});
