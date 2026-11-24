import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  categoryGroups,
  orders,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  supportTickets,
  upstreamOrders,
  upstreamSources,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { runScheduledPaymentMaintenance } from '../../worker/domains/payment/payment.service';
import {
  allocateUniqueUsdtAmount,
  fetchRecentUsdtChainTransfers,
} from '../../worker/domains/payment/payment.usdt';
import { listPendingUpstreamOrderIdsRepo } from '../../worker/domains/upstream/upstream.poll.repo';
import { pollSingleUpstreamOrder } from '../../worker/domains/upstream/upstream.poll.service';
import { signUpstreamParams } from '../../worker/domains/upstream/upstream.signer';
import {
  INVENTORY_CREDENTIAL_SCOPE,
  readDeliveryPayload,
  readStoredCredential,
} from '../../worker/infra/credential-storage';
import { encryptSecret } from '../../worker/infra/crypto';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('履约与通道安全回归：USDT 防撞与滞后核单 / 限流解耦 / 换新与囤货落库 / 全量守恒巡检', () => {
  let ctx: TestAppContext;
  let productId: number;
  let memberId: number;
  let memberToken: string;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp({ ADMIN_SECRET: 'batch2-admin-secret' });

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
        slug: 'gpt-team',
        title: 'ChatGPT Team',
        basePrice: 100,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'month', name: '月付版', price: 100 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await ctx.db.insert(productCards).values([
      { productId: prod.id, specId: 'month', cardContent: 'KEY-B2-001', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'KEY-B2-002', status: 'available' },
    ]);

    await ctx.db.insert(paymentPlugins).values([
      {
        id: 'usdt_trc20',
        name: 'USDT TRC20',
        description: 'TRC20 收款',
        enabled: 1,
        configJson: JSON.stringify({
          wallet_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
          usdt_cny_rate: '7.25',
          rate_markup: '0',
          auto_fx: 'false',
        }),
      },
      {
        id: 'epay',
        name: '易支付',
        description: 'Epay',
        enabled: 1,
        configJson: JSON.stringify({ key: 'batch2_epay_secret' }),
      },
    ]);

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'batch2_buyer@example.com', password: 'Password123!' }),
    });
    memberId = reg.data.user.id;
    memberToken = reg.data.token;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('1. [L3 & S5] 2h 内过期 USDT 尾数不被重分配；过期后迟到转账可被捞回；一笔链上哈希不可核销两单；链上报错显式抛出', async () => {
    // 插入一笔 30 分钟前刚刚过期的 USDT 支付单和对应订单（pay_amount = 13.7901）
    await ctx.db.insert(orders).values([
      {
        orderNo: 'AH-USDT-LATE-01',
        userId: memberId,
        contactEmail: 'batch2_buyer@example.com',
        productId,
        productTitle: 'ChatGPT Team',
        specId: 'month',
        specName: '月付版',
        quantity: 1,
        unitPrice: 100,
        totalAmount: 100,
        paymentMethod: 'usdt_trc20',
        channel: 'web',
        status: 'expired',
        paymentExpiresAt: '2026-01-01 00:00:00',
      },
      {
        orderNo: 'AH-USDT-DUP-02',
        userId: memberId,
        contactEmail: 'batch2_buyer@example.com',
        productId,
        productTitle: 'ChatGPT Team',
        specId: 'month',
        specName: '月付版',
        quantity: 1,
        unitPrice: 100,
        totalAmount: 100,
        paymentMethod: 'usdt_trc20',
        channel: 'web',
        status: 'pending_payment',
        paymentExpiresAt: '2099-01-01 00:00:00',
      },
    ]);

    await ctx.db.insert(paymentIntents).values([
      {
        intentNo: 'PAYUSDTLATE01',
        bizType: 'order',
        bizRef: 'AH-USDT-LATE-01',
        userId: memberId,
        siteAgentId: 0,
        provider: 'usdt_trc20',
        currency: 'USDT',
        amountCny: 100,
        payAmount: 13.7901,
        qrContent: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
        status: 'expired',
        fulfillStatus: 'none',
        expiresAt: sql`datetime('now', '-30 minutes')`,
        createdAt: sql`datetime('now', '-50 minutes')`,
      },
      {
        intentNo: 'PAYUSDTDUP02',
        bizType: 'order',
        bizRef: 'AH-USDT-DUP-02',
        userId: memberId,
        siteAgentId: 0,
        provider: 'usdt_trc20',
        currency: 'USDT',
        amountCny: 100,
        payAmount: 13.7902,
        qrContent: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
        status: 'pending',
        fulfillStatus: 'pending',
        expiresAt: '2099-01-01 00:00:00',
        createdAt: sql`datetime('now', '-5 minutes')`,
      },
    ]);

    // 验证 allocateUniqueUsdtAmount 避开了 13.7901（30分钟内过期）与 13.7902（活跃），分到 13.7903
    const allocated = await allocateUniqueUsdtAmount(
      ctx.env,
      100,
      { wallet_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', usdt_cny_rate: '7.25', rate_markup: '0' },
      'usdt_trc20'
    );
    expect(allocated.payAmount).toBe(13.7903);

    // 验证 TronGrid HTTP 429 时显式抛错，不再静默返回空数组
    vi.stubGlobal('fetch', async () => new Response('Rate limited', { status: 429 }));
    await expect(
      fetchRecentUsdtChainTransfers(
        'usdt_trc20',
        { wallet_address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb' },
        Date.now() - 3600_000
      )
    ).rejects.toThrow(/HTTP 429/);

    // 模拟 TronGrid 返回这笔迟到的 13.7901 转账（块时间在 15 分钟前），应精准唤醒交付 PAYUSDTLATE01
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                transaction_id: 'TRC20-TX-LATE-001',
                value: '13790100',
                block_timestamp: Date.now() - 15 * 60 * 1000,
                to: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
                type: 'Transfer',
                token_info: { decimals: 6, address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const maint = await runScheduledPaymentMaintenance(ctx.env, 'https://test.local');
    expect(maint.matchedUsdt).toBe(1);

    const lateOrd = (await ctx.db.select().from(orders).where(eq(orders.orderNo, 'AH-USDT-LATE-01')))[0];
    expect(lateOrd.status).toBe('delivered');
    expect(lateOrd.deliveredPayload).toMatch(/^v3\./);
    expect(lateOrd.deliveredPayload).not.toContain('KEY-B2-');
    expect(await readDeliveryPayload(ctx.env, lateOrd.orderNo, lateOrd.deliveredPayload)).toContain(
      'KEY-B2-'
    );

    // S5 验证：试图用同一个链上交易哈希再次去撞同金额第三单时，直接被数据库唯一约束/幂等拦死
    await expect(
      ctx.db.insert(paymentIntents).values({
        intentNo: 'PAYUSDTCOLLIDE03',
        bizType: 'order',
        bizRef: 'AH-USDT-DUP-02',
        userId: memberId,
        siteAgentId: 0,
        provider: 'usdt_trc20',
        currency: 'USDT',
        amountCny: 100,
        payAmount: 13.7905,
        providerTradeNo: 'trc20-tx-late-001',
        status: 'paid',
        fulfillStatus: 'done',
        expiresAt: '2099-01-01 00:00:00',
      })
    ).rejects.toThrow();
  });

  it('2. [S4] /intents/:no/check 独立触发 429 限流且绝不连带扫描全站其他超时支付单', async () => {
    await ctx.db.insert(paymentIntents).values([
      {
        intentNo: 'PAYCHECKTARGET',
        bizType: 'wallet_recharge',
        bizRef: `R-${memberId}`,
        userId: memberId,
        siteAgentId: 0,
        provider: 'epay',
        currency: 'CNY',
        amountCny: 50,
        payAmount: 50,
        status: 'pending',
        fulfillStatus: 'pending',
        expiresAt: '2099-01-01 00:00:00',
      },
      {
        intentNo: 'PAYUNRELATEDEXPIRED',
        bizType: 'wallet_recharge',
        bizRef: `R-${memberId}`,
        userId: memberId,
        siteAgentId: 0,
        provider: 'epay',
        currency: 'CNY',
        amountCny: 20,
        payAmount: 20,
        status: 'pending',
        fulfillStatus: 'pending',
        expiresAt: '2000-01-01 00:00:00',
      },
    ]);

    // 连续点击 10 次应放行，第 11 次返回 429
    const check = { method: 'POST', headers: { Authorization: `Bearer ${memberToken}` } };
    for (let i = 0; i < 10; i++) {
      const r = await ctx.jsonRequest('/api/payments/intents/PAYCHECKTARGET/check', check);
      expect(r.status).toBe(200);
    }
    const limited = await ctx.jsonRequest<{ code: string }>(
      '/api/payments/intents/PAYCHECKTARGET/check',
      check
    );
    expect(limited.status).toBe(429);
    expect(limited.data.code).toBe('RATE_LIMITED');

    // 验证无关支付单 PAYUNRELATEDEXPIRED 并没有因为调用 /check 而被全站扫单改成 expired
    const unrelated = (
      await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, 'PAYUNRELATEDEXPIRED'))
    )[0];
    expect(unrelated.status).toBe('pending');
  });

  it('3. [L4] 预拉囤货与售后换新异步回调正确落地，无主记录转 orphan 不堵轮询，30 次重试上限收敛', async () => {
    const whSecretEnc = await encryptSecret(ctx.env, 'l4_webhook_secret');
    const [src] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: 'L4 测试上游源',
        adapterType: 'generic_json',
        baseUrl: 'https://mock-up.local',
        webhookSecretEnc: whSecretEnc,
        status: 'active',
      })
      .returning();

    // 场景 A：restock_pull 处于 pending 等待异步回调
    await ctx.db.insert(upstreamOrders).values({
      localOrderNo: '',
      attemptNo: 1,
      idempotencyOutTradeNo: 'PULL-ASYNC-001',
      sourceId: src.id,
      sourceName: src.name,
      bindingId: 1,
      productId,
      specId: 'month',
      upstreamItemId: 'item_pull',
      quantity: 2,
      upstreamCost: 120,
      status: 'pending',
      purpose: 'restock_pull',
    });

    const pullHookBody: Record<string, unknown> = {
      out_trade_no: 'PULL-ASYNC-001',
      trade_no: 'UP-PULL-9001',
      status: 'succeeded',
      cards: ['PULL-CARD-01', 'PULL-CARD-02'],
    };
    pullHookBody.sign = await signUpstreamParams('hmac_sha256', pullHookBody, 'l4_webhook_secret');
    const pullHookRes = await ctx.jsonRequest<{ ok: boolean }>(`/api/webhooks/upstream/${src.id}`, {
      method: 'POST',
      body: JSON.stringify(pullHookBody),
    });
    expect(pullHookRes.status).toBe(200);

    const cardsNow = await ctx.db.select().from(productCards).where(eq(productCards.productId, productId));
    const availableCards = await Promise.all(
      cardsNow
        .filter((c) => c.status === 'available')
        .map((c) => readStoredCredential(ctx.env, c.cardContent, INVENTORY_CREDENTIAL_SCOPE))
    );
    expect(availableCards).toEqual(expect.arrayContaining(['PULL-CARD-01', 'PULL-CARD-02']));

    // 场景 B：采购记录绑定原订单与发起换新的工单
    const origOrderNo = 'AH-RP-ORIG-01';
    await ctx.db.insert(orders).values({
      orderNo: origOrderNo,
      userId: memberId,
      contactEmail: 'batch2_buyer@example.com',
      productId,
      productTitle: 'ChatGPT Team',
      specId: 'month',
      specName: '月付版',
      quantity: 1,
      unitPrice: 100,
      totalAmount: 100,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'delivered',
      deliveredPayload: 'OLD-DEAD-KEY',
      upstreamCostTotal: 50,
    });
    const [ticket] = await ctx.db
      .insert(supportTickets)
      .values({
        ticketNo: 'TK-L4-001',
        userId: memberId,
        contactEmail: 'batch2_buyer@example.com',
        orderNo: origOrderNo,
        category: 'after_sale',
        subject: '账号掉线换新',
        status: 'open',
      })
      .returning();

    await ctx.db.insert(upstreamOrders).values({
      localOrderNo: `${origOrderNo}-RP`,
      attemptNo: 1,
      idempotencyOutTradeNo: `${origOrderNo}-RP-A1`,
      sourceId: src.id,
      sourceName: src.name,
      bindingId: 1,
      productId,
      specId: 'month',
      upstreamItemId: 'item_rp',
      quantity: 1,
      upstreamCost: 45,
      status: 'pending',
      purpose: 'after_sale_replace',
      replacementOrderNo: origOrderNo,
      replacementTicketId: ticket.id,
    });

    const rpHookBody: Record<string, unknown> = {
      out_trade_no: `${origOrderNo}-RP-A1`,
      trade_no: 'UP-RP-888',
      status: 'succeeded',
      cards: ['NEW-FRESH-KEY-888'],
      cost: 45,
    };
    rpHookBody.sign = await signUpstreamParams('hmac_sha256', rpHookBody, 'l4_webhook_secret');
    const rpHookRes = await ctx.jsonRequest<{ ok: boolean }>(`/api/webhooks/upstream/${src.id}`, {
      method: 'POST',
      body: JSON.stringify(rpHookBody),
    });
    expect(rpHookRes.status).toBe(200);

    const updatedOrig = (await ctx.db.select().from(orders).where(eq(orders.orderNo, origOrderNo)))[0];
    const delivered = await readDeliveryPayload(ctx.env, updatedOrig.orderNo, updatedOrig.deliveredPayload);
    expect(delivered).toContain('OLD-DEAD-KEY');
    expect(delivered).toContain('NEW-FRESH-KEY-888');
    expect(Number(updatedOrig.upstreamCostTotal)).toBe(95);
    const updatedTicket = (
      await ctx.db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id))
    )[0];
    expect(updatedTicket.status).toBe('resolved');

    // 场景 C：找不到原订单的出卡自动标记 orphan 释放队头，且 30 次轮询上限自动转 orphan
    const [ghostUp] = await ctx.db
      .insert(upstreamOrders)
      .values({
        localOrderNo: 'AH-NONEXISTENT-GHOST',
        attemptNo: 1,
        idempotencyOutTradeNo: 'GHOST-A1',
        sourceId: src.id,
        sourceName: src.name,
        bindingId: 1,
        productId,
        specId: 'month',
        upstreamItemId: 'item_ghost',
        quantity: 1,
        status: 'pending',
        purpose: 'order_fulfill',
      })
      .returning();

    const ghostHook: Record<string, unknown> = {
      out_trade_no: 'GHOST-A1',
      status: 'succeeded',
      cards: ['ORPHAN-CARD-01'],
    };
    ghostHook.sign = await signUpstreamParams('hmac_sha256', ghostHook, 'l4_webhook_secret');
    await ctx.jsonRequest(`/api/webhooks/upstream/${src.id}`, {
      method: 'POST',
      body: JSON.stringify(ghostHook),
    });
    const ghostAfter = (
      await ctx.db.select().from(upstreamOrders).where(eq(upstreamOrders.id, ghostUp.id))
    )[0];
    expect(ghostAfter.status).toBe('orphan');

    // 验证 retryCount = 29 再轮询一次仍 pending 则自动变 orphan，退出待轮询队列
    const [srcMock] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: 'L4 无限重试上限源',
        adapterType: 'mock_sandbox',
        sandboxMode: 'async_pending',
        status: 'active',
      })
      .returning();
    const [stuckRow] = await ctx.db
      .insert(upstreamOrders)
      .values({
        localOrderNo: 'AH-STUCK-30',
        attemptNo: 1,
        idempotencyOutTradeNo: 'STUCK-30-A1',
        sourceId: srcMock.id,
        sourceName: srcMock.name,
        bindingId: 1,
        productId,
        specId: 'month',
        upstreamItemId: 'item_stuck',
        quantity: 1,
        status: 'pending',
        retryCount: 29,
        purpose: 'order_fulfill',
      })
      .returning();

    const pollRes = await pollSingleUpstreamOrder(ctx.env, stuckRow.id);
    expect(pollRes.status).toBe('orphan');
    const pendingList = await listPendingUpstreamOrderIdsRepo(ctx.db, 25);
    expect(pendingList).not.toContain(stuckRow.id);
  });

  it('4. [L6] 7 项对账巡检精准识别主余额账实失衡、L1 无单售卡与 L2 充值漏入账', async () => {
    const adminHeaders = await ctx.adminHeaders();

    // 注入 3 处隐蔽漏单：
    // 1) 主余额无流水漂移（member 初始有 50 沙盒流水，直接改 balance 到 123 产生 73 偏差）
    await ctx.db.update(users).set({ balance: 123 }).where(eq(users.id, memberId));

    // 2) L1：卡密标为 sold 却指向不存在的订单
    await ctx.db.insert(productCards).values({
      productId,
      specId: 'month',
      cardContent: 'L1-ORPHAN-SOLD-KEY',
      status: 'sold',
      orderNo: 'AH-DELETED-L1-ORDER',
    });

    // 3) L2：wallet_recharge 支付单已付却缺失对应 wallet_transactions
    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAYRECHORPHANL6',
      bizType: 'wallet_recharge',
      bizRef: `R-${memberId}`,
      userId: memberId,
      siteAgentId: 0,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 66,
      payAmount: 66,
      providerTradeNo: 'EPAY-L6-ORPHAN',
      status: 'paid',
      fulfillStatus: 'failed',
      expiresAt: '2099-01-01 00:00:00',
      paidAt: '2026-01-01 00:00:00',
    });

    const fin = await ctx.jsonRequest<{
      integrity_checks: Array<{ key: string; passed: boolean; count: number; detail: string }>;
    }>('/api/admin/finance/reconciliation?days=30', { headers: adminHeaders });

    expect(fin.status).toBe(200);
    expect(fin.data.integrity_checks.length).toBe(7);

    const byKey = new Map(fin.data.integrity_checks.map((c) => [c.key, c]));
    expect(byKey.get('wallet_ledger_conservation')?.passed).toBe(false);
    expect(byKey.get('l1_orphan_deductions')?.passed).toBe(false);
    expect(byKey.get('l1_orphan_deductions')?.count).toBeGreaterThanOrEqual(1);
    expect(byKey.get('async_payment_sync')?.passed).toBe(false);
    expect(byKey.get('async_payment_sync')?.count).toBeGreaterThanOrEqual(1);

    // 验证写齐流水、清理测试孤儿记录后恢复全绿
    await ctx.db.insert(walletTransactions).values({
      userId: memberId,
      type: 'recharge',
      amount: 73,
      balanceAfter: 123,
      refNo: 'L6-FIX-DRIFT',
      note: '平账测试',
    });
    await ctx.db.delete(productCards).where(eq(productCards.orderNo, 'AH-DELETED-L1-ORDER'));
    await ctx.db.delete(paymentIntents).where(eq(paymentIntents.intentNo, 'PAYRECHORPHANL6'));

    const finClean = await ctx.jsonRequest<{
      integrity_checks: Array<{ key: string; passed: boolean }>;
    }>('/api/admin/finance/reconciliation?days=30', { headers: adminHeaders });
    expect(finClean.status).toBe(200);
    expect(finClean.data.integrity_checks.every((c) => c.passed)).toBe(true);
  });
});
