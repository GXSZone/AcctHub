import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  orders,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  users,
  walletTransactions,
} from '../../worker/db/schema';
import { updateAdminPaymentPlugin } from '../../worker/domains/admin/admin.support.service';
import { createStripeCheckoutSession } from '../../worker/domains/payment/payment.gateway';
import {
  executeFulfillForPaidIntent,
  recoverSinglePaidIntent,
  recoverUnfulfilledPaidIntents,
} from '../../worker/domains/payment/payment.recovery';
import { findPaymentIntentByNo } from '../../worker/domains/payment/payment.repo';
import { completePaymentIntent } from '../../worker/domains/payment/payment.service';
import { hmacSha256Hex, sha256Hex } from '../../worker/infra/crypto';
import { createTestApp, type TestAppContext } from './helpers/test-app';

const originUrl = 'https://shop.example.test';
const expiresAt = '2031-01-01 00:00:00';
const webhookSecret = 'synthetic-stripe-webhook';
const liveKey = 'sk_live_fixture';

describe('正式支付隔离', () => {
  let ctx: TestAppContext;

  beforeEach(() => {
    ctx = createTestApp({ APP_ENV: 'production', SANDBOX_MODE: 'true' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  async function addWalletIntent(intentNo: string, fields: Partial<typeof paymentIntents.$inferInsert> = {}) {
    await ctx.db
      .insert(users)
      .values({ id: 1, email: 'buyer@example.test', displayName: '买家', passwordHash: 'fixture' })
      .onConflictDoNothing();
    await ctx.db.insert(paymentIntents).values({
      intentNo,
      expiresAt,
      provider: 'epay',
      currency: 'CNY',
      bizType: 'wallet_recharge',
      bizRef: intentNo,
      amountCny: 10,
      payAmount: 10,
      userId: 1,
      ...fields,
    });
  }

  it('先独立拒绝模拟收据与模拟支付单，再允许正式收据入账一次', async () => {
    await addWalletIntent('PAY-LIVE');
    await addWalletIntent('PAY-SIMULATED', { payloadJson: '{"sandbox_simulated":true}' });
    const receipt = { provider: 'epay' as const, currency: 'CNY', amountMinor: 1000, tradeNo: 'TRADE-1' };
    for (const [intentNo, input] of [
      ['PAY-LIVE', { ...receipt, sandbox: true }],
      ['PAY-LIVE', { ...receipt, tradeNo: 'SBX-MOCK-FIXTURE' }],
      ['PAY-SIMULATED', receipt],
    ] as const) {
      await expect(
        completePaymentIntent(ctx.env, { intentNo, receipt: input, originUrl })
      ).resolves.toMatchObject({ ok: false });
      expect(await findPaymentIntentByNo(ctx.db, intentNo)).toMatchObject({
        status: 'pending',
        fulfill_lease_token: null,
      });
    }
    expect(await ctx.db.select().from(walletTransactions)).toHaveLength(0);
    const live = { intentNo: 'PAY-LIVE', receipt, originUrl };
    await expect(completePaymentIntent(ctx.env, live)).resolves.toMatchObject({ ok: true });
    await expect(completePaymentIntent(ctx.env, live)).resolves.toMatchObject({
      ok: true,
      alreadyPaid: true,
    });
    expect(await ctx.db.select().from(walletTransactions)).toHaveLength(1);
  });

  it('历史模拟单不领取补偿租约、不占候选名额、不入账或发货', async () => {
    for (let i = 0; i < 31; i += 1) {
      await addWalletIntent(`SIM-${i}`, {
        status: 'paid',
        fulfillStatus: 'failed',
        payloadJson: '{"sandbox_simulated":true}',
      });
    }
    const [product] = await ctx.db
      .insert(products)
      .values({ categoryId: 1, slug: 'fixture', title: '库存样本', basePrice: 10 })
      .returning();
    await ctx.db
      .insert(productCards)
      .values({ productId: product.id, specId: 'default', cardContent: 'fixture-card', status: 'available' });
    await ctx.db.insert(orders).values({
      orderNo: 'ORDER-SIM',
      productId: product.id,
      productTitle: product.title,
      quantity: 1,
      contactEmail: 'buyer@example.test',
      status: 'processing',
      unitPrice: 10,
      totalAmount: 10,
      paymentIntentNo: 'ORDER-SIM-PAY',
    });
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'ORDER-SIM-PAY',
      provider: 'stripe',
      providerTradeNo: 'cs_test_fixture',
      payloadJson: '{}',
      status: 'paid',
      fulfillStatus: 'failed',
      bizType: 'order',
      bizRef: 'ORDER-SIM',
      amountCny: 10,
      payAmount: 10,
      expiresAt,
    });
    await addWalletIntent('PAY-TO-RECOVER', {
      status: 'paid',
      fulfillStatus: 'failed',
      providerTradeNo: 'TRADE-LIVE',
    });
    await expect(recoverSinglePaidIntent(ctx.env, 'SIM-0', originUrl)).resolves.toBe(false);
    await expect(recoverSinglePaidIntent(ctx.env, 'ORDER-SIM-PAY', originUrl)).resolves.toBe(false);
    const orderIntent = await findPaymentIntentByNo(ctx.db, 'ORDER-SIM-PAY');
    if (!orderIntent) throw new Error('缺少模拟订单支付单');
    await expect(executeFulfillForPaidIntent(ctx.env, orderIntent, originUrl)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(recoverUnfulfilledPaidIntents(ctx.env, originUrl)).resolves.toEqual({
      recovered: 1,
      failed: 0,
    });
    expect(await findPaymentIntentByNo(ctx.db, 'ORDER-SIM-PAY')).toMatchObject({
      fulfill_status: 'failed',
      fulfill_lease_token: null,
    });
    expect(await ctx.db.select().from(orders).where(eq(orders.orderNo, 'ORDER-SIM')).get()).toMatchObject({
      status: 'processing',
      deliveredPayload: '',
    });
    expect(
      await ctx.db.select().from(productCards).where(eq(productCards.productId, product.id)).get()
    ).toMatchObject({ status: 'available' });
    expect(await ctx.db.select().from(walletTransactions)).toMatchObject([
      { refNo: 'PAY-TO-RECOVER', amount: 10 },
    ]);
  });

  it('正式环境不向原结账会话返回历史模拟收银台', async () => {
    const intentNo = 'PAY-HISTORICAL';
    const orderNo = 'ORDER-HISTORICAL';
    const checkoutSecret = 'ab'.repeat(32);
    const idempotencyKey = 'historical-checkout';
    const cashierToken = 'fixture-cashier-token';
    const [product] = await ctx.db
      .insert(products)
      .values({ categoryId: 1, slug: 'historical-item', title: '历史订单样本', basePrice: 10 })
      .returning();
    await ctx.db.insert(orders).values({
      orderNo,
      publicOrderNo: `AHQ-${'a'.repeat(32)}`,
      productId: product.id,
      productTitle: product.title,
      contactEmail: 'buyer@example.test',
      status: 'pending_payment',
      unitPrice: 10,
      totalAmount: 10,
      paymentIntentNo: intentNo,
      idempotencyKey,
      checkoutSecretHash: await sha256Hex(`checkout-secret:${checkoutSecret}`),
      checkoutPayloadHash: 'fixture-checkout-payload-hash',
    });
    await ctx.db.insert(paymentIntents).values({
      intentNo,
      provider: 'epay',
      payloadJson: JSON.stringify({ sandbox_simulated: true, view_token: cashierToken }),
      bizType: 'order',
      bizRef: orderNo,
      amountCny: 10,
      payAmount: 10,
      expiresAt,
    });

    const recover = () =>
      ctx.jsonRequest('/api/orders/recover', {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: idempotencyKey, checkout_secret: checkoutSecret }),
      });
    const path = `/api/payments/intents/${intentNo}`;
    const headers = { 'X-Intent-Token': cashierToken };
    const historical = await recover();
    expect(historical.status).toBe(200);
    expect(historical.data).toMatchObject({ found: true, idempotent_replay: true });
    expect(historical.data).not.toHaveProperty('payment_intent');
    expect((await ctx.request(path, { headers })).status).toBe(404);
    expect((await ctx.request(`${path}/check`, { method: 'POST', headers })).status).toBe(404);

    await ctx.db
      .update(paymentIntents)
      .set({ payloadJson: JSON.stringify({ view_token: cashierToken }) })
      .where(eq(paymentIntents.intentNo, intentNo));
    expect((await recover()).data).toMatchObject({
      requires_payment: true,
      payment_intent: { intent_no: intentNo },
    });
    expect((await ctx.request(path, { headers })).status).toBe(200);
  });

  it('Stripe 测试密钥不保存或发起收款，创建会话要求 livemode 为 true', async () => {
    const external = vi.fn(async () =>
      Response.json({ id: 'cs_live_fixture', url: 'https://checkout.example.test/', livemode: false })
    );
    vi.stubGlobal('fetch', external);
    const input = {
      intentNo: 'STRIPE-NEW',
      subject: '测试样本',
      amountCny: 10,
      originUrl,
      returnUrl: originUrl,
    };
    for (const key of ['sk_test_fixture', 'rk_test_fixture']) {
      await expect(
        updateAdminPaymentPlugin(ctx.env, 'stripe', { config: { secret_key: key } })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        createStripeCheckoutSession(
          ctx.env,
          { currency: 'cny', secret_key: key, webhook_secret: webhookSecret },
          input
        )
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(external).not.toHaveBeenCalled();
    const config = { currency: 'cny', secret_key: liveKey, webhook_secret: webhookSecret };
    await expect(createStripeCheckoutSession(ctx.env, config, input)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    external.mockResolvedValueOnce(
      Response.json({ id: 'cs_live_fixture', url: 'https://checkout.example.test/', livemode: true })
    );
    await expect(createStripeCheckoutSession(ctx.env, config, input)).resolves.toMatchObject({
      providerTradeNo: 'cs_live_fixture',
      sandboxSimulated: false,
    });
  });

  it('Stripe 回调验签成功后仍要求事件和会话都属于正式模式', async () => {
    const configJson = JSON.stringify({ secret_key: liveKey, webhook_secret: webhookSecret });
    await ctx.db
      .insert(paymentPlugins)
      .values({ id: 'stripe', name: 'Stripe', description: '合成收据测试', enabled: 1, configJson })
      .onConflictDoUpdate({ target: paymentPlugins.id, set: { configJson } });
    const intentNo = 'PAY-STRIPE-LIVE';
    await addWalletIntent(intentNo, { provider: 'stripe', providerTradeNo: 'cs_live_fixture' });
    const object = {
      id: 'cs_live_fixture',
      mode: 'payment',
      object: 'checkout.session',
      currency: 'cny',
      payment_status: 'paid',
      amount_total: 1000,
      client_reference_id: intentNo,
      metadata: { intent_no: intentNo },
    };
    const send = async (livemode?: boolean, sessionMode?: boolean) => {
      const body = JSON.stringify({
        type: 'checkout.session.completed',
        livemode,
        data: { object: { ...object, livemode: sessionMode } },
      });
      const ts = Math.floor(Date.now() / 1000);
      const sig = await hmacSha256Hex(webhookSecret, `${ts}.${body}`);
      return ctx.request('/api/payments/webhook/stripe', {
        method: 'POST',
        body,
        headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` },
      });
    };
    for (const [eventMode, sessionMode] of [
      [false, true],
      [undefined, true],
      [true, false],
      [true, undefined],
    ]) {
      expect((await send(eventMode, sessionMode)).status).toBe(400);
    }
    expect(await findPaymentIntentByNo(ctx.db, intentNo)).toMatchObject({ status: 'pending' });
    expect((await send(true, true)).status).toBe(200);
    expect(await findPaymentIntentByNo(ctx.db, intentNo)).toMatchObject({
      status: 'paid',
      fulfill_status: 'done',
    });
  });
});
