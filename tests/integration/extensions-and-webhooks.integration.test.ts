import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categories, categoryGroups, orders, paymentPlugins } from '../../worker/db/schema/index';
import { computeWebhookHmacHex } from '../../worker/domains/webhooks/webhooks.service';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { generateCurrentTotpCode } from '../../worker/infra/totp';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('扩展能力：卡密预选、游客/会员价分离、多币种汇率、出站 Webhook 回填与管理员 2FA 集成测试', () => {
  let ctx: TestAppContext;
  let adminHeaders: { Authorization: string };
  let categoryId: number;
  let receivedWebhooks: Array<{
    url: string;
    event: string | null;
    timestamp: string | null;
    signature: string | null;
    body: string;
  }>;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    receivedWebhooks = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('hook.partner.example.com')) {
          const headers = new Headers(init?.headers);
          const body = String(init?.body || '');
          receivedWebhooks.push({
            url,
            event: headers.get('X-AcctHub-Event'),
            timestamp: headers.get('X-AcctHub-Timestamp'),
            signature: headers.get('X-AcctHub-Signature'),
            body,
          });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();

    const [group] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'g-extensions', name: '扩展功能大类', sortOrder: 1, isActive: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'c-extensions', name: '扩展功能分类', sortOrder: 1, isActive: 1 })
      .returning();
    categoryId = cat.id;

    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHubShop',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-extensions.example.com/send',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('1. 卡密预选公开标签防泄露 + 选号加价 + 原子锁卡 + 游客/会员价分离 + 多币种汇率', async () => {
    // 1.1 bootstrap 必须返回多币种实时折算汇率表
    const boot = await ctx.jsonRequest<{
      fx_rates: { base: string; rates: Record<string, number> };
    }>('/api/storefront/bootstrap');
    expect(boot.status).toBe(200);
    expect(boot.data.fx_rates.base).toBe('CNY');
    expect(boot.data.fx_rates.rates.USD).toBeGreaterThan(0);
    expect(boot.data.fx_rates.rates.JPY).toBeGreaterThan(1);

    // 1.2 创建支持「卡密预选 + 游客/会员价分离」的商品
    const prodRes = await ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: '靓号可选独享账号',
        base_price: 100,
        member_price: 80,
        allow_card_selection: true,
        card_select_fee: 5,
        stock_mode: 'cards',
        specs: [{ id: 'vip', name: '尊享月卡', price: 100 }],
      }),
    });
    expect(prodRes.status).toBe(200);
    const pid = prodRes.data.id;

    // 导入 2 张带公开标签与自定义选号加价的卡密（标签||加价||密文）
    const imp = await ctx.jsonRequest<{ imported: number }>(`/api/admin/products/${pid}/cards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        spec_id: 'vip',
        lines: '美区原生8888||12||SECRET-US-8888\n日本高速6666||SECRET-JP-6666',
      }),
    });
    expect(imp.status).toBe(200);
    expect(imp.data.imported).toBe(2);

    // 公开选号列表：只返 id / public_label / select_fee，严禁泄露任何卡密密文！
    const selList = await ctx.jsonRequest<{
      allow_card_selection: boolean;
      cards: Array<{ id: number; public_label: string; select_fee: number; card_content?: string }>;
    }>(`/api/storefront/products/${pid}/selectable-cards?spec_id=vip`);
    expect(selList.status).toBe(200);
    expect(selList.data.allow_card_selection).toBe(true);
    expect(selList.data.cards).toHaveLength(2);
    expect(JSON.stringify(selList.data)).not.toContain('SECRET-US-8888');
    const usCard = selList.data.cards.find((c) => c.public_label === '美区原生8888');
    const jpCard = selList.data.cards.find((c) => c.public_label === '日本高速6666');
    expect(usCard?.select_fee).toBe(12);
    expect(jpCard?.select_fee).toBe(5);

    // 1.3 登录会员选「美区原生8888」下单：会员价 ¥80 + 选号加价 ¥12 = ¥92，且精确发到 SECRET-US-8888
    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'vip-member@example.com',
        password: 'Password123!',
        display_name: 'VIP',
      }),
    });
    await ctx.jsonRequest(`/api/admin/members/${reg.data.user.id}/adjust-balance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ amount: 500, reason: '测试注资' }),
    });
    const memberHeaders = { Authorization: `Bearer ${reg.data.token}` };

    const memberOrder = await ctx.jsonRequest<{
      order: { unit_price: number; total_amount: number; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'vip',
        quantity: 1,
        contact_email: 'vip-member@example.com',
        payment_method: 'balance',
        selected_card_id: usCard?.id,
      }),
    });
    expect(memberOrder.status).toBe(200);
    expect(memberOrder.data.order.unit_price).toBe(80);
    expect(memberOrder.data.order.total_amount).toBe(92);
    expect(memberOrder.data.order.delivered_payload).toContain('SECRET-US-8888');

    // 已被买走的卡密再次指定预选必须 409 拦截
    const raceOrder = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: memberHeaders,
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'vip',
        quantity: 1,
        contact_email: 'vip-member@example.com',
        payment_method: 'balance',
        selected_card_id: usCard?.id,
      }),
    });
    expect(raceOrder.status).toBe(409);

    // 1.4 游客下单选「日本高速6666」（demo_instant 沙盒测试）：按游客价 ¥100 + 选号费 ¥5 = ¥105！
    await ctx.db
      .insert(paymentPlugins)
      .values({ id: 'demo_instant', name: 'Demo', description: 'Demo', enabled: 1, configJson: '{}' })
      .onConflictDoUpdate({ target: paymentPlugins.id, set: { enabled: 1 } });
    const guestOrder = await ctx.jsonRequest<{
      order: { unit_price: number; total_amount: number; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'vip',
        quantity: 1,
        contact_email: 'guest-buy@example.com',
        payment_method: 'demo_instant',
        selected_card_id: jpCard?.id,
      }),
    });
    expect(guestOrder.status).toBe(200);
    expect(guestOrder.data.order.unit_price).toBe(100);
    expect(guestOrder.data.order.total_amount).toBe(105);
    expect(guestOrder.data.order.delivered_payload).toContain('SECRET-JP-6666');
  });

  it('2. 业务出站 Webhook HMAC-SHA256 签名推送与外部 API 签名回调回填交付凭证', async () => {
    const whSecret = 'whsec_test_partner_999';
    const createWh = await ctx.jsonRequest<{ webhook: { id: number } }>('/api/admin/webhooks', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'PartnerProvisioning',
        url: 'https://hook.partner.example.com/events',
        secret: whSecret,
        events: ['order.created', 'order.delivered'],
        enabled: true,
        allow_fulfill_override: true,
      }),
    });
    expect(createWh.status).toBe(201);

    // 创建一个人工待发货商品，下单后应触发 order.created 出站 Webhook
    const manualProd = await ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: 'API 自动开通服务',
        base_price: 50,
        delivery_type: 'manual',
        stock_mode: 'manual_stock',
        manual_stock: 10,
        specs: [{ id: 'm1', name: '月付', price: 50 }],
      }),
    });

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'wh-buyer@example.com', password: 'Password123!', display_name: 'WH' }),
    });
    await ctx.jsonRequest(`/api/admin/members/${reg.data.user.id}/adjust-balance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ amount: 200, reason: '注资' }),
    });

    const ord = await ctx.jsonRequest<{ order: { order_no: string; status: string } }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${reg.data.token}` },
      body: JSON.stringify({
        product_id: manualProd.data.id,
        spec_id: 'm1',
        quantity: 1,
        contact_email: 'wh-buyer@example.com',
        payment_method: 'balance',
      }),
    });
    expect(ord.status).toBe(200);
    expect(receivedWebhooks).toHaveLength(1);
    const ev = receivedWebhooks[0];
    expect(ev.event).toBe('order.created');
    expect(ev.timestamp).toBeTruthy();
    const expectedSig = `sha256=${await computeWebhookHmacHex(whSecret, ev.timestamp || '', ev.body)}`;
    expect(ev.signature).toBe(expectedSig);

    // 外部开通系统凭同一密钥计算 HMAC 签名主动回调 /api/webhooks/fulfill-callback 回填开通结果
    const cbBody = JSON.stringify({
      order_no: ord.data.order.order_no,
      delivered_payload: 'API-PROVISIONED-KEY-2026-XYZ',
    });
    const cbTs = String(Math.floor(Date.now() / 1000));
    const cbSig = `sha256=${await computeWebhookHmacHex(whSecret, cbTs, cbBody)}`;

    // 伪造签名必须 401
    const badCb = await ctx.jsonRequest('/api/webhooks/fulfill-callback', {
      method: 'POST',
      headers: { 'X-AcctHub-Timestamp': cbTs, 'X-AcctHub-Signature': 'sha256=deadbeef' },
      body: cbBody,
    });
    expect(badCb.status).toBe(401);

    // 合法签名成功回填并把订单推进至 delivered
    const goodCb = await ctx.jsonRequest<{ ok: boolean; status: string }>('/api/webhooks/fulfill-callback', {
      method: 'POST',
      headers: { 'X-AcctHub-Timestamp': cbTs, 'X-AcctHub-Signature': cbSig },
      body: cbBody,
    });
    expect(goodCb.status).toBe(200);
    expect(goodCb.data.status).toBe('delivered');

    const [updatedOrder] = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, ord.data.order.order_no))
      .limit(1);
    expect(updatedOrder?.status).toBe('delivered');
  });

  it('3. 管理员 2FA（RFC 6238 TOTP）开启、拦截无码/错码登录、正确 6 位码放行与关闭', async () => {
    const setupRes = await ctx.jsonRequest<{ secret: string; otpauth_url: string }>('/api/admin/2fa/setup', {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(setupRes.status).toBe(200);
    expect(setupRes.data.otpauth_url).toContain('otpauth://totp/');

    const validCode = await generateCurrentTotpCode(setupRes.data.secret);

    // 错码无法启用
    const badEnable = await ctx.jsonRequest('/api/admin/2fa/enable', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ secret: setupRes.data.secret, code: '000000' }),
    });
    expect(badEnable.status).toBe(400);

    // 正确 6 位动态码正式启用管理员 2FA
    const okEnable = await ctx.jsonRequest<{ enabled: boolean }>('/api/admin/2fa/enable', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ secret: setupRes.data.secret, code: validCode }),
    });
    expect(okEnable.status).toBe(200);
    expect(okEnable.data.enabled).toBe(true);

    const adminEmail = 'test-operator@example.test';
    const adminPassword = 'FixtureAdminPassword123!';

    // 管理员不传 totp_code 登录必须返回 401 且 code = TOTP_REQUIRED
    const loginNoCode = await ctx.jsonRequest<{ code?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(loginNoCode.status).toBe(401);
    expect(loginNoCode.data.code).toBe('TOTP_REQUIRED');

    // 传错误 totp_code 登录被拒
    const loginBadCode = await ctx.jsonRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword, totp_code: '999999' }),
    });
    expect(loginBadCode.status).toBe(401);

    // 传正确 6 位 TOTP 动态码登录成功！
    const loginOk = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword, totp_code: validCode }),
    });
    expect(loginOk.status).toBe(200);
    expect(loginOk.data.token).toBeTruthy();

    // 验证关闭 2FA 后恢复普通邮箱密码登录
    const dis = await ctx.jsonRequest<{ enabled: boolean }>('/api/admin/2fa/disable', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginOk.data.token}` },
      body: JSON.stringify({ code: validCode }),
    });
    expect(dis.status).toBe(200);
    expect(dis.data.enabled).toBe(false);

    const loginAfterDisable = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    expect(loginAfterDisable.status).toBe(200);
  });
});
