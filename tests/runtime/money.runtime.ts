import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categories,
  categoryGroups,
  orderRefunds,
  orders,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  rechargeCdks,
  users,
  walletEvents,
  walletTransactions,
} from '../../worker/db/schema/index';
import { createDb } from '../../worker/infra/db';
import { D1_TEST_SETUP_SECRET, type D1Harness, startD1Harness } from './runtime-harness';

const email = 'd1-buyer@example.test';
const epayKey = 'only-for-local-d1-epay';
const stockLines = ['D1-GATE-CARD-A', 'D1-GATE-CARD-B'];

describe('workerd D1', () => {
  let runtime: D1Harness | undefined;

  beforeEach(async () => {
    runtime = await startD1Harness();
  });

  afterEach(async () => {
    await runtime?.harness.close();
    runtime = undefined;
  });

  function getRuntime() {
    if (!runtime) throw new Error('D1 测试运行时未启动');
    return runtime;
  }

  async function request(path: string, data?: unknown, token?: string, options?: { fault?: string }) {
    return getRuntime().worker.fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.fault ? { 'X-D1-Test-Fault': options.fault } : {}),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }

  function getDb() {
    return createDb(getRuntime().d1);
  }

  async function member(balance: number) {
    const response = await request('/api/auth/register', { email, password: 'LocalD1Password123!' });
    const body = (await response.json()) as { token: string; user: { id: number } };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.token).toBeTypeOf('string');
    await getDb().update(users).set({ balance }).where(eq(users.id, body.user.id));
    return { id: body.user.id, token: body.token };
  }

  async function adminToken() {
    const response = await request('/api/setup/initialize', {
      setup_secret: D1_TEST_SETUP_SECRET,
      admin_email: 'd1-admin@example.test',
      admin_password: 'LocalD1AdminPassword123!',
      admin_display_name: '测试管理员',
      brand_name: '测试站',
    });
    const body = (await response.json()) as { token: string };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.token).toBeTypeOf('string');
    return body.token;
  }

  async function product(administrator?: string) {
    const db = getDb();
    const [group] = await db.insert(categoryGroups).values({ slug: 'gate', name: '测试组' }).returning();
    const [category] = await db
      .insert(categories)
      .values({ groupId: group.id, slug: 'gate', name: '测试分类' })
      .returning();
    const [item] = await db
      .insert(products)
      .values({ categoryId: category.id, slug: 'gate', title: '测试商品', basePrice: 30 })
      .returning();
    if (administrator) {
      const response = await request(
        `/api/admin/products/${item.id}/cards`,
        { lines: stockLines.join('\n') },
        administrator
      );
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result).toMatchObject({ imported: 2 });
      const cards = await db.select().from(productCards).where(eq(productCards.productId, item.id));
      expect(cards).toHaveLength(2);
      expect(new Set(cards.map((card) => card.credentialFingerprint)).size).toBe(2);
      for (const card of cards) {
        expect(card.credentialFingerprint).toBeTruthy();
        expect(stockLines).not.toContain(card.cardContent);
      }
    }
    return item.id;
  }

  function balancePurchase(productId: number, token: string, key: string, options?: { fault?: string }) {
    return request(
      '/api/orders',
      { product_id: productId, contact_email: email, payment_method: 'balance', idempotency_key: key },
      token,
      options
    );
  }

  async function seedPayment(userId: number, intentNo = 'D1-GATE-INTENT') {
    await getDb().insert(paymentIntents).values({
      intentNo,
      bizType: 'wallet_recharge',
      bizRef: intentNo,
      userId,
      provider: 'epay',
      amountCny: 30,
      payAmount: 30,
      expiresAt: '2099-01-01 00:00:00',
    });
    return intentNo;
  }

  async function completePayment(intentNo: string, options?: { fault?: string; tradeNo?: string }) {
    return request(
      '/__test/complete-payment',
      {
        intentNo,
        receipt: {
          provider: 'epay',
          currency: 'CNY',
          tradeNo: options?.tradeNo ?? 'D1-GATE-TRADE',
          amountMinor: 3000,
        },
        originUrl: '',
      },
      undefined,
      options
    );
  }

  async function wallet(userId: number) {
    const db = getDb();
    const [user] = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId));
    const ledger = await db
      .select({
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
        refNo: walletTransactions.refNo,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
      .orderBy(walletTransactions.id);
    return { balance: user?.balance, ledger };
  }

  it('D1-BASELINE 全新 workerd D1 绑定应用仓库基线', async () => {
    const response = await request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ runtime: 'cloudflare-workers-edge' });
    expect(await getDb().select().from(walletTransactions)).toEqual([]);
    expect(await getDb().select().from(paymentIntents)).toEqual([]);
  });

  it('D1-DEBIT-RACE 两笔订单竞争余额，仅成功方扣款、记账和交付', async () => {
    const administrator = await adminToken();
    const buyer = await member(40);
    const productId = await product(administrator);
    const purchase = (key: string) => balancePurchase(productId, buyer.token, key);
    const responses = await Promise.all([purchase('d1-debit-race-a'), purchase('d1-debit-race-b')]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 402]);
    const rows = await getDb().select().from(orders);
    expect(rows).toHaveLength(1);
    expect(rows.filter((order) => order.status === 'delivered')).toHaveLength(1);
    const winner = rows.find((order) => order.status === 'delivered');
    expect(await wallet(buyer.id)).toEqual({
      balance: 10,
      ledger: [{ type: 'order_pay', amount: -30, balanceAfter: 10, refNo: winner?.orderNo }],
    });
    const cards = await getDb().select().from(productCards);
    expect(cards.filter((card) => card.status === 'sold')).toHaveLength(1);
  });

  it('D1-RETAIL-LOST-DEBIT-RESPONSE 零售扣款回执丢失后原单交付且重放只扣款一次', async () => {
    const administrator = await adminToken();
    const buyer = await member(70);
    const productId = await product(administrator);
    const key = 'd1-retail-lost-debit-response';
    const first = await balancePurchase(productId, buyer.token, key, { fault: 'lose-order-debit-response' });
    expect(first.headers.get('X-D1-Test-Fault-Hits')).toBe('1');
    const body = (await first.json()) as {
      order: { order_no: string; public_order_no: string; delivered_payload: string };
    };
    expect(first.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      balance: 40,
      order: { status: 'delivered', total_amount: 30, payment_method: 'balance' },
    });
    expect(body.order.order_no).toBeTruthy();
    expect(body.order.public_order_no).toBeTruthy();
    expect(stockLines).toContain(body.order.delivered_payload);

    const replay = await balancePurchase(productId, buyer.token, key);
    const replayBody = await replay.json();
    expect(replay.status, JSON.stringify(replayBody)).toBe(200);
    expect(replayBody).toMatchObject({
      balance: 40,
      idempotent_replay: true,
      order: {
        order_no: body.order.order_no,
        public_order_no: body.order.public_order_no,
        status: 'delivered',
        total_amount: 30,
        payment_method: 'balance',
        delivered_payload: body.order.delivered_payload,
      },
    });

    const db = getDb();
    const orderNo = body.order.order_no;
    expect(await wallet(buyer.id)).toEqual({
      balance: 40,
      ledger: [{ type: 'order_pay', amount: -30, balanceAfter: 40, refNo: orderNo }],
    });
    expect(await db.select().from(walletEvents)).toEqual([
      expect.objectContaining({ eventKey: JSON.stringify(['balance-order-debit', orderNo]), amount: -30 }),
    ]);
    expect(await db.select().from(orders)).toEqual([
      expect.objectContaining({ orderNo, status: 'delivered', userId: buyer.id, idempotencyKey: key }),
    ]);
    const stock = await db
      .select({ status: productCards.status, orderNo: productCards.orderNo })
      .from(productCards);
    expect(stock).toHaveLength(stockLines.length);
    expect(stock).toEqual(
      expect.arrayContaining([
        { status: 'sold', orderNo },
        { status: 'available', orderNo: null },
      ])
    );
  });

  it('D1-RETAIL-INSUFFICIENT 零售余额不足不产生扣款或占用库存', async () => {
    const administrator = await adminToken();
    const buyer = await member(29);
    const productId = await product(administrator);
    const response = await balancePurchase(productId, buyer.token, 'd1-retail-insufficient');
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(402);
    expect(body).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
    expect(body).not.toHaveProperty('order');

    const db = getDb();
    expect(await wallet(buyer.id)).toEqual({ balance: 29, ledger: [] });
    expect(await db.select().from(walletEvents)).toEqual([]);
    expect(await db.select().from(orders)).toEqual([]);
    expect(await db.select().from(paymentIntents)).toEqual([]);
    expect(
      await db.select({ status: productCards.status, orderNo: productCards.orderNo }).from(productCards)
    ).toEqual(stockLines.map(() => ({ status: 'available', orderNo: null })));
  });

  it('D1-CDK-RACE 并发兑换同一张卡仅增加一次余额并写一条流水', async () => {
    const buyer = await member(5);
    const code = 'D1-GATE-REDEEM';
    await getDb().insert(rechargeCdks).values({ code, amount: 30 });
    const responses = await Promise.all([
      request('/api/account/redeem-cdk', { code }, buyer.token),
      request('/api/account/redeem-cdk', { code }, buyer.token),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await wallet(buyer.id)).toEqual({
      balance: 35,
      ledger: [{ type: 'cdk', amount: 30, balanceAfter: 35, refNo: code }],
    });
    const [cdk] = await getDb().select().from(rechargeCdks);
    expect(cdk).toMatchObject({ status: 'used', usedByUserId: buyer.id });
  });

  it('D1-PAYMENT-REPLAY 并发网关回调与跨支付单重复流水只入账一次', async () => {
    const buyer = await member(5);
    const intentNo = await seedPayment(buyer.id);
    const duplicate = await seedPayment(buyer.id, 'D1-GATE-OTHER-INTENT');
    await getDb()
      .insert(paymentPlugins)
      .values({
        id: 'epay',
        name: '本地测试网关',
        description: '仅用于本地 D1 门禁',
        enabled: 1,
        configJson: JSON.stringify({ key: epayKey, pid: 'd1-fixture' }),
      });
    const notify = (outTradeNo: string) => {
      const params = {
        out_trade_no: outTradeNo,
        trade_no: 'D1-GATE-TRADE',
        trade_status: 'TRADE_SUCCESS',
        money: '30.00',
        pid: 'd1-fixture',
      };
      const signingInput = Object.entries(params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
      const sign = createHash('md5').update(`${signingInput}${epayKey}`).digest('hex');
      return request('/api/payments/webhook/epay', { ...params, sign });
    };
    const responses = await Promise.all([notify(intentNo), notify(intentNo)]);
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual(['success', 'success']);
    expect((await notify(duplicate)).status).toBe(400);
    const intents = await getDb().select().from(paymentIntents);
    const paid = intents.filter((intent) => intent.status === 'paid');
    expect(paid).toHaveLength(1);
    expect(paid[0].fulfillStatus).toBe('done');
    expect(await wallet(buyer.id)).toEqual({
      balance: 35,
      ledger: [{ type: 'recharge', amount: 30, balanceAfter: 35, refNo: paid[0].intentNo }],
    });
    expect(await getDb().select().from(walletEvents)).toHaveLength(1);
  });

  it('D1-REFUND-ROLLBACK 退款记账失败不会提前结单，重试并发请求只退款一次', async () => {
    const administrator = await adminToken();
    const buyer = await member(5);
    const productId = await product();
    const orderNo = 'D1-GATE-REFUND';
    await getDb().insert(orders).values({
      orderNo,
      userId: buyer.id,
      contactEmail: email,
      productId,
      productTitle: '本地退款测试',
      unitPrice: 30,
      totalAmount: 30,
      paymentMethod: 'balance',
      status: 'delivered',
    });
    const refund = () => request(`/api/admin/orders/${orderNo}/refund`, { restock: false }, administrator);
    await getRuntime()
      .d1.prepare(
        `CREATE TRIGGER d1_gate_reject_refund BEFORE INSERT ON wallet_transactions
       WHEN NEW.type = 'refund' BEGIN SELECT RAISE(ABORT, 'd1-gate-forced-refund-failure'); END`
      )
      .run();
    const failed = await refund();
    expect(failed.status).toBe(500);
    expect(await wallet(buyer.id)).toEqual({ balance: 5, ledger: [] });
    const [before] = await getDb().select().from(orders);
    expect(before.status).toBe('delivered');
    const [pending] = await getDb().select().from(orderRefunds);
    expect(pending).toMatchObject({ status: 'ready' });

    await getRuntime().d1.prepare('DROP TRIGGER d1_gate_reject_refund').run();
    const responses = await Promise.all([refund(), refund()]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    for (const response of responses) expect([200, 409]).toContain(response.status);
    const [after] = await getDb().select().from(orders);
    expect(after.status).toBe('refunded');
    const [completed] = await getDb().select().from(orderRefunds);
    expect(completed).toMatchObject({ status: 'succeeded' });
    expect(await wallet(buyer.id)).toEqual({
      balance: 35,
      ledger: [{ type: 'refund', amount: 30, balanceAfter: 35, refNo: orderNo }],
    });
  });

  it('D1-LEASE-FENCE 租约被接管后，原任务不能入账或覆盖新任务的状态', async () => {
    const buyer = await member(5);
    const intentNo = await seedPayment(buyer.id);
    const { d1 } = getRuntime();
    await d1
      .prepare(
        `CREATE TABLE runtime_lease_checkpoints (owner TEXT PRIMARY KEY, token TEXT NOT NULL, resume INTEGER DEFAULT 0)`
      )
      .run();
    const awaitCheckpoint = async (owner: string) => {
      const statement = d1.prepare('SELECT token FROM runtime_lease_checkpoints WHERE owner = ?').bind(owner);
      const deadline = Date.now() + 10_000;
      do {
        const token = await statement.first<string>('token');
        if (token) return token;
        await wait(20);
      } while (Date.now() < deadline);
      throw new Error(`D1 未记录履约任务 ${owner} 的等待点`);
    };
    const resume = (owner: string) =>
      d1.prepare('UPDATE runtime_lease_checkpoints SET resume = 1 WHERE owner = ?').bind(owner).run();

    const original = completePayment(intentNo, { fault: 'pause-lease-a' });
    let replacement: ReturnType<typeof request> | undefined;
    try {
      const originalToken = await awaitCheckpoint('A');
      await getDb()
        .update(paymentIntents)
        .set({ fulfillLeaseUntil: '2000-01-01 00:00:00' })
        .where(eq(paymentIntents.intentNo, intentNo));
      replacement = request('/__test/recover-payment', { intentNo }, undefined, { fault: 'pause-lease-b' });
      const replacementToken = await awaitCheckpoint('B');
      expect(replacementToken).not.toBe(originalToken);

      await resume('A');
      const late = await original;
      expect(late.status).toBe(200);
      expect(await late.json()).toMatchObject({ result: { ok: false }, faultHits: 1 });
      const [inProgress] = await getDb().select().from(paymentIntents);
      expect(inProgress).toMatchObject({
        status: 'paid',
        fulfillStatus: 'processing',
        fulfillLeaseToken: replacementToken,
      });
      expect(await wallet(buyer.id)).toEqual({ balance: 5, ledger: [] });
      expect(await getDb().select().from(walletEvents)).toEqual([]);

      await resume('B');
      expect(await (await replacement).json()).toMatchObject({ result: true, faultHits: 1 });
    } finally {
      await d1.prepare('UPDATE runtime_lease_checkpoints SET resume = 1').run();
      await Promise.allSettled([original, replacement]);
    }
    const [done] = await getDb().select().from(paymentIntents);
    expect(done).toMatchObject({ status: 'paid', fulfillStatus: 'done', fulfillLeaseToken: null });
    expect(await wallet(buyer.id)).toEqual({
      balance: 35,
      ledger: [{ type: 'recharge', amount: 30, balanceAfter: 35, refNo: intentNo }],
    });
  });

  it('D1-BATCH-ROLLBACK 账本写入失败会回滚余额和事件，重试可以完成入账', async () => {
    const buyer = await member(5);
    const intentNo = await seedPayment(buyer.id);
    await getRuntime()
      .d1.prepare(
        `CREATE TRIGGER d1_gate_reject_post BEFORE INSERT ON wallet_transactions
       WHEN NEW.type = 'recharge' BEGIN SELECT RAISE(ABORT, 'd1-gate-forced-ledger-failure'); END`
      )
      .run();

    const attempt = await completePayment(intentNo);
    expect(await attempt.json()).toMatchObject({ ok: false });
    expect(await wallet(buyer.id)).toEqual({ balance: 5, ledger: [] });
    expect(await getDb().select().from(walletEvents)).toEqual([]);
    const [failed] = await getDb().select().from(paymentIntents);
    expect(failed).toMatchObject({ status: 'paid', fulfillStatus: 'failed' });
    await getRuntime().d1.prepare('DROP TRIGGER d1_gate_reject_post').run();

    const recovery = await request('/__test/recover-payment', { intentNo });
    expect(await recovery.json()).toBe(true);
    expect(await wallet(buyer.id)).toEqual({
      balance: 35,
      ledger: [{ type: 'recharge', amount: 30, balanceAfter: 35, refNo: intentNo }],
    });
  });

  it('D1-ZERO-ROW 余额更新命中零行时不产生流水或已履约终态', async () => {
    const buyer = await member(5);
    const intentNo = await seedPayment(buyer.id);
    await getRuntime()
      .d1.prepare(
        `CREATE TRIGGER d1_gate_skip_balance BEFORE UPDATE OF balance ON users
         WHEN NEW.id = ${buyer.id} BEGIN SELECT RAISE(IGNORE); END`
      )
      .run();

    const attempt = await completePayment(intentNo);
    expect(await attempt.json()).toMatchObject({ ok: false });
    expect(await wallet(buyer.id)).toEqual({ balance: 5, ledger: [] });
    expect(await getDb().select().from(walletEvents)).toEqual([]);
    const [failed] = await getDb().select().from(paymentIntents);
    expect(failed).toMatchObject({ status: 'paid', fulfillStatus: 'failed' });
  });

  it('D1-LOST-RESPONSE D1 已提交但响应丢失后，重放只保留一条入账记录', async () => {
    const buyer = await member(5);
    const intentNo = await seedPayment(buyer.id);
    const attempt = await completePayment(intentNo, { fault: 'lose-batch-response' });
    expect(await attempt.json()).toMatchObject({ result: { ok: false }, faultHits: 1 });
    const expected = {
      balance: 35,
      ledger: [{ type: 'recharge', amount: 30, balanceAfter: 35, refNo: intentNo }],
    };
    expect(await wallet(buyer.id)).toEqual(expected);
    expect(await getDb().select().from(walletEvents)).toHaveLength(1);
    const replay = await completePayment(intentNo);
    expect(await replay.json()).toMatchObject({ ok: true });
    expect(await wallet(buyer.id)).toEqual(expected);
    expect(await getDb().select().from(walletEvents)).toHaveLength(1);
    const [done] = await getDb().select().from(paymentIntents);
    expect(done).toMatchObject({ status: 'paid', fulfillStatus: 'done' });
  });
});
