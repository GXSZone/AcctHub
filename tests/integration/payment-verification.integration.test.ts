import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coupons,
  orders,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  upstreamOrders,
} from '../../worker/db/schema/index';
import { postPaidOrderStock } from '../../worker/domains/fulfillment/fulfillment.repo';
import {
  claimCouponUsageByCodeAtomic,
  rollbackPaymentCouponUsage,
} from '../../worker/domains/payment/payment.fulfill.repo';
import { recoverSinglePaidIntent } from '../../worker/domains/payment/payment.recovery';
import {
  claimPaidIntentForFulfillRetryAtomic,
  findPaymentIntentByNo,
  markIntentFulfillDoneRepo,
  markIntentFulfillFailedRepo,
  paymentFulfillLeaseGuard,
} from '../../worker/domains/payment/payment.repo';
import { runScheduledPaymentMaintenance } from '../../worker/domains/payment/payment.status.service';
import { fetchRecentUsdtChainTransfers } from '../../worker/domains/payment/payment.usdt';
import { updateUpstreamOrderRepo } from '../../worker/domains/upstream/upstream.orders.repo';
import { runScheduledUpstreamOrderPoll } from '../../worker/domains/upstream/upstream.poll.service';
import { readDeliveryPayload } from '../../worker/infra/credential-storage';
import { hmacSha256Hex } from '../../worker/infra/crypto';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('支付凭据与补偿租约', () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('[S07] 链上流水保留原始最小单位，不丢失第五、六位小数', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({
        success: true,
        data: [
          {
            transaction_id: 'fixture-transfer',
            value: '13790121',
            block_timestamp: Date.now(),
            to: 'fixture-recipient',
            type: 'Transfer',
            token_info: { decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
          },
        ],
      })
    );
    const transfers = await fetchRecentUsdtChainTransfers(
      'usdt_trc20',
      { wallet_address: 'fixture-recipient' },
      Date.now() - 60_000
    );
    expect(transfers).toMatchObject([{ transactionId: 'fixture-transfer', amountAtomic: 13790121n }]);
  });

  it('[S07] 同一收款地址的相邻金额只核销精确匹配的支付单', async () => {
    const wallet = 'fixture-recipient';
    const conf = JSON.stringify({ wallet_address: wallet });
    await ctx.db
      .insert(paymentPlugins)
      .values({ id: 'usdt_trc20', name: 'USDT', description: '测试收款', enabled: 1, configJson: conf })
      .onConflictDoUpdate({ target: paymentPlugins.id, set: { enabled: 1, configJson: conf } });
    await ctx.db.run(
      sql`INSERT INTO users (id, email, display_name, password_hash) VALUES (101, 'fixture-usdt@example.test', 'Fixture', 'fixture')`
    );
    for (const [intentNo, payAmount] of [
      ['PAY-USDT-01', 13.7901],
      ['PAY-USDT-02', 13.7902],
    ] as const) {
      await ctx.db.insert(paymentIntents).values({
        intentNo,
        provider: 'usdt_trc20',
        currency: 'USDT',
        qrContent: wallet,
        bizType: 'wallet_recharge',
        bizRef: intentNo,
        userId: 101,
        amountCny: 100,
        payAmount,
        expiresAt: sql`datetime('now', '+20 minutes')`,
      });
    }
    const mockReceipt = (value: string) =>
      vi.stubGlobal('fetch', async () =>
        Response.json({
          success: true,
          data: [
            {
              transaction_id: 'fixture-transfer',
              value,
              block_timestamp: Date.now(),
              to: wallet,
              type: 'Transfer',
              token_info: { decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
            },
          ],
        })
      );
    mockReceipt('13790201');
    expect((await runScheduledPaymentMaintenance(ctx.env)).matchedUsdt).toBe(0);
    mockReceipt('13790200');
    expect((await runScheduledPaymentMaintenance(ctx.env)).matchedUsdt).toBe(1);
    expect((await findPaymentIntentByNo(ctx.db, 'PAY-USDT-01'))?.status).toBe('pending');
    expect((await findPaymentIntentByNo(ctx.db, 'PAY-USDT-02'))?.fulfill_status).toBe('done');
  });

  it('[S08] 旧付款领取后并发领取仅有一个持有者，过期持有者无法写终态', async () => {
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAY-LEASE-FIXTURE',
      provider: 'stripe',
      bizRef: 'ORDER-FIXTURE',
      amountCny: 100,
      payAmount: 100,
      status: 'paid',
      fulfillStatus: 'processing',
      paidAt: sql`datetime('now', '-4 minutes')`,
      expiresAt: sql`datetime('now', '+20 minutes')`,
    });
    const claims = await Promise.all([
      claimPaidIntentForFulfillRetryAtomic(ctx.db, 'PAY-LEASE-FIXTURE'),
      claimPaidIntentForFulfillRetryAtomic(ctx.db, 'PAY-LEASE-FIXTURE'),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean);
    if (!first) throw new Error('租约领取失败');
    await ctx.db.run(sql`UPDATE payment_intents SET fulfill_lease_until = datetime('now', '-1 second')`);
    const current = await claimPaidIntentForFulfillRetryAtomic(ctx.db, first.intent_no);
    expect(current).not.toBeNull();
    expect(await markIntentFulfillDoneRepo(ctx.db, first.intent_no, first.fulfill_lease_token)).toBe(false);
    if (!current) throw new Error('到期租约未被接管');
    expect(await markIntentFulfillDoneRepo(ctx.db, first.intent_no, current.fulfill_lease_token)).toBe(true);
    expect(
      await markIntentFulfillFailedRepo(ctx.db, first.intent_no, first.fulfill_lease_token, '旧任务失败')
    ).toBe(false);
    expect((await findPaymentIntentByNo(ctx.db, first.intent_no))?.fulfill_status).toBe('done');
  });

  it('[S08] 接管履约沿用已核销优惠券与已领取卡密', async () => {
    const orderNo = 'ORDER-PARTIAL-CARD';
    const intentNo = 'PAY-PARTIAL-CARD';
    const [product] = await ctx.db
      .insert(products)
      .values({
        categoryId: 1,
        slug: 'fixture-stock',
        title: '测试库存',
        basePrice: 10,
      })
      .returning();
    await ctx.db.insert(orders).values({
      orderNo,
      status: 'processing',
      contactEmail: 'fixture@example.test',
      productId: product.id,
      productTitle: product.title,
      quantity: 2,
      unitPrice: 10,
      totalAmount: 19,
      couponCode: 'FIXTURE-ONCE',
      paymentIntentNo: intentNo,
    });
    await ctx.db.insert(coupons).values({ code: 'FIXTURE-ONCE', name: '测试券', maxUses: 1 });
    await ctx.db.insert(productCards).values([
      { productId: product.id, specId: 'default', cardContent: 'fixture-first', status: 'sold', orderNo },
      { productId: product.id, specId: 'default', cardContent: 'fixture-second', status: 'available' },
    ]);
    await ctx.db.insert(paymentIntents).values({
      intentNo,
      provider: 'stripe',
      bizRef: orderNo,
      amountCny: 19,
      payAmount: 19,
      status: 'paid',
      fulfillStatus: 'failed',
      expiresAt: sql`datetime('now', '+20 minutes')`,
    });
    const first = await claimPaidIntentForFulfillRetryAtomic(ctx.db, intentNo);
    if (!first?.fulfill_lease_token) throw new Error('租约领取失败');
    const oldLease = { intentNo, token: first.fulfill_lease_token };
    expect(await claimCouponUsageByCodeAtomic(ctx.db, 'FIXTURE-ONCE', oldLease)).toBe(true);
    await ctx.db
      .update(paymentIntents)
      .set({ fulfillLeaseUntil: sql`datetime('now', '-1 second')` })
      .where(eq(paymentIntents.intentNo, intentNo));
    await rollbackPaymentCouponUsage(ctx.db, oldLease);

    expect(await recoverSinglePaidIntent(ctx.env, intentNo, 'https://test.local')).toBe(true);
    const row = await ctx.db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
    expect(row?.status).toBe('delivered');
    expect(await readDeliveryPayload(ctx.env, orderNo, row?.deliveredPayload ?? '')).toBe(
      'fixture-first\nfixture-second'
    );
    expect(
      (await ctx.db.select().from(coupons).where(eq(coupons.code, 'FIXTURE-ONCE')).get())?.usedCount
    ).toBe(1);
    expect((await findPaymentIntentByNo(ctx.db, intentNo))?.fulfill_status).toBe('done');
  });

  it.each(['manual', 'seats'] as const)('[S08] 接管履约沿用已扣库存 %s', async (stockMode) => {
    const orderNo = `ORDER-STOCK-${stockMode}`;
    const intentNo = `PAY-STOCK-${stockMode}`;
    const [product] = await ctx.db
      .insert(products)
      .values({
        categoryId: 1,
        slug: `fixture-${stockMode}`,
        title: '测试库存',
        basePrice: 10,
        stockMode,
        manualStock: 2,
        seatTotal: 2,
      })
      .returning();
    await ctx.db.insert(orders).values({
      orderNo,
      status: 'processing',
      contactEmail: 'fixture@example.test',
      productId: product.id,
      productTitle: product.title,
      quantity: 2,
      unitPrice: 10,
      totalAmount: 20,
      paymentIntentNo: intentNo,
    });
    await ctx.db.insert(paymentIntents).values({
      intentNo,
      provider: 'stripe',
      bizRef: orderNo,
      amountCny: 20,
      payAmount: 20,
      status: 'paid',
      fulfillStatus: 'failed',
      expiresAt: sql`datetime('now', '+20 minutes')`,
    });
    const first = await claimPaidIntentForFulfillRetryAtomic(ctx.db, intentNo);
    if (!first?.fulfill_lease_token) throw new Error('租约领取失败');
    const guard = paymentFulfillLeaseGuard({ intentNo, token: first.fulfill_lease_token });
    if (!guard) throw new Error('租约条件未创建');
    expect(
      await postPaidOrderStock(ctx.db, {
        intentNo,
        guard,
        productId: product.id,
        quantity: 2,
        mode: stockMode,
      })
    ).toBe(stockMode === 'seats' ? 2 : 1);
    await ctx.db
      .update(paymentIntents)
      .set({ fulfillLeaseUntil: sql`datetime('now', '-1 second')` })
      .where(eq(paymentIntents.intentNo, intentNo));

    expect(await recoverSinglePaidIntent(ctx.env, intentNo, 'https://test.local')).toBe(true);
    const updated = await ctx.db.select().from(products).where(eq(products.id, product.id)).get();
    expect(updated).toMatchObject({
      salesCount: 2,
      manualStock: stockMode === 'manual' ? 0 : 2,
      seatUsed: stockMode === 'seats' ? 2 : 0,
    });
    const row = await ctx.db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
    const delivered = await readDeliveryPayload(ctx.env, orderNo, row?.deliveredPayload ?? '');
    expect(row?.status).toBe('delivered');
    if (stockMode === 'seats') {
      expect(delivered).toContain('专属席位 #1');
      expect(delivered).toContain('专属席位 #2');
    } else {
      expect(delivered).toContain(orderNo);
    }
  });

  it.each(['succeeded', 'failed'] as const)('[S08] 接管后沿用原采购单处理迟到结果 %s', async (result) => {
    const orderNo = 'ORDER-LATE-SUPPLIER';
    const [product] = await ctx.db
      .insert(products)
      .values({
        categoryId: 1,
        slug: 'fixture-late-supplier',
        title: '测试采购',
        basePrice: 10,
      })
      .returning();
    await ctx.db.insert(orders).values({
      orderNo,
      status: 'upstream_pending',
      upstreamStatus: 'pending',
      contactEmail: 'fixture@example.test',
      productId: product.id,
      productTitle: product.title,
      quantity: 1,
      unitPrice: 10,
      totalAmount: 10,
    });
    const [purchase] = await ctx.db
      .insert(upstreamOrders)
      .values({
        localOrderNo: orderNo,
        idempotencyOutTradeNo: `${orderNo}-A1`,
        sourceId: 1,
        purpose: 'order_fulfill',
        status: 'pending',
      })
      .returning();
    await updateUpstreamOrderRepo(ctx.env, purchase.id, {
      status: result,
      ...(result === 'succeeded'
        ? { upstreamOrderNo: 'UP-FIXTURE', upstreamCost: 5, cardsJson: '["fixture-late-card"]' }
        : { errorMessage: '供应商明确拒绝采购' }),
    });
    await runScheduledUpstreamOrderPoll(ctx.env);
    await runScheduledUpstreamOrderPoll(ctx.env);
    const row = await ctx.db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
    if (result === 'succeeded') {
      expect(row).toMatchObject({ status: 'delivered', upstreamOrderNo: 'UP-FIXTURE', upstreamCostTotal: 5 });
      expect(await readDeliveryPayload(ctx.env, orderNo, row?.deliveredPayload ?? '')).toBe(
        'fixture-late-card'
      );
    } else {
      expect(row).toMatchObject({ status: 'fulfillment_failed', upstreamError: '供应商明确拒绝采购' });
    }
    expect(await ctx.db.select().from(upstreamOrders)).toHaveLength(1);
  });

  it('[S16] Stripe 只接受与本地会话、币种和金额一致的完整收据', async () => {
    await ctx.db.run(
      sql`INSERT INTO users (id, email, display_name, password_hash) VALUES (101, 'fixture-s16@example.test', 'Fixture', 'fixture')`
    );
    const secret = 'synthetic-fixture-webhook-key';
    await ctx.db
      .insert(paymentPlugins)
      .values({
        id: 'stripe',
        name: 'Stripe',
        description: '合成收据测试',
        enabled: 1,
        configJson: JSON.stringify({ webhook_secret: secret }),
      })
      .onConflictDoUpdate({
        target: paymentPlugins.id,
        set: { enabled: 1, configJson: JSON.stringify({ webhook_secret: secret }) },
      });
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAY-RECEIPT-FIXTURE',
      provider: 'stripe',
      currency: 'HKD',
      bizType: 'wallet_recharge',
      bizRef: 'RECHARGE-FIXTURE',
      userId: 101,
      amountCny: 90,
      payAmount: 100,
      providerTradeNo: 'cs_fixture_checkout',
      expiresAt: sql`datetime('now', '+20 minutes')`,
    });
    const receipt = {
      id: 'cs_fixture_checkout',
      mode: 'payment',
      object: 'checkout.session',
      currency: 'hkd',
      payment_status: 'paid',
      amount_total: 10000,
      client_reference_id: 'PAY-RECEIPT-FIXTURE',
      metadata: { intent_no: 'PAY-RECEIPT-FIXTURE' },
    };
    const send = async (object: Record<string, unknown>) => {
      const body = JSON.stringify({ type: 'checkout.session.completed', data: { object } });
      const ts = Math.floor(Date.now() / 1000);
      const sig = await hmacSha256Hex(secret, `${ts}.${body}`);
      return ctx.request('/api/payments/webhook/stripe', {
        method: 'POST',
        body,
        headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` },
      });
    };
    for (const patch of [
      { currency: undefined },
      { currency: 'usd' },
      { payment_status: undefined },
      { amount_total: 9999 },
      { id: 'cs_fixture_other_session' },
    ]) {
      expect((await send({ ...receipt, ...patch })).status).toBe(400);
    }
    expect((await findPaymentIntentByNo(ctx.db, 'PAY-RECEIPT-FIXTURE'))?.status).toBe('pending');
    expect((await send(receipt)).status).toBe(200);
    expect((await send(receipt)).status).toBe(200);
    expect((await findPaymentIntentByNo(ctx.db, 'PAY-RECEIPT-FIXTURE'))?.fulfill_status).toBe('done');
  });
});
