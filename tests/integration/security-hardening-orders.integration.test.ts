import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  agentTiers,
  categories,
  categoryGroups,
  commissionLedger,
  coupons,
  orders,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  upstreamOrders,
  upstreamSources,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { signEpayParams } from '../../worker/domains/payment/payment.gateway';
import {
  completePaymentIntent,
  runScheduledPaymentMaintenance,
} from '../../worker/domains/payment/payment.service';
import { finalizeOrderDeliveryWithCards } from '../../worker/domains/upstream/upstream.fulfillment.service';
import { readDeliveryPayload } from '../../worker/infra/credential-storage';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('订单并发与支付安全回归：防并发重扣 / 异步支付补偿 / 券上限 / 会员优惠防超享 / 延后分润', () => {
  let ctx: TestAppContext;
  let productId: number;
  let memberToken: string;
  let memberId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
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
        slug: 'gpt-plus',
        title: 'ChatGPT Plus',
        basePrice: 100,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'month', name: '单月版', price: 100 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await ctx.db.insert(productCards).values([
      { productId: prod.id, specId: 'month', cardContent: 'KEY-B1-001', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'KEY-B1-002', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'KEY-B1-003', status: 'available' },
    ]);

    await ctx.db.insert(paymentPlugins).values([
      {
        id: 'epay',
        name: '易支付',
        description: '支付宝/微信',
        enabled: 1,
        configJson: JSON.stringify({ key: 'batch1_epay_secret' }),
      },
    ]);

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'batch1_buyer@example.com', password: 'Password123!' }),
    });
    memberToken = reg.data.token;
    memberId = reg.data.user.id;
    await ctx.db.update(users).set({ balance: 500 }).where(eq(users.id, memberId));
  });

  afterEach(() => {
    ctx.close();
  });

  it('[S09][S43] 同店铺并发重放同一结账请求只扣款和交付一次，换邮箱须用新键', async () => {
    const payload = {
      product_id: productId,
      spec_id: 'month',
      quantity: 1,
      contact_email: 'batch1_buyer@example.com',
      payment_method: 'balance',
      idempotency_key: 'same-idem-key-001',
    };
    const reqInit = {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify(payload),
    };

    const [r1, r2] = await Promise.all([
      ctx.jsonRequest<{ order?: { order_no: string }; error?: string }>('/api/orders', reqInit),
      ctx.jsonRequest<{ order?: { order_no: string }; error?: string }>('/api/orders', reqInit),
    ]);

    const successCount = [r1, r2].filter((r) => r.status === 200).length;
    expect(successCount).toBeGreaterThanOrEqual(1);
    for (const r of [r1, r2]) {
      expect([200, 409]).toContain(r.status);
    }

    const userRow = (await ctx.db.select().from(users).where(eq(users.id, memberId)))[0];
    expect(Number(userRow.balance)).toBe(400);

    const soldCards = await ctx.db.select().from(productCards).where(eq(productCards.status, 'sold'));
    expect(soldCards.length).toBe(1);

    const changed = { ...payload, contact_email: 'another_email@example.com' };
    const conflict = await ctx.jsonRequest('/api/orders', {
      ...reqInit,
      body: JSON.stringify(changed),
    });
    expect(conflict.status).toBe(409);
    expect((await ctx.db.select().from(users).where(eq(users.id, memberId)))[0].balance).toBe(400);
    expect(await ctx.db.select().from(productCards).where(eq(productCards.status, 'sold'))).toHaveLength(1);

    const separate = await ctx.jsonRequest<{ order: { order_no: string } }>('/api/orders', {
      ...reqInit,
      body: JSON.stringify({ ...changed, idempotency_key: 'different-idem-key-002' }),
    });
    expect(separate.status).toBe(200);
    expect(separate.data.order.order_no).toMatch(/^AH/);
    expect(separate.data.order.order_no).not.toBe((r1.data.order ?? r2.data.order)?.order_no);
    expect((await ctx.db.select().from(users).where(eq(users.id, memberId)))[0].balance).toBe(300);
    expect(await ctx.db.select().from(productCards).where(eq(productCards.status, 'sold'))).toHaveLength(2);
  });

  it('2. [L2] 支付单已付但中途异常未履约时，网关重放与 Cron 补偿均能恢复交付且充值幂等防双倍入账', async () => {
    const createRes = await ctx.jsonRequest<{
      order: { order_no: string };
      payment_intent: { intent_no: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'batch1_buyer@example.com',
        payment_method: 'epay',
      }),
    });
    expect(createRes.status).toBe(200);
    const { order_no: orderNo } = createRes.data.order;
    const { intent_no: intentNo } = createRes.data.payment_intent;

    // 模拟此前网关回调把 payment_intent 改成 paid 但后续写订单突然崩溃（fulfill_status = 'failed'）
    await ctx.db
      .update(paymentIntents)
      .set({
        status: 'paid',
        fulfillStatus: 'failed',
        fulfillError: 'simulated transient D1 write failure',
        providerTradeNo: 'EPAY-RECOVERY-001',
      })
      .where(eq(paymentIntents.intentNo, intentNo));

    // 重放回调应识别 fulfill_status='failed' 并重入完成发卡，而不是静默返回 success
    const replay = await completePaymentIntent(ctx.env, {
      intentNo,
      receipt: { provider: 'epay', currency: 'CNY', tradeNo: 'EPAY-RECOVERY-001', amountMinor: 10000 },
      originUrl: 'https://test.local',
    });
    expect(replay.ok).toBe(true);

    const ord = (await ctx.db.select().from(orders).where(eq(orders.orderNo, orderNo)))[0];
    expect(ord.status).toBe('delivered');
    expect(await readDeliveryPayload(ctx.env, orderNo, ord.deliveredPayload)).toContain('KEY-B1-');
    const pi = (await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, intentNo)))[0];
    expect(pi.fulfillStatus).toBe('done');

    // 再测试 wallet_recharge 漏入账走定时维护 Cron 自动补偿，重复调度绝不双倍入账
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAYRECHFAIL001',
      bizType: 'wallet_recharge',
      bizRef: `R-${memberId}`,
      userId: memberId,
      siteAgentId: 0,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 88,
      payAmount: 88,
      providerTradeNo: 'EPAY-RECH-88',
      status: 'paid',
      fulfillStatus: 'failed',
      fulfillError: 'simulated crash before credit',
      expiresAt: '2099-01-01 00:00:00',
      paidAt: '2026-01-01 00:00:00',
    });

    const maint1 = await runScheduledPaymentMaintenance(ctx.env, 'https://test.local');
    expect(maint1.recoveredPaid).toBe(1);
    const maint2 = await runScheduledPaymentMaintenance(ctx.env, 'https://test.local');
    expect(maint2.recoveredPaid).toBe(0);

    const userAfter = (await ctx.db.select().from(users).where(eq(users.id, memberId)))[0];
    expect(Number(userAfter.balance)).toBe(588);
    const txRows = await ctx.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.refNo, 'PAYRECHFAIL001'));
    expect(txRows.length).toBe(1);

    // 订单不存在时不再静默跳过，应标记 fulfill_status = 'failed'
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAYORPHANORDER01',
      bizType: 'order',
      bizRef: 'AH-MISSING-ORDER-999',
      userId: memberId,
      siteAgentId: 0,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 50,
      payAmount: 50,
      providerTradeNo: 'EPAY-MISSING-999',
      status: 'pending',
      fulfillStatus: 'pending',
      expiresAt: '2099-01-01 00:00:00',
    });
    const orphanRes = await completePaymentIntent(ctx.env, {
      intentNo: 'PAYORPHANORDER01',
      receipt: { provider: 'epay', currency: 'CNY', tradeNo: 'EPAY-MISSING-999', amountMinor: 5000 },
      originUrl: 'https://test.local',
    });
    expect(orphanRes.ok).toBe(false);
    const orphanPi = (
      await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, 'PAYORPHANORDER01'))
    )[0];
    expect(orphanPi.fulfillStatus).toBe('failed');
  });

  it('3. [S6 & S7] 异步限量优惠券不可超发；过期已退推广金被消耗后收到迟到付款绝不发货', async () => {
    await ctx.db.insert(coupons).values({
      code: 'ONEONLY',
      name: '仅限1张券',
      discountType: 'fixed',
      discountValue: 20,
      minOrderAmount: 50,
      maxUses: 1,
      usedCount: 0,
      isActive: 1,
    });

    const createOne = () =>
      ctx.jsonRequest<{
        order: { order_no: string; total_amount: number };
        payment_intent: { intent_no: string };
      }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'month',
          quantity: 1,
          contact_email: 'batch1_buyer@example.com',
          payment_method: 'epay',
          coupon_code: 'ONEONLY',
        }),
      });

    const [o1, o2] = await Promise.all([createOne(), createOne()]);
    expect(o1.status).toBe(200);
    expect(o2.status).toBe(200);

    // A 抢先付款核销这唯一 1 张券
    const cb1 = await completePaymentIntent(ctx.env, {
      intentNo: o1.data.payment_intent.intent_no,
      receipt: {
        provider: 'epay',
        currency: 'CNY',
        tradeNo: 'EPAY-CPN-1',
        amountMinor: Math.round(o1.data.order.total_amount * 100),
      },
      originUrl: 'https://test.local',
    });
    expect(cb1.ok).toBe(true);
    const ord1 = (await ctx.db.select().from(orders).where(eq(orders.orderNo, o1.data.order.order_no)))[0];
    expect(ord1.status).toBe('delivered');

    // B 随后付款，优惠券名额已被抢光，绝不允许超发，应自动退回实付款至站内余额并标 refunded
    const cb2 = await completePaymentIntent(ctx.env, {
      intentNo: o2.data.payment_intent.intent_no,
      receipt: {
        provider: 'epay',
        currency: 'CNY',
        tradeNo: 'EPAY-CPN-2',
        amountMinor: Math.round(o2.data.order.total_amount * 100),
      },
      originUrl: 'https://test.local',
    });
    expect(cb2.ok).toBe(true);
    const ord2 = (await ctx.db.select().from(orders).where(eq(orders.orderNo, o2.data.order.order_no)))[0];
    expect(ord2.status).toBe('refunded');
    const cpn = (await ctx.db.select().from(coupons).where(eq(coupons.code, 'ONEONLY')))[0];
    expect(cpn.usedCount).toBe(1);

    // S7 校验：会员获得 30 元推广金下单立减，订单超时退回推广金并被花掉后，迟到回调应退款拦发
    await ctx.db.update(users).set({ promoBalance: 30, balance: 0 }).where(eq(users.id, memberId));
    const promoOrdRes = await ctx.jsonRequest<{
      order: { order_no: string; total_amount: number; promo_used_amount: number };
      payment_intent: { intent_no: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'batch1_buyer@example.com',
        payment_method: 'epay',
        use_promo_balance: true,
      }),
    });
    expect(promoOrdRes.status).toBe(200);
    expect(promoOrdRes.data.order.promo_used_amount).toBe(30);
    expect(promoOrdRes.data.order.total_amount).toBe(70);

    // 令支付单过期并跑维护任务退回 30 元推广金
    await ctx.db
      .update(paymentIntents)
      .set({ expiresAt: '2000-01-01 00:00:00' })
      .where(eq(paymentIntents.intentNo, promoOrdRes.data.payment_intent.intent_no));
    await ctx.db
      .update(orders)
      .set({ paymentExpiresAt: '2000-01-01 00:00:00' })
      .where(eq(orders.orderNo, promoOrdRes.data.order.order_no));
    await runScheduledPaymentMaintenance(ctx.env, 'https://test.local');

    // 模拟会员已将退回的 30 元推广金消费光
    await ctx.db.update(users).set({ promoBalance: 0 }).where(eq(users.id, memberId));

    // 此时收到迟到的易支付异步通知，应被 S7 拦截：不发货，实付 70 元退入余额
    const params: Record<string, string> = {
      out_trade_no: promoOrdRes.data.payment_intent.intent_no,
      trade_no: 'EPAY-LATE-S7',
      money: '70.00',
      trade_status: 'TRADE_SUCCESS',
    };
    params.sign = signEpayParams(params, 'batch1_epay_secret');
    const hook = await ctx.request(`/api/payments/webhook/epay?${new URLSearchParams(params)}`);
    expect(hook.status).toBe(200);

    const lateOrd = (
      await ctx.db.select().from(orders).where(eq(orders.orderNo, promoOrdRes.data.order.order_no))
    )[0];
    expect(lateOrd.status).toBe('refunded');
    expect(lateOrd.deliveredPayload).toBe('');
    const buyerNow = (await ctx.db.select().from(users).where(eq(users.id, memberId)))[0];
    expect(Number(buyerNow.balance)).toBe(70);
  });

  it('4. [S8 & L5] upstream_pending 状态不提前派发分润，上游回调首次交付时再准确补结代理佣金', async () => {
    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 's8_l1',
        name: 'S8代理',
        levelRank: 2,
        minRecharge: 0,
        discountRate: 0.7,
      })
      .returning();

    const agReg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 's8_agent@example.com', password: 'Password123!' }),
    });
    const [ag] = await ctx.db
      .insert(agents)
      .values({
        userId: agReg.data.user.id,
        tierId: tier.id,
        slug: 's8shop',
        brandName: 'S8分站',
        apiKey: 'ak_s8_test_key_001',
        status: 'active',
      })
      .returning();
    await ctx.db.update(users).set({ role: 'agent', balance: 500 }).where(eq(users.id, agReg.data.user.id));

    const [src] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: 'S8上游源',
        adapterType: 'mock_sandbox',
        baseUrl: 'https://mock.upstream.local',
        apiKeyEnc: '',
        cachedBalance: 1000,
        status: 'active',
      })
      .returning();

    // 造一笔处于 upstream_pending 的代理分站订单与上游单，验证当前无任何佣金入账
    const orderNo = 'AH-S8-UP-001';
    await ctx.db.insert(orders).values({
      orderNo,
      userId: memberId,
      agentId: ag.id,
      tenantSlug: ag.slug,
      contactEmail: 'batch1_buyer@example.com',
      productId,
      productTitle: 'ChatGPT Plus',
      specId: 'month',
      specName: '单月版',
      quantity: 1,
      unitPrice: 100,
      totalAmount: 100,
      commissionAmount: 0,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'upstream_pending',
      fulfillmentSource: 'upstream',
      upstreamSourceId: src.id,
      upstreamStatus: 'pending',
    });

    const [upRow] = await ctx.db
      .insert(upstreamOrders)
      .values({
        localOrderNo: orderNo,
        attemptNo: 1,
        idempotencyOutTradeNo: `${orderNo}-A1`,
        sourceId: src.id,
        sourceName: src.name,
        bindingId: 1,
        productId,
        specId: 'month',
        upstreamItemId: 'up_1',
        quantity: 1,
        upstreamCost: 60,
        status: 'pending',
        purpose: 'order_fulfill',
      })
      .returning();

    expect(
      (await ctx.db.select().from(commissionLedger).where(eq(commissionLedger.orderNo, orderNo))).length
    ).toBe(0);

    // 上游交付出卡（重复调用两次只应结算一次分润！）
    const d1 = await finalizeOrderDeliveryWithCards(ctx.env, {
      localOrderNo: orderNo,
      cards: ['UP-KEY-S8-999'],
      upstreamSourceId: src.id,
      upstreamOrderNo: 'UP-NO-999',
      upstreamCostTotal: 60,
      upstreamOrderRowId: upRow.id,
      originUrl: 'https://test.local',
    });
    expect(d1.ok).toBe(true);

    const d2 = await finalizeOrderDeliveryWithCards(ctx.env, {
      localOrderNo: orderNo,
      cards: ['UP-KEY-S8-999'],
      upstreamSourceId: src.id,
      upstreamOrderNo: 'UP-NO-999',
      upstreamCostTotal: 60,
      upstreamOrderRowId: upRow.id,
      originUrl: 'https://test.local',
    });
    expect(d2.ok).toBe(true);
    expect(d2.alreadyDelivered).toBe(true);

    // 卖价 100 - 7折拿货 70 = 30 元应已入账代理钱包与台账
    const ledgers = await ctx.db.select().from(commissionLedger).where(eq(commissionLedger.orderNo, orderNo));
    expect(ledgers.length).toBe(1);
    expect(Number(ledgers[0].amount)).toBe(30);

    const agUser = (await ctx.db.select().from(users).where(eq(users.id, agReg.data.user.id)))[0];
    expect(Number(agUser.balance)).toBe(530);

    const finalOrd = (await ctx.db.select().from(orders).where(eq(orders.orderNo, orderNo)))[0];
    expect(finalOrd.status).toBe('delivered');
    expect(Number(finalOrd.commissionAmount)).toBe(30);
  });
});
