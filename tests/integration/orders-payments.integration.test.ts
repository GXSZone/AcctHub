import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  categoryGroups,
  coupons,
  orders,
  paymentPlugins,
  productCards,
  products,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { signEpayParams } from '../../worker/domains/payment/payment.gateway';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

async function enableGuestMailDelivery(env: TestAppContext['env']) {
  await saveSiteMailConfig(env, 0, {
    enabled: true,
    auto_send_order: true,
    provider: 'custom_webhook',
    from_name: 'AcctHub Test',
    from_email: 'noreply@example.com',
    api_endpoint: 'https://mail-relay.example.com/send',
  });
}

describe('B3 垂直领域集成测试：Orders / Payments / Fulfillment（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let productId: number;
  let memberToken: string;
  let memberId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('mail-relay.example.com')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        throw new Error(`测试中禁止未 mock 的外部 fetch: ${url}`);
      })
    );
    ctx = createTestApp();

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
        categoryId: cat.id,
        slug: 'gpt-plus-1m',
        title: 'ChatGPT Plus 月卡',
        basePrice: 100,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'month', name: '单月独享', price: 100 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await ctx.db.insert(productCards).values([
      { productId: prod.id, specId: 'month', cardContent: 'GPT-CARD-001', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'GPT-CARD-002', status: 'available' },
    ]);

    await ctx.db.insert(paymentPlugins).values([
      {
        id: 'epay',
        name: '易支付',
        description: '支付宝/微信',
        enabled: 1,
        configJson: JSON.stringify({ key: 'epay_test_secret_key_123' }),
      },
      { id: 'demo_instant', name: '演示收银台', description: '开发测试', enabled: 1 },
    ]);

    await ctx.db.insert(coupons).values({
      code: 'ONCE30',
      name: '限量立减30',
      discountType: 'fixed',
      discountValue: 30,
      minOrderAmount: 50,
      maxUses: 1,
      usedCount: 0,
      isActive: 1,
    });

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'buyer@example.com', password: 'Password123!' }),
    });
    memberToken = reg.data.token;
    memberId = reg.data.user.id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('[S09][S43] 余额下单按原用户和原请求重放，变更请求不能重复扣款', async () => {
    // 初始余额 ¥50，商品原价 ¥100 - 券 ¥30 = ¥70 -> 余额不足 402，且限量券使用次数必须回滚为 0
    const failOrder = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer@example.com',
        payment_method: 'balance',
        coupon_code: 'ONCE30',
      }),
    });
    expect(failOrder.status).toBe(402);

    const cpnAfterFail = (await ctx.db.select().from(coupons).where(eq(coupons.code, 'ONCE30')))[0];
    expect(cpnAfterFail.usedCount).toBe(0);

    // 沙盒加款 ¥100（余额变 ¥150），再使用限量券 + 幂等键下单
    await ctx.jsonRequest('/api/auth/topup-demo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({ amount: 100 }),
    });

    const okOrder = await ctx.jsonRequest<{
      order: { order_no: string; total_amount: number; status: string; delivered_payload: string };
      balance: number;
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer@example.com',
        payment_method: 'balance',
        coupon_code: 'ONCE30',
        idempotency_key: 'idem-order-001',
      }),
    });
    expect(okOrder.status).toBe(200);
    expect(okOrder.data.order.total_amount).toBe(70);
    expect(okOrder.data.order.status).toBe('delivered');
    expect(okOrder.data.order.delivered_payload).toBe('GPT-CARD-001');
    expect(okOrder.data.balance).toBe(80);

    // 幂等重放不重复扣款也不重复出卡
    const replay = await ctx.jsonRequest<{ idempotent_replay: boolean; order: { order_no: string } }>(
      '/api/orders',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'month',
          quantity: 1,
          contact_email: 'buyer@example.com',
          payment_method: 'balance',
          coupon_code: 'ONCE30',
          idempotency_key: 'idem-order-001',
        }),
      }
    );
    expect(replay.status).toBe(200);
    expect(replay.data.idempotent_replay).toBe(true);
    expect(replay.data.order.order_no).toBe(okOrder.data.order.order_no);

    const changed = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        contact_email: 'changed@example.com',
        payment_method: 'balance',
        idempotency_key: 'idem-order-001',
      }),
    });
    expect(changed.status).toBe(409);

    // 校验账本记录
    const txs = await ctx.db.select().from(walletTransactions).where(eq(walletTransactions.userId, memberId));
    expect(txs.some((t) => t.type === 'order_pay' && t.amount === -70)).toBe(true);
  });

  it('2. 异步易支付 MD5 真签名回调放货、重复回调幂等锁、以及并发付款后缺货自动退余额补偿', async () => {
    // 2.1 创建第 1 笔易支付异步订单（不提前扣库）
    const create1 = await ctx.jsonRequest<{
      requires_payment: boolean;
      order: { order_no: string; status: string };
      payment_intent: { intent_no: string; pay_amount: number; view_token?: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 2,
        contact_email: 'buyer@example.com',
        payment_method: 'epay',
      }),
    });
    expect(create1.status).toBe(200);
    expect(create1.data.requires_payment).toBe(true);
    expect(create1.data.order.status).toBe('pending_payment');

    // 创建第 2 笔易支付订单（模拟极端并发：第 1 笔尚未付款，两笔同时通过库存预检）
    const create2 = await ctx.jsonRequest<{
      order: { order_no: string };
      payment_intent: { intent_no: string; pay_amount: number };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'buyer@example.com',
        payment_method: 'epay',
      }),
    });
    expect(create2.status).toBe(200);

    // 2.2 伪造错误签名易支付回调被拒绝 400
    const badCb = await ctx.request(
      `/api/payments/webhook/epay?out_trade_no=${create1.data.payment_intent.intent_no}&trade_no=EP1&money=200&trade_status=TRADE_SUCCESS&sign=deadbeef`
    );
    expect(badCb.status).toBe(400);

    // 2.3 使用真实 MD5 签名触发第 1 笔回调 -> 抢光全部 2 张卡密并成功交付
    const params1: Record<string, string> = {
      out_trade_no: create1.data.payment_intent.intent_no,
      trade_no: 'EP-REAL-001',
      money: '200.00',
      trade_status: 'TRADE_SUCCESS',
    };
    params1.sign = signEpayParams(params1, 'epay_test_secret_key_123');
    const qs1 = new URLSearchParams(params1).toString();
    const okCb1 = await ctx.request(`/api/payments/webhook/epay?${qs1}`);
    expect(okCb1.status).toBe(200);
    expect(await okCb1.text()).toBe('success');

    // 重复回调第 1 笔必须幂等返回 success
    const dupCb1 = await ctx.request(`/api/payments/webhook/epay?${qs1}`);
    expect(dupCb1.status).toBe(200);

    // 匿名凭 intentNo 轮询必须遮罩卡密且不暴露他人余额（S1）
    const pollAnon = await ctx.jsonRequest<{
      intent: { status: string; view_token?: string };
      order: { status: string; locked: boolean; delivered_payload: string };
      balance?: number;
    }>(`/api/payments/intents/${create1.data.payment_intent.intent_no}`);
    expect(pollAnon.data.intent.status).toBe('paid');
    expect(pollAnon.data.intent.view_token).toBeUndefined();
    expect(pollAnon.data.order).toEqual({ locked: true });
    expect(pollAnon.data.balance).toBeUndefined();

    // 会员支付单具备归属约束，由原会员会话读取交付结果。
    const poll1 = await ctx.jsonRequest<{
      intent: { status: string };
      order: { status: string; locked: boolean; delivered_payload: string };
    }>(`/api/payments/intents/${create1.data.payment_intent.intent_no}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(poll1.data.intent.status).toBe('paid');
    expect(poll1.data.order.status).toBe('delivered');
    expect(poll1.data.order.locked).toBe(false);
    expect(poll1.data.order.delivered_payload).toContain('GPT-CARD-001');
    expect(poll1.data.order.delivered_payload).toContain('GPT-CARD-002');

    // 2.4 触发第 2 笔回调（此时 2 张卡密已被第 1 笔领空）-> 自动全额退回 ¥100 至会员余额并标记 refunded
    const sim2 = await ctx.jsonRequest('/api/payments/sandbox/simulate-pay', {
      method: 'POST',
      body: JSON.stringify({ intent_no: create2.data.payment_intent.intent_no }),
    });
    expect(sim2.status).toBe(200);

    const ord2 = (
      await ctx.db.select().from(orders).where(eq(orders.orderNo, create2.data.order.order_no))
    )[0];
    expect(ord2.status).toBe('refunded');

    const userAfter = (await ctx.db.select().from(users).where(eq(users.id, memberId)))[0];
    expect(userAfter.balance).toBe(150); // 初始 50 + 自动退款 100
  });

  it('[S10][S21][S27] 游客凭独立查单号与口令查询，未授权响应不含个人数据', async () => {
    await enableGuestMailDelivery(ctx.env);
    const guestOrder = await ctx.jsonRequest<{ order: { order_no: string; public_order_no: string } }>(
      '/api/orders',
      {
        method: 'POST',
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'month',
          quantity: 1,
          contact_email: 'guest@example.com',
          query_password: 'secret-pin',
          custom_inputs: { note: 'PRIVATE-NOTE' },
          payment_method: 'demo_instant',
        }),
      }
    );
    expect(guestOrder.status).toBe(200);
    const { order_no: orderNo, public_order_no: publicNo } = guestOrder.data.order;
    expect(publicNo).toMatch(/^AHQ-[0-9a-f]{32}$/);
    expect(orderNo).toBe(publicNo);
    const stored = (await ctx.db.select().from(orders).where(eq(orders.publicOrderNo, publicNo)))[0];
    expect(stored.queryPasswordHash).toMatch(/^pbkdf2\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('secret-pin');
    const oldRoute = await ctx.request('/api/orders/lookup');
    expect(oldRoute.status).toBe(404);

    const lookup = (q: string, password?: string) =>
      ctx.jsonRequest<{ orders: Array<{ locked: boolean; delivered_payload: string }> }>(
        '/api/orders/lookup',
        { method: 'POST', body: JSON.stringify({ q, password }) }
      );
    expect((await lookup(stored.orderNo)).data.orders).toEqual([]);
    expect((await lookup('guest@example.com')).data.orders).toEqual([]);
    const lockedRes = await lookup(publicNo);
    expect(lockedRes.data.orders).toEqual([{ locked: true }]);
    expect(lockedRes.headers.get('Cache-Control')).toBe('no-store');

    const unlockedRes = await lookup(publicNo, 'secret-pin');
    expect(unlockedRes.data.orders[0].locked).toBe(false);
    expect(unlockedRes.data.orders[0].delivered_payload).toContain('GPT-CARD-001');
  });

  it('[S44] 库存与订单副本加密落库并按原订单授权读取', async () => {
    await enableGuestMailDelivery(ctx.env);
    const fixture = 'fixture-delivery-credential';
    const adminHeaders = await ctx.adminHeaders();
    await ctx.db.delete(productCards).where(eq(productCards.productId, productId));
    const imported = await ctx.jsonRequest<{ imported: number }>(`/api/admin/products/${productId}/cards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ spec_id: 'month', lines: fixture }),
    });
    expect(imported.data.imported).toBe(1);
    const [card] = await ctx.db.select().from(productCards).where(eq(productCards.productId, productId));
    expect(card.cardContent).toMatch(/^v3\./);
    expect(card.cardContent).not.toContain(fixture);

    const ordered = await ctx.jsonRequest<{ order: { public_order_no: string; delivered_payload: string } }>(
      '/api/orders',
      {
        method: 'POST',
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'month',
          quantity: 1,
          contact_email: 'buyer@example.test',
          query_password: 'test-passphrase',
          payment_method: 'demo_instant',
        }),
      }
    );
    expect(ordered.ok).toBe(true);
    expect(ordered.data.order.delivered_payload).toBe(fixture);
    const publicNo = ordered.data.order.public_order_no;
    const [stored] = await ctx.db.select().from(orders).where(eq(orders.publicOrderNo, publicNo));
    expect(stored.deliveredPayload).toMatch(/^v3\./);
    expect(stored.deliveredPayload).not.toContain(fixture);
    const lookup = await ctx.jsonRequest<{ orders: Array<{ delivered_payload: string }> }>(
      '/api/orders/lookup',
      {
        method: 'POST',
        body: JSON.stringify({ q: publicNo, password: 'test-passphrase' }),
      }
    );
    expect(lookup.data.orders[0].delivered_payload).toBe(fixture);
  });

  it('[S09][B07][S43] 游客恢复原收银台须同时提供独立会话凭据和相同请求', async () => {
    await enableGuestMailDelivery(ctx.env);
    const payload = {
      product_id: productId,
      spec_id: 'month',
      contact_email: 'buyer@example.com',
      payment_method: 'epay',
      idempotency_key: 'checkout-recovery-test',
      checkout_secret: 'ab'.repeat(32),
    };
    const create = (body: object) =>
      ctx.jsonRequest<{
        idempotent_replay?: boolean;
        requires_payment?: boolean;
        order?: { order_no: string };
        payment_intent?: { intent_no: string; view_token: string };
      }>('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    const original = await create(payload);
    expect(original.status).toBe(200);

    const wrong = await create({ ...payload, checkout_secret: 'cd'.repeat(32) });
    expect(wrong.status).toBe(409);
    expect(wrong.data.order).toBeUndefined();
    expect(wrong.data.payment_intent).toBeUndefined();

    const changed = await create({ ...payload, quantity: 2 });
    expect(changed.status).toBe(409);
    const replay = await create(payload);
    expect(replay.data.idempotent_replay).toBe(true);
    expect(replay.data.requires_payment).toBe(true);
    expect(replay.data.order?.order_no).toBe(original.data.order?.order_no);
    expect(replay.data.payment_intent).toEqual(original.data.payment_intent);
    const recover = (checkout_secret: string) =>
      ctx.jsonRequest<typeof replay.data & { found: boolean }>('/api/orders/recover', {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: payload.idempotency_key, checkout_secret }),
      });
    expect((await recover('00'.repeat(32))).data).toEqual({ found: false });
    const recovered = await recover(payload.checkout_secret);
    expect(recovered.data.found).toBe(true);
    expect(recovered.data.payment_intent).toEqual(original.data.payment_intent);

    const intent = recovered.data.payment_intent;
    if (!intent) throw new Error('测试订单未返回可恢复的收银台');
    const path = `/api/payments/intents/${intent.intent_no}`;
    const anonymous = await ctx.jsonRequest(path);
    expect(anonymous.data).toEqual({
      locked: true,
      intent: { intent_no: intent.intent_no, status: 'pending' },
      order: null,
    });
    const deniedCheck = await ctx.jsonRequest(`${path}/check`, { method: 'POST' });
    expect(deniedCheck.status).toBe(404);
    const cashierHeaders = { 'X-Intent-Token': intent.view_token };
    const authorized = await ctx.jsonRequest(path, { headers: cashierHeaders });
    expect(authorized.data.intent).toMatchObject({
      biz_ref: original.data.order?.order_no,
      status: 'pending',
    });
    expect(authorized.data.intent).not.toHaveProperty('view_token');
    const verified = await ctx.jsonRequest(`${path}/check`, { method: 'POST', headers: cashierHeaders });
    expect(verified.data).toMatchObject({ ok: true, status: 'pending' });
  });

  it('[S43] 同一结账会话的并发提交只产生一笔订单和一个支付意图', async () => {
    await enableGuestMailDelivery(ctx.env);
    const body = JSON.stringify({
      product_id: productId,
      contact_email: 'concurrent@example.com',
      payment_method: 'epay',
      idempotency_key: 'same-checkout-key',
      checkout_secret: 'ac'.repeat(32),
    });
    const submit = () =>
      ctx.jsonRequest<{ order?: { order_no: string } }>('/api/orders', { method: 'POST', body });
    const pair = await Promise.all([submit(), submit()]);
    expect(pair.some((response) => response.ok)).toBe(true);
    const created = await ctx.db.select().from(orders).where(eq(orders.idempotencyKey, 'same-checkout-key'));
    expect(created).toHaveLength(1);
    expect(created[0].paymentIntentNo).toBeTruthy();
    expect(new Set(pair.flatMap((response) => response.data.order?.order_no ?? []))).toEqual(
      new Set([created[0].publicOrderNo])
    );
  });

  it('[B50] 已登录会员可用稳定游标读取本站早期订单', async () => {
    await ctx.db.insert(orders).values(
      Array.from({ length: 53 }, (_, i) => ({
        orderNo: `HISTORY-${i}`,
        userId: memberId,
        contactEmail: 'buyer@example.com',
        productId,
        productTitle: '测试商品',
        unitPrice: 100,
        totalAmount: 100,
        status: 'paid',
      }))
    );
    const headers = { Authorization: `Bearer ${memberToken}` };
    type Page = { orders: Array<{ order_no: string }>; next_cursor: number | null };
    const first = await ctx.jsonRequest<Page>('/api/orders/lookup', { method: 'POST', headers, body: '{}' });
    expect(first.data.orders).toHaveLength(50);
    expect(first.data.next_cursor).toBeTypeOf('number');
    const second = await ctx.jsonRequest<Page>(`/api/account/orders?cursor=${first.data.next_cursor}`, {
      headers,
    });
    expect(second.data.orders.map((order) => order.order_no)).toEqual([
      'HISTORY-2',
      'HISTORY-1',
      'HISTORY-0',
    ]);
    expect(second.data.next_cursor).toBeNull();
  });

  it('[B30] 游客查单验证失败后可使用新挑战重试', async () => {
    await enableGuestMailDelivery(ctx.env);
    type Result = { order: { public_order_no: string } };
    const created = await ctx.jsonRequest<Result>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        contact_email: 'challenge-buyer@example.com',
        payment_method: 'demo_instant',
      }),
    });
    expect(created.status).toBe(200);
    const q = created.data.order.public_order_no;
    ctx.env.TURNSTILE_SECRET = 'integration-test-secret';
    const verify = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ success: false }))
      .mockResolvedValueOnce(Response.json({ success: true, action: 'order_lookup' }));
    verify.mockClear();
    try {
      const lookup = (turnstile_token: string) =>
        ctx.jsonRequest<{ orders: unknown[] }>('/api/orders/lookup', {
          method: 'POST',
          body: JSON.stringify({ q, turnstile_token }),
        });
      expect((await lookup('first-invalid-challenge')).status).toBe(403);
      const retried = await lookup('fresh-challenge');
      expect(retried.status).toBe(200);
      expect(retried.data.orders).toHaveLength(1);
      expect(verify).toHaveBeenCalledTimes(2);
    } finally {
      verify.mockRestore();
    }
  });

  it('未开启邮箱时禁止游客下单而放行已登录会员并返回 disabled，开启邮箱后同步发信返 sent', async () => {
    type MailOrderResult = {
      order: {
        order_no: string;
        public_order_no: string;
        status: string;
        mail_delivery?: { status: string; reason?: string };
      };
    };

    // 1) 未启用站内发信配置时，游客直接下单应被拦截要求先登录
    const blockedGuestRes = await ctx.jsonRequest<{ error?: string }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        contact_email: 'guest-blocked@example.com',
        payment_method: 'demo_instant',
      }),
    });
    expect(blockedGuestRes.status).toBe(401);

    // 2) 已登录会员在未开启发信时可正常下单，返回 mail_delivery.status = disabled
    const noMailRes = await ctx.jsonRequest<MailOrderResult>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        contact_email: 'nomail@example.com',
        payment_method: 'demo_instant',
      }),
    });
    expect(noMailRes.status).toBe(200);
    expect(noMailRes.data.order.status).toBe('delivered');
    expect(noMailRes.data.order.mail_delivery).toEqual({
      status: 'disabled',
      reason: 'not_configured',
    });

    // 3) 开启并配置 Custom Webhook 发信通道后，游客亦可下单并立刻触发真实发信投递
    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHub 商店',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-relay.example.com/send',
    });

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    try {
      const sentRes = await ctx.jsonRequest<MailOrderResult>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          product_id: productId,
          contact_email: 'delivered-mail@example.com',
          payment_method: 'demo_instant',
        }),
      });
      expect(sentRes.status).toBe(200);
      expect(sentRes.data.order.status).toBe('delivered');
      expect(sentRes.data.order.mail_delivery).toEqual({ status: 'sent' });
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
