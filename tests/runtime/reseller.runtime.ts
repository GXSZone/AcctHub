import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  agentTiers,
  categories,
  categoryGroups,
  orders,
  productCards,
  products,
  users,
  walletEvents,
  walletTransactions,
} from '../../worker/db/schema/index';
import { isEncryptedSecret } from '../../worker/infra/crypto';
import { createDb } from '../../worker/infra/db';
import { D1_TEST_SETUP_SECRET, type D1Harness, startD1Harness } from './runtime-harness';

const orderPath = '/api/v1/reseller/order';
const apiKey = 'ah_only_for_local_d1_reseller';
const stockLines = ['D1-RESELLER-CARD-A', 'D1-RESELLER-CARD-B'];
const wholesalePrice = 40;

describe('workerd D1 批采', () => {
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

  async function post(path: string, data: unknown, headers?: Record<string, string>) {
    return getRuntime().worker.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  }

  async function fixture(balance = 100) {
    const setup = await post('/api/setup/initialize', {
      setup_secret: D1_TEST_SETUP_SECRET,
      admin_email: 'd1-reseller-admin@example.test',
      admin_password: 'LocalD1AdminPassword123!',
      admin_display_name: '测试管理员',
      brand_name: '批采测试站',
    });
    const setupBody = (await setup.json()) as { token: string };
    expect(setup.status, JSON.stringify(setupBody)).toBe(200);
    expect(setupBody.token).toBeTypeOf('string');

    const registration = await post('/api/auth/register', {
      email: 'd1-reseller@example.test',
      password: 'LocalD1Password123!',
    });
    const registrationBody = (await registration.json()) as { user: { id: number } };
    expect(registration.status, JSON.stringify(registrationBody)).toBe(200);
    const userId = registrationBody.user.id;
    const db = createDb(getRuntime().d1);
    await db.update(users).set({ balance }).where(eq(users.id, userId));

    const [tier] = await db
      .insert(agentTiers)
      .values({ code: 'd1-reseller', name: '批采测试等级', discountRate: 0.8 })
      .returning();
    const [agent] = await db
      .insert(agents)
      .values({
        userId,
        tierId: tier.id,
        slug: 'd1-reseller',
        brandName: '批采测试代理',
        apiKey: 'd1-reseller-fixture-label',
        apiKeyHash: createHash('sha256').update(apiKey).digest('hex'),
        status: 'active',
      })
      .returning();
    const [group] = await db
      .insert(categoryGroups)
      .values({ slug: 'd1-reseller', name: '测试组' })
      .returning();
    const [category] = await db
      .insert(categories)
      .values({ groupId: group.id, slug: 'd1-reseller', name: '测试分类' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ categoryId: category.id, slug: 'd1-reseller', title: '批采测试商品', basePrice: 50 })
      .returning();
    const imported = await post(
      `/api/admin/products/${product.id}/cards`,
      { lines: stockLines.join('\n') },
      { Authorization: `Bearer ${setupBody.token}` }
    );
    const importBody = await imported.json();
    expect(imported.status, JSON.stringify(importBody)).toBe(200);
    expect(importBody).toMatchObject({ imported: stockLines.length });
    const stock = await db.select().from(productCards).where(eq(productCards.productId, product.id));
    const fingerprints = stock.map((card) => card.credentialFingerprint);
    expect(fingerprints.every(Boolean)).toBe(true);
    expect(new Set(fingerprints).size).toBe(stockLines.length);
    expect(stock.every((card) => isEncryptedSecret(card.cardContent))).toBe(true);

    const headers = { 'X-API-Key': apiKey };
    return {
      order: (key: string, fault?: string) =>
        post(
          orderPath,
          { product_id: product.id, quantity: 1, idempotency_key: key },
          { ...headers, ...(fault ? { 'X-D1-Test-Fault': fault } : {}) }
        ),
      lookup: (key: string) =>
        getRuntime().worker.fetch(`${orderPath}?idempotency_key=${encodeURIComponent(key)}`, { headers }),
      async readState() {
        const account = await db
          .select({ balance: users.balance })
          .from(users)
          .where(eq(users.id, userId))
          .get();
        return {
          balance: account?.balance,
          ledger: await db
            .select({
              type: walletTransactions.type,
              amount: walletTransactions.amount,
              balanceAfter: walletTransactions.balanceAfter,
              refNo: walletTransactions.refNo,
            })
            .from(walletTransactions)
            .where(eq(walletTransactions.userId, userId))
            .orderBy(walletTransactions.id),
          events: await db.select().from(walletEvents).orderBy(walletEvents.eventKey),
          orders: await db.select().from(orders).where(eq(orders.agentId, agent.id)),
          stock: await db
            .select({ status: productCards.status, orderNo: productCards.orderNo })
            .from(productCards)
            .where(eq(productCards.productId, product.id))
            .orderBy(productCards.id),
        };
      },
    };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function assertDelivered(
    response: { status: number; json(): Promise<unknown> },
    expectFreshBalance = true
  ) {
    const body = (await response.json()) as { order_no: string; cards: string[] };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: 'delivered',
      unit_wholesale_price: wholesalePrice,
      total_deducted: wholesalePrice,
    });
    if (expectFreshBalance) expect(body).toHaveProperty('remaining_balance', 60);
    expect(body.order_no).toMatch(/^B2B/);
    expect(body.cards).toHaveLength(1);
    expect(stockLines).toContain(body.cards[0]);
    return body;
  }

  async function assertOnePurchase(f: Fixture, orderNo: string) {
    const state = await f.readState();
    expect(state.balance).toBe(60);
    expect(state.ledger).toEqual([
      { type: 'order_pay', amount: -wholesalePrice, balanceAfter: 60, refNo: orderNo },
    ]);
    const purchaseEvents = state.events.filter(
      (event) => event.eventKey !== JSON.stringify(['order-commissions', orderNo])
    );
    expect(purchaseEvents).toEqual([
      expect.objectContaining({
        eventKey: JSON.stringify(['balance-order-debit', orderNo]),
        amount: -wholesalePrice,
      }),
    ]);
    expect(state.orders).toEqual([
      expect.objectContaining({
        orderNo,
        status: 'delivered',
        channel: 'reseller_api',
        totalAmount: wholesalePrice,
      }),
    ]);
    expect(isEncryptedSecret(state.orders[0].deliveredPayload)).toBe(true);
    expect(state.stock).toHaveLength(stockLines.length);
    expect(state.stock).toEqual(
      expect.arrayContaining([
        { status: 'sold', orderNo },
        { status: 'available', orderNo: null },
      ])
    );
  }

  it('D1-B2B-DEBIT 批采出卡只扣款一次并记录唯一资金事件和流水', async () => {
    const f = await fixture();
    const delivered = await assertDelivered(await f.order('d1-b2b-debit'));
    await assertOnePurchase(f, delivered.order_no);
  });

  it('D1-B2B-COMPENSATE 扣款后卡密认领失败只补偿一次且无交付', async () => {
    const f = await fixture();
    const { d1 } = getRuntime();
    await d1
      .prepare('CREATE TABLE runtime_reseller_failed_claims (order_no TEXT, balance REAL NOT NULL)')
      .run();
    await d1
      .prepare(`
        CREATE TRIGGER runtime_block_reseller_claim
        BEFORE UPDATE OF status ON product_cards
        WHEN OLD.status = 'available' AND NEW.status = 'sold'
        BEGIN
          INSERT INTO runtime_reseller_failed_claims (order_no, balance)
          SELECT orders.order_no, users.balance
          FROM orders JOIN users ON users.id = orders.user_id
          WHERE orders.order_no = NEW.order_no;
          SELECT RAISE(IGNORE);
        END
      `)
      .run();
    const key = 'd1-b2b-compensate';
    const failed = await f.order(key);
    const failureBody = await failed.json();
    expect(failed.status, JSON.stringify(failureBody)).toBe(409);
    expect(failureBody).not.toHaveProperty('cards');
    const claims = d1.prepare('SELECT order_no, balance FROM runtime_reseller_failed_claims ORDER BY rowid');
    const beforeReplay = (await claims.all()).results;
    expect(beforeReplay.length).toBeGreaterThan(0);
    const retry = await f.order(key);
    const retryBody = await retry.json();
    expect(retry.status, JSON.stringify(retryBody)).toBe(200);
    expect(retryBody).toMatchObject({
      idempotent: true,
      status: 'refunded',
      total_deducted: 0,
      remaining_balance: 100,
      cards: [],
    });

    const state = await f.readState();
    expect(state.balance).toBe(100);
    expect(state.ledger).toHaveLength(2);
    const [debit, compensation] = state.ledger;
    expect(debit).toMatchObject({ type: 'order_pay', amount: -wholesalePrice, balanceAfter: 60 });
    expect(debit.refNo).toMatch(/^B2B/);
    expect(compensation).toEqual({
      type: 'refund',
      amount: wholesalePrice,
      balanceAfter: 100,
      refNo: debit.refNo,
    });
    expect(state.events.map(({ eventKey, amount }) => ({ eventKey, amount }))).toEqual([
      { eventKey: JSON.stringify(['balance-order-abort-refund', debit.refNo]), amount: wholesalePrice },
      { eventKey: JSON.stringify(['balance-order-debit', debit.refNo]), amount: -wholesalePrice },
    ]);
    expect(retryBody).toHaveProperty('order_no', debit.refNo);
    expect(state.orders).toEqual([
      expect.objectContaining({ orderNo: debit.refNo, status: 'refunded', deliveredPayload: '' }),
    ]);
    expect(state.stock).toEqual(stockLines.map(() => ({ status: 'available', orderNo: null })));
    expect(beforeReplay).toEqual(beforeReplay.map(() => ({ order_no: debit.refNo, balance: 60 })));
    expect((await claims.all()).results).toEqual(beforeReplay);
  });

  it('D1-B2B-IDEMPOTENT-RACE 同幂等键并发只交付一单且只扣款一次', async () => {
    const f = await fixture();
    const key = 'd1-b2b-race';
    const responses = await Promise.all([f.order(key), f.order(key)]);
    const statuses = responses.map((response) => response.status).sort();
    expect([
      [200, 200],
      [200, 409],
    ]).toContainEqual(statuses);

    const replay = await assertDelivered(await f.order(key));
    expect(replay).toHaveProperty('idempotent', true);
    const lookup = await assertDelivered(await f.lookup(key));
    expect(lookup.order_no).toBe(replay.order_no);
    expect(lookup.cards).toEqual(replay.cards);
    for (const response of responses) {
      if (response.status === 200) {
        const delivered = await assertDelivered(response, false);
        expect(delivered.order_no).toBe(replay.order_no);
        expect(delivered.cards).toEqual(replay.cards);
      } else {
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/processing/i) });
      }
    }
    await assertOnePurchase(f, replay.order_no);
  });

  it('D1-B2B-LOST-BATCH 扣款批次已提交但回执丢失后只交付一单', async () => {
    const f = await fixture();
    const key = 'd1-b2b-lost-batch';
    const first = await f.order(key, 'lose-order-debit-response');
    expect(first.headers.get('X-D1-Test-Fault-Hits')).toBe('1');
    const delivered = await assertDelivered(first);
    const replay = await assertDelivered(await f.order(key));
    expect(replay).toHaveProperty('idempotent', true);
    expect(replay.order_no).toBe(delivered.order_no);
    expect(replay.cards).toEqual(delivered.cards);
    await assertOnePurchase(f, delivered.order_no);
  });

  it('D1-B2B-INSUFFICIENT 余额不足时不扣款或占用卡密', async () => {
    const balance = wholesalePrice - 1;
    const f = await fixture(balance);
    const key = 'd1-b2b-insufficient';
    const response = await f.order(key);
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(402);
    expect(body).not.toHaveProperty('cards');
    expect((await f.lookup(key)).status).toBe(404);
    expect(await f.readState()).toEqual({
      balance,
      ledger: [],
      events: [],
      orders: [],
      stock: stockLines.map(() => ({ status: 'available', orderNo: null })),
    });
  });
});
