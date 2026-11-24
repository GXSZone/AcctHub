import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categories,
  categoryGroups,
  orders,
  productCards,
  products,
  upstreamOrders,
  users,
  walletEvents,
  walletTransactions,
} from '../../worker/db/schema/index';
import {
  expiredBalanceOrderGuard,
  postBalanceOrderStock,
} from '../../worker/domains/orders/orders.balance-recovery.repo';
import { finalizeProcessingOrderCas } from '../../worker/domains/orders/orders.repo';
import {
  balanceOrderActive,
  orderDebitKey,
  postBalanceOrderDebit,
} from '../../worker/domains/orders/orders.wallet.repo';
import { createDb } from '../../worker/infra/db';
import { type D1Harness, startD1Harness } from './runtime-harness';

describe('workerd D1 余额订单中断恢复', () => {
  let runtime: D1Harness;
  beforeEach(async () => {
    runtime = await startD1Harness();
  });
  afterEach(async () => {
    await runtime?.harness.close();
  });

  async function fixture(channel: 'web' | 'reseller_api') {
    const db = createDb(runtime.d1);
    const [group] = await db.insert(categoryGroups).values({ slug: 'recover', name: '恢复组' }).returning();
    const [category] = await db
      .insert(categories)
      .values({ groupId: group.id, slug: 'recovery', name: '恢复测试' })
      .returning();
    const [product] = await db
      .insert(products)
      .values({ categoryId: category.id, slug: 'recover', title: '测试商品', basePrice: 20 })
      .returning();
    const [buyer] = await db
      .insert(users)
      .values({ email: 'recover@example.test', displayName: '恢复测试', passwordHash: 'unused', balance: 40 })
      .returning();
    const orderNo = 'D1-BALANCE-RECOVERY';
    await db.insert(orders).values({
      orderNo,
      userId: buyer.id,
      productId: product.id,
      productTitle: product.title,
      contactEmail: buyer.email,
      unitPrice: 20,
      totalAmount: 20,
      status: 'processing',
      paymentMethod: 'balance',
      channel,
    });
    expect(
      await postBalanceOrderDebit(db, { userId: buyer.id, orderNo, amount: 20, note: '验证余额扣款' })
    ).toBe(true);
    await db
      .update(walletEvents)
      .set({ createdAt: '2000-01-01 00:00:00' })
      .where(eq(walletEvents.eventKey, orderDebitKey(orderNo)));
    const recover = async () =>
      expect((await runtime.worker.fetch('/__test/recover-balance-orders')).status).toBe(204);
    return { db, orderNo, buyer, product, recover };
  }

  it.each(['web', 'reseller_api'] as const)(
    'D1-BALANCE-RECOVER %s 仅有已扣款记录时退回原单，旧请求无法完成',
    async (channel) => {
      const f = await fixture(channel);
      expect(
        await finalizeProcessingOrderCas(
          f.db,
          f.orderNo,
          { status: 'delivered' },
          {
            guard: balanceOrderActive(f.db, f.orderNo),
          }
        )
      ).toMatchObject({ updated: false });
      await f.recover();
      await f.recover();
      expect((await f.db.select().from(orders).get())?.status).toBe('refunded');
      expect((await f.db.select().from(users).where(eq(users.id, f.buyer.id)).get())?.balance).toBe(40);
      expect(
        (await f.db.select().from(walletTransactions).orderBy(walletTransactions.id)).map((tx) => tx.amount)
      ).toEqual([-20, 20]);
    }
  );

  it('D1-BALANCE-STOCK 已认领本地库存时交付原卡并且只计一次销量', async () => {
    const f = await fixture('web');
    await f.db.insert(productCards).values({
      productId: f.product.id,
      cardContent: 'TEST-RECOVERED-CARD',
      status: 'sold',
      orderNo: f.orderNo,
    });
    await f.recover();
    await f.recover();
    expect(await f.db.select().from(orders).get()).toMatchObject({
      status: 'delivered',
      fulfillmentSource: 'local',
    });
    expect((await f.db.select().from(products).get())?.salesCount).toBe(1);
    expect((await f.db.select().from(walletTransactions)).map((tx) => tx.amount)).toEqual([-20]);
  });

  it('D1-BALANCE-MANUAL 手工库存已扣减时沿用断点且不重复扣库存', async () => {
    const f = await fixture('web');
    await f.db.update(products).set({ stockMode: 'manual', deliveryType: 'manual', manualStock: 5 });
    expect(
      await postBalanceOrderStock(f.db, f.orderNo, {
        productId: f.product.id,
        quantity: 1,
        mode: 'manual',
        guard: expiredBalanceOrderGuard(f.db, f.orderNo),
      })
    ).toBe(1);
    await f.recover();
    await f.recover();
    expect(await f.db.select().from(orders).get()).toMatchObject({ status: 'paid' });
    expect(await f.db.select().from(products).get()).toMatchObject({ salesCount: 1, manualStock: 4 });
    expect((await f.db.select().from(walletTransactions)).map((tx) => tx.amount)).toEqual([-20]);
  });

  it('D1-BALANCE-SUPPLIER 明确存在上游采购时沿用原单等待核对', async () => {
    const f = await fixture('reseller_api');
    await f.db.insert(upstreamOrders).values({
      localOrderNo: f.orderNo,
      sourceId: 88,
      upstreamOrderNo: 'SUPPLIER-1',
      idempotencyOutTradeNo: 'D1-SUPPLIER-1',
    });
    await f.recover();
    await f.recover();
    expect(await f.db.select().from(orders).get()).toMatchObject({
      status: 'upstream_pending',
      upstreamOrderNo: 'SUPPLIER-1',
      upstreamSourceId: 88,
    });
    expect((await f.db.select().from(walletTransactions)).map((tx) => tx.amount)).toEqual([-20]);
    expect(await f.db.select().from(upstreamOrders)).toHaveLength(1);
  });
});
