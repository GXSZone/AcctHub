import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundEvent } from '../../src/api/admin-refund.api';
import { orderRefunds, orders, paymentIntents, paymentPlugins, products } from '../../worker/db/schema/index';
import { claimUpstreamOrderRepo } from '../../worker/domains/upstream/upstream.orders.repo';
import worker from '../../worker/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('订单退款状态与资金边界', () => {
  let ctx: TestAppContext;
  let headers: { Authorization: string };

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    headers = await ctx.adminHeaders();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  async function seedOnline(
    orderNo: string,
    provider = 'epay',
    status = 'delivered',
    siteAgentId = 0,
    userId: number | null = null
  ) {
    await ctx.db.insert(orders).values({
      orderNo,
      contactEmail: 'refund@example.com',
      productId: 1,
      productTitle: '退款回归夹具',
      unitPrice: 50,
      totalAmount: 50,
      agentId: siteAgentId || null,
      userId,
      status,
      paymentMethod: provider,
      paymentIntentNo: `PAY-${orderNo}`,
    });
    await ctx.db.insert(paymentIntents).values({
      intentNo: `PAY-${orderNo}`,
      bizType: 'order',
      bizRef: orderNo,
      siteAgentId,
      userId,
      provider,
      amountCny: 50,
      payAmount: 50,
      providerTradeNo:
        provider === 'stripe' ? `cs_live_${orderNo.replace(/[^a-zA-Z0-9]/g, '')}` : `TRADE-${orderNo}`,
      status: 'paid',
      fulfillStatus: 'done',
      payloadJson: JSON.stringify({ sandbox_simulated: false }),
      expiresAt: '2000-01-01 00:00:00',
    });
  }

  function refund(orderNo: string, body: Record<string, unknown> = {}) {
    return ctx.jsonRequest<{ refund: RefundEvent }>(`/api/admin/orders/${orderNo}/refund`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  function state(orderNo: string) {
    return ctx.d1
      .prepare('SELECT status FROM orders WHERE order_no = ?')
      .bind(orderNo)
      .first<string>('status');
  }

  async function runScheduled() {
    const tasks: Promise<unknown>[] = [];
    const context: Pick<ExecutionContext, 'waitUntil'> = {
      waitUntil: (task) => {
        tasks.push(task);
      },
    };
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: '*/5 * * * *', noRetry: () => undefined },
      ctx.env,
      context as ExecutionContext
    );
    await Promise.all(tasks);
  }

  function createGate() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  type StripeFixture = {
    orderNo: string;
    status: 'pending' | 'unknown' | 'submitting';
    reply: 'succeeded' | 'pending' | 'mismatch' | 'offline';
  };

  async function seedStripePoll(rows: StripeFixture[]) {
    await ctx.db
      .insert(paymentPlugins)
      .values({
        id: 'stripe',
        name: 'Stripe',
        description: '',
        configJson: '{"secret_key":"sk_live_fixture"}',
      })
      .onConflictDoUpdate({
        target: paymentPlugins.id,
        set: { configJson: '{"secret_key":"sk_live_fixture"}' },
      });
    for (const [i, { orderNo, status }] of rows.entries()) {
      await seedOnline(orderNo, 'stripe');
      await ctx.db.insert(orderRefunds).values({
        orderNo,
        operationId: `op-${orderNo}`,
        siteAgentId: 0,
        mode: 'automatic',
        route: 'original_payment',
        status,
        provider: 'stripe',
        paymentIntentNo: `PAY-${orderNo}`,
        originalPayment: `cs_live_${orderNo}`,
        currency: 'CNY',
        amount: 50,
        amountCny: 50,
        providerRefundId: status === 'pending' ? `re_${orderNo}` : null,
        updatedAt: `2000-01-01 00:00:${String(i).padStart(2, '0')}`,
      });
    }
    const lookedUp: string[] = [];
    const submitted = vi.fn(() => Response.json({}, { status: 500 }));
    let beforeRefundLookup: ((orderNo: string) => Promise<void>) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const { pathname, searchParams } = new URL(url);
        if (init?.method === 'POST') return submitted();
        if (pathname.includes('/checkout/sessions/')) {
          const orderNo = pathname.split('/').at(-1)?.replace('cs_live_', '');
          if (!rows.some((row) => row.orderNo === orderNo)) return new Response(null, { status: 404 });
          return Response.json({
            id: `cs_live_${orderNo}`,
            object: 'checkout.session',
            livemode: true,
            status: 'complete',
            payment_status: 'paid',
            amount_total: 5000,
            currency: 'cny',
            payment_intent: `pi_${orderNo}`,
            client_reference_id: `PAY-${orderNo}`,
            metadata: { intent_no: `PAY-${orderNo}` },
          });
        }
        const list = pathname.endsWith('/refunds');
        const orderNo = list
          ? searchParams.get('payment_intent')?.replace('pi_', '')
          : pathname.split('/').at(-1)?.replace('re_', '');
        const row = rows.find((item) => item.orderNo === orderNo);
        if (!row) return new Response(null, { status: 404 });
        lookedUp.push(row.orderNo);
        await beforeRefundLookup?.(row.orderNo);
        if (row.reply === 'offline') return new Response(null, { status: 503 });
        const result = {
          object: 'refund',
          id: `re_${row.orderNo}`,
          amount: 5000,
          currency: 'cny',
          payment_intent: `pi_${row.orderNo}`,
          status: row.reply === 'pending' ? 'pending' : 'succeeded',
          metadata: { accthub_refund_id: row.reply === 'mismatch' ? 'other-op' : `op-${row.orderNo}` },
        };
        return Response.json(list ? { data: [result], has_more: false } : result);
      })
    );
    return {
      lookedUp,
      submitted,
      beforeLookup: (callback: typeof beforeRefundLookup) => {
        beforeRefundLookup = callback;
      },
    };
  }

  function ageRefund(orderNo: string, completionToken: string | null = null) {
    return ctx.d1
      .prepare(`UPDATE order_refunds SET updated_at = '2001-01-01 00:00:00', completion_token = ?
        WHERE order_no = ?`)
      .bind(completionToken, orderNo)
      .run();
  }

  it('[S04] 定时入口仅查询原退款并完成匹配的 pending、unknown 和超时提交单', async () => {
    const rows: StripeFixture[] = [
      { orderNo: 'PENDING1', status: 'pending', reply: 'pending' },
      { orderNo: 'UNKNOWN1', status: 'unknown', reply: 'mismatch' },
      { orderNo: 'SUBMIT1', status: 'submitting', reply: 'succeeded' },
      { orderNo: 'PENDING2', status: 'pending', reply: 'mismatch' },
    ];
    const gateway = await seedStripePoll(rows);
    await ageRefund('SUBMIT1', 'expired-query-lease');
    ctx.env.SANDBOX_MODE = 'false';
    await runScheduled();
    expect(await state('SUBMIT1')).toBe('refunded');
    expect(await state('PENDING1')).toBe('delivered');
    expect(await state('UNKNOWN1')).toBe('delivered');
    expect(await state('PENDING2')).toBe('delivered');
    expect(gateway.lookedUp).toHaveLength(4);
    await runScheduled();
    expect(gateway.lookedUp).toHaveLength(4);
    rows[0].reply = 'succeeded';
    rows[1].reply = 'succeeded';
    await ageRefund('PENDING1');
    await ageRefund('UNKNOWN1');
    await runScheduled();
    expect(await state('PENDING1')).toBe('refunded');
    expect(await state('UNKNOWN1')).toBe('refunded');
    expect(gateway.lookedUp).toHaveLength(6);
    expect(gateway.submitted).not.toHaveBeenCalled();
  });

  it('[S04] 定时退款按最早未处理轮换且持续待确认与查询异常不会占满名额', async () => {
    const rows: StripeFixture[] = Array.from({ length: 8 }, (_, i) => ({
      orderNo: `ROT${i}`,
      status: 'pending',
      reply: i === 0 ? 'offline' : i === 7 ? 'succeeded' : 'pending',
    }));
    const gateway = await seedStripePoll(rows);
    await runScheduled();
    expect([...gateway.lookedUp].sort()).toEqual(['ROT0', 'ROT1', 'ROT2', 'ROT3', 'ROT4', 'ROT5']);
    expect(await state('ROT7')).toBe('delivered');
    for (const orderNo of gateway.lookedUp) await ageRefund(orderNo);
    gateway.lookedUp.length = 0;
    await runScheduled();
    expect(gateway.lookedUp).toContain('ROT6');
    expect(gateway.lookedUp).toContain('ROT7');
    expect(await state('ROT7')).toBe('refunded');
    expect(gateway.submitted).not.toHaveBeenCalled();
  });

  it('[S04] 定时退款租约期间人工可完成且联动记账只有一次', async () => {
    const rows: StripeFixture[] = [{ orderNo: 'MANUALRACE', status: 'pending', reply: 'succeeded' }];
    const gateway = await seedStripePoll(rows);
    await ctx.db.insert(products).values({
      id: 1,
      categoryId: 1,
      slug: 'refund-race-product',
      title: '退款扣减销量夹具',
      salesCount: 2,
    });
    const arrived = createGate();
    const release = createGate();
    gateway.beforeLookup(async () => {
      if (gateway.lookedUp.length !== 1) return;
      arrived.resolve();
      await release.promise;
    });
    const scheduled = runScheduled();
    try {
      await Promise.race([arrived.promise, scheduled]);
      expect(gateway.lookedUp).toHaveLength(1);
      await runScheduled();
      expect(gateway.lookedUp).toHaveLength(1);
      expect(
        (
          await refund('MANUALRACE', {
            action: 'confirm',
            evidence: {
              originalPayment: 'cs_live_MANUALRACE',
              amount: 50,
              currency: 'CNY',
              reference: 're_MANUALRACE',
            },
          })
        ).ok
      ).toBe(true);
    } finally {
      release.resolve();
      await scheduled;
    }
    expect(await state('MANUALRACE')).toBe('refunded');
    expect(await ctx.d1.prepare('SELECT sales_count FROM products WHERE id = 1').first('sales_count')).toBe(
      1
    );
    expect(gateway.lookedUp).toHaveLength(2);
    expect(gateway.submitted).not.toHaveBeenCalled();
  });

  it('[S04] 续领过期退款查询租约后拒绝旧任务写入', async () => {
    const rows: StripeFixture[] = [{ orderNo: 'STALEPOLL', status: 'pending', reply: 'pending' }];
    const gateway = await seedStripePoll(rows);
    const arrived = createGate();
    const release = createGate();
    gateway.beforeLookup(async () => {
      if (gateway.lookedUp.length !== 1) return;
      arrived.resolve();
      await release.promise;
    });
    const stale = runScheduled();
    try {
      await Promise.race([arrived.promise, stale]);
      expect(gateway.lookedUp).toHaveLength(1);
      await ctx.d1
        .prepare("UPDATE order_refunds SET updated_at = '2001-01-01 00:00:00' WHERE order_no = ?")
        .bind('STALEPOLL')
        .run();
      await runScheduled();
      expect(gateway.lookedUp).toHaveLength(2);
      rows[0].reply = 'succeeded';
    } finally {
      release.resolve();
      await stale;
    }
    expect(await state('STALEPOLL')).toBe('delivered');
    await ageRefund('STALEPOLL');
    await runScheduled();
    expect(await state('STALEPOLL')).toBe('refunded');
    expect(gateway.submitted).not.toHaveBeenCalled();
  });

  it('[S04] 在线退款默认等待核对，只有匹配原交易、币种、金额与唯一证明才完成', async () => {
    await seedOnline('ORD-MANUAL');
    await seedOnline('ORD-OTHER');
    expect((await refund('ORD-MANUAL')).data.refund).toMatchObject({
      mode: 'manual',
      status: 'manual_required',
      route: 'original_payment',
    });
    expect(await state('ORD-MANUAL')).toBe('delivered');
    const evidence = {
      originalPayment: 'TRADE-ORD-MANUAL',
      amount: 50,
      currency: 'CNY',
      reference: 'REF-001',
    };
    expect(
      (await refund('ORD-MANUAL', { action: 'confirm', evidence: { ...evidence, amount: 49 } })).status
    ).toBe(400);
    expect(
      (await refund('ORD-MANUAL', { action: 'confirm', evidence: { ...evidence, currency: 'USD' } })).status
    ).toBe(400);
    expect(
      (await refund('ORD-MANUAL', { action: 'confirm', evidence: { ...evidence, originalPayment: 'WRONG' } }))
        .status
    ).toBe(400);
    expect(await state('ORD-MANUAL')).toBe('delivered');
    expect((await refund('ORD-MANUAL', { action: 'confirm', evidence })).data.refund).toMatchObject({
      status: 'succeeded',
    });
    expect(await state('ORD-MANUAL')).toBe('refunded');
    await refund('ORD-OTHER');
    expect(
      (
        await refund('ORD-OTHER', {
          action: 'confirm',
          evidence: { ...evidence, originalPayment: 'TRADE-ORD-OTHER' },
        })
      ).status
    ).toBe(409);
    expect(await state('ORD-OTHER')).toBe('delivered');
  });

  it('[S17] 已过期与未支付订单无法创建退款', async () => {
    await seedOnline('ORD-EXPIRED', 'epay', 'expired');
    await seedOnline('ORD-UNPAID', 'epay', 'pending_payment');
    expect((await refund('ORD-EXPIRED')).status).toBe(409);
    expect((await refund('ORD-UNPAID')).status).toBe(409);
    expect(await state('ORD-EXPIRED')).toBe('expired');
    expect(await state('ORD-UNPAID')).toBe('pending_payment');
  });

  it('[S04] 财务汇总只计入有实际记录的退款', async () => {
    await seedOnline('ORD-LEGACY-UNPROVEN', 'epay', 'refunded');
    await seedOnline('ORD-FINANCE-PROVEN');
    const summary = async () =>
      (await ctx.jsonRequest('/api/admin/finance/reconciliation?days=30', { headers })).data.summary;
    expect(await summary()).toMatchObject({ refunded_orders: 0, refunded_amount: 0 });
    await refund('ORD-FINANCE-PROVEN');
    expect(await summary()).toMatchObject({ refunded_orders: 0, refunded_amount: 0 });
    expect(
      (
        await refund('ORD-FINANCE-PROVEN', {
          action: 'confirm',
          evidence: {
            originalPayment: 'TRADE-ORD-FINANCE-PROVEN',
            amount: 50,
            currency: 'CNY',
            reference: 'FINANCE-REF-001',
          },
        })
      ).ok
    ).toBe(true);
    expect(await summary()).toMatchObject({ refunded_orders: 1, refunded_amount: 50 });
  });

  it('[S04] 所有分站共用全站单选策略，每笔在创建时固化模式', async () => {
    await seedOnline('ORD-MODE', 'epay', 'delivered', 101);
    await seedOnline('ORD-MODE-B', 'epay', 'delivered', 102);
    await seedOnline('ORD-MODE-C', 'epay', 'delivered', 101);
    const settingsUrl = '/api/admin/refund-policy';
    expect(
      (
        await ctx.jsonRequest(settingsUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ mode: 'automatic' }),
        })
      ).status
    ).toBe(200);
    expect((await refund('ORD-MODE')).data.refund).toMatchObject({
      mode: 'automatic',
      status: 'manual_required',
    });
    expect((await refund('ORD-MODE-B')).data.refund).toMatchObject({
      mode: 'automatic',
      status: 'manual_required',
    });
    expect(
      (
        await ctx.jsonRequest(settingsUrl, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ mode: 'manual' }),
        })
      ).status
    ).toBe(200);
    expect((await refund('ORD-MODE')).data.refund).toMatchObject({
      mode: 'automatic',
      status: 'manual_required',
    });
    expect((await refund('ORD-MODE-C')).data.refund).toMatchObject({
      mode: 'manual',
      status: 'manual_required',
    });
  });

  it.each(['pending', 'failed', 'unknown'] as const)(
    '[S04] Stripe %s 可查询且不会重新请求付款',
    async (initial) => {
      const orderNo = `ORD-${initial.toUpperCase()}`;
      await seedOnline(orderNo, 'stripe');
      await ctx.db
        .insert(paymentPlugins)
        .values({
          id: 'stripe',
          name: 'Stripe',
          description: '',
          enabled: 1,
          configJson: JSON.stringify({ secret_key: 'sk_live_fixture' }),
        })
        .onConflictDoUpdate({
          target: paymentPlugins.id,
          set: { configJson: JSON.stringify({ secret_key: 'sk_live_fixture' }) },
        });
      expect(
        (
          await ctx.jsonRequest('/api/admin/refund-policy', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ mode: 'automatic' }),
          })
        ).status
      ).toBe(200);
      const sessionId = `cs_live_${orderNo.replace(/[^a-zA-Z0-9]/g, '')}`;
      const session = {
        id: sessionId,
        object: 'checkout.session',
        livemode: true,
        status: 'complete',
        payment_status: 'paid',
        amount_total: 5000,
        currency: 'cny',
        payment_intent: 'pi_fixture',
        client_reference_id: `PAY-${orderNo}`,
        metadata: { intent_no: `PAY-${orderNo}` },
      };
      let calls = 0;
      let metadata: { accthub_refund_id: string | null } | undefined;
      const providerRefund = (status: string) => ({
        object: 'refund',
        id: 're_fixture',
        amount: 5000,
        currency: 'cny',
        payment_intent: 'pi_fixture',
        status,
        metadata,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const path = new URL(url).pathname;
          if (path.endsWith(sessionId)) return Response.json(session);
          if (init?.method === 'POST') {
            calls++;
            const body = new URLSearchParams(String(init.body));
            metadata = { accthub_refund_id: body.get('metadata[accthub_refund_id]') };
            expect(new Headers(init.headers).get('Idempotency-Key')).toBe(
              `accthub-refund-${metadata.accthub_refund_id}`
            );
            expect(body.get('payment_intent')).toBe('pi_fixture');
            return initial === 'unknown'
              ? Response.json({}, { status: 503 })
              : Response.json(providerRefund(initial));
          }
          if (path.endsWith('/refunds'))
            return Response.json({ data: [providerRefund('succeeded')], has_more: false });
          return Response.json(providerRefund('succeeded'));
        })
      );
      expect((await refund(orderNo)).data.refund).toMatchObject({ status: initial });
      expect(await state(orderNo)).toBe('delivered');
      expect((await refund(orderNo)).data.refund).toMatchObject({ status: initial });
      expect(calls).toBe(1);
      if (initial !== 'failed') {
        ctx.env.SANDBOX_MODE = 'false';
        expect((await refund(orderNo, { action: 'query' })).data.refund).toMatchObject({
          status: 'succeeded',
        });
        expect(await state(orderNo)).toBe('refunded');
      }
      expect(calls).toBe(1);
    }
  );

  it('在线原渠道退款与异常钱包补偿互斥', async () => {
    const userId = 912;
    await ctx.d1
      .prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
      .bind(userId, 'wallet-compensation@example.com', '补偿买家', 'test')
      .run();
    await seedOnline('ORD-ORIGINAL-ONLY', 'epay', 'fulfillment_failed', 0, userId);
    await seedOnline('ORD-COMPENSATION-ONLY', 'epay', 'fulfillment_failed', 0, userId);
    expect((await refund('ORD-ORIGINAL-ONLY')).data.refund.status).toBe('manual_required');
    expect((await refund('ORD-ORIGINAL-ONLY', { route: 'wallet_compensation' })).status).toBe(409);
    expect((await refund('ORD-COMPENSATION-ONLY', { route: 'wallet' })).status).toBe(400);
    expect(
      (await refund('ORD-COMPENSATION-ONLY', { route: 'wallet_compensation' })).data.refund
    ).toMatchObject({ route: 'wallet_compensation', status: 'succeeded' });
    expect((await refund('ORD-COMPENSATION-ONLY', { route: 'original_payment' })).status).toBe(409);
    expect(
      (
        await ctx.d1
          .prepare('SELECT type, amount, ref_no FROM wallet_transactions WHERE user_id = ?')
          .bind(userId)
          .all()
      ).results
    ).toEqual([{ type: 'refund_compensation', amount: 50, ref_no: 'ORD-COMPENSATION-ONLY' }]);
  });

  it('待核对上游采购与待核对退款互斥', async () => {
    await seedOnline('ORD-UPSTREAM-FIRST', 'epay', 'fulfillment_failed');
    await seedOnline('ORD-REFUND-FIRST', 'epay', 'fulfillment_failed');
    const claim = (orderNo: string) =>
      claimUpstreamOrderRepo(ctx.db, {
        localOrderNo: orderNo,
        idempotencyOutTradeNo: `RETRY-${orderNo}`,
        purpose: 'manual_retry',
        sourceId: 1,
        status: 'pending',
      });
    expect(await claim('ORD-UPSTREAM-FIRST')).toBeTypeOf('number');
    expect((await refund('ORD-UPSTREAM-FIRST')).status).toBe(409);
    expect((await refund('ORD-REFUND-FIRST')).data.refund.status).toBe('manual_required');
    expect(await claim('ORD-REFUND-FIRST')).toBeUndefined();
  });

  it('[S36] 钱包记账出错时保留异常单，重试只到账一次', async () => {
    const email = 'wallet-refund@example.com';
    const userId = 913;
    await ctx.d1
      .prepare('INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)')
      .bind(userId, email, '退款买家', 'test')
      .run();
    await ctx.db.insert(orders).values({
      orderNo: 'ORD-RETRY-REFUND',
      contactEmail: email,
      userId,
      productId: 1,
      productTitle: '退款失败夹具',
      unitPrice: 50,
      totalAmount: 50,
      status: 'fulfillment_failed',
      paymentMethod: 'balance',
    });
    await ctx.d1
      .prepare(`
      CREATE TRIGGER fail_refund BEFORE INSERT ON wallet_transactions
      WHEN NEW.type = 'refund' BEGIN SELECT RAISE(ABORT, '测试记账故障'); END
    `)
      .run();
    const doRefund = () =>
      ctx.jsonRequest('/api/admin/upstreams/local-orders/ORD-RETRY-REFUND/refund-balance', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
    expect((await doRefund()).ok).toBe(false);
    expect(await state('ORD-RETRY-REFUND')).toBe('fulfillment_failed');
    expect(
      await ctx.d1.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first<number>('balance')
    ).toBe(0);
    await ctx.d1.prepare('DROP TRIGGER fail_refund').run();
    const results = await Promise.all([doRefund(), doRefund()]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(await state('ORD-RETRY-REFUND')).toBe('refunded');
    expect(
      await ctx.d1.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first<number>('balance')
    ).toBe(50);
  });
});
