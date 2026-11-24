import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { orders, paymentIntents, productCards, products, upstreamOrders } from '../../worker/db/schema/index';
import { createAdminProduct, updateAdminProduct } from '../../worker/domains/admin/admin.product.service';
import { fulfillPaidAsyncOrder } from '../../worker/domains/payment/payment.fulfillment';
import { renewPaymentFulfillLease } from '../../worker/domains/payment/payment.repo';
import {
  updateOrderUpstreamStateRepo,
  updateUpstreamOrderRepo,
} from '../../worker/domains/upstream/upstream.orders.repo';
import { settleAsyncUpstreamCardsOutcome } from '../../worker/domains/upstream/upstream.poll.service';
import { createDb } from '../../worker/infra/db';
import { createTestD1Database } from './helpers/test-d1';

it('[B02] 删除原付款规格后不能交付现存的其他规格', async () => {
  const { d1, close } = createTestD1Database();
  const env = { DB: d1, APP_ENV: 'test' };
  const db = createDb(d1);
  try {
    await db.insert(products).values({
      id: 42,
      slug: 'purchase-spec',
      title: '商品',
      categoryId: 1,
      basePrice: 10,
      stockMode: 'cards',
      specsJson: JSON.stringify([{ id: 'other', name: '其他规格', price: 10 }]),
    });
    await db.insert(productCards).values({ productId: 42, specId: 'other', cardContent: 'OTHER-UNIT' });
    await db.insert(orders).values({
      orderNo: 'ORIGINAL-SKU',
      contactEmail: 'buyer@example.test',
      productId: 42,
      productTitle: '商品',
      specId: 'ordered',
      specName: '原规格',
      status: 'pending_payment',
      unitPrice: 10,
      totalAmount: 10,
    });
    const lease = { intentNo: 'PAY-ORIGINAL-SKU', token: 'test-lease' };
    await db.insert(paymentIntents).values({
      intentNo: lease.intentNo,
      bizRef: 'ORIGINAL-SKU',
      provider: 'stripe',
      amountCny: 10,
      payAmount: 10,
      status: 'paid',
      fulfillStatus: 'processing',
      fulfillLeaseToken: lease.token,
      fulfillLeaseUntil: '2099-01-01 00:00:00',
      expiresAt: '2099-01-01 00:00:00',
    });
    await fulfillPaidAsyncOrder(env, 'ORIGINAL-SKU', {}, 'https://store.test', {
      lease,
      renewLease: async () => {
        expect(await renewPaymentFulfillLease(db, lease)).toBe(true);
      },
    });
    const [order] = await db.select().from(orders).where(eq(orders.orderNo, 'ORIGINAL-SKU'));
    const [other] = await db.select().from(productCards).where(eq(productCards.productId, 42));
    expect(order.status).toBe('fulfillment_failed');
    expect(other.status).toBe('available');
    expect(other.orderNo).toBeNull();
  } finally {
    close();
  }
});

it('[B03][B26] 异步逐件交付需齐全，首次交付才设置时间并计销量', async () => {
  const { d1, close } = createTestD1Database();
  const env = { DB: d1, APP_ENV: 'test' };
  const db = createDb(d1);
  try {
    await db.insert(products).values({
      id: 42,
      slug: 'two-units',
      title: '两件商品',
      categoryId: 1,
      basePrice: 10,
      salesCount: 0,
    });
    await db.insert(orders).values({
      orderNo: 'TWO-UNITS',
      contactEmail: 'buyer@example.test',
      productId: 42,
      productTitle: '两件商品',
      quantity: 2,
      status: 'upstream_pending',
      upstreamStatus: 'pending',
      unitPrice: 10,
      totalAmount: 20,
      createdAt: '2026-01-01 00:00:00',
      warrantyType: 'first_login',
    });
    const [upOrder] = await db
      .insert(upstreamOrders)
      .values({
        localOrderNo: 'TWO-UNITS',
        sourceId: 1,
        quantity: 2,
        idempotencyOutTradeNo: 'TWO-UNITS-A1',
      })
      .returning();
    const state = async () => (await db.select().from(orders).where(eq(orders.orderNo, 'TWO-UNITS')))[0];
    const sales = async () => (await db.select().from(products).where(eq(products.id, 42)))[0].salesCount;
    const input = {
      upOrder,
      sourceId: 1,
      upstreamOrderNo: 'UP1',
      actualCost: 4,
      originUrl: 'https://store.test',
    };
    expect(await settleAsyncUpstreamCardsOutcome(env, { ...input, cards: ['FIRST'] })).toEqual({
      status: 'pending',
    });
    expect(await state()).toMatchObject({ status: 'upstream_pending', deliveredAt: null });
    expect(await sales()).toBe(0);
    expect(await settleAsyncUpstreamCardsOutcome(env, { ...input, cards: ['FIRST', 'SECOND'] })).toEqual({
      status: 'succeeded',
    });
    const delivered = await state();
    expect(delivered.status).toBe('delivered');
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.deliveredAt).not.toBe(delivered.createdAt);
    expect(await sales()).toBe(2);
    expect(await updateUpstreamOrderRepo(env, upOrder.id, { status: 'failed' })).toBe(false);
    const [purchase] = await db.select().from(upstreamOrders).where(eq(upstreamOrders.id, upOrder.id));
    expect(purchase.status).toBe('succeeded');
    await updateOrderUpstreamStateRepo(db, 'TWO-UNITS', { status: 'upstream_pending' });
    expect(await state()).toMatchObject({ status: 'delivered', deliveredAt: delivered.deliveredAt });
  } finally {
    close();
  }
});

it('[B21] 后台不能创建或启用缺少开通服务的 API Key 商品', async () => {
  const { d1, close } = createTestD1Database();
  const env = { DB: d1, APP_ENV: 'test' };
  try {
    await expect(createAdminProduct(env, { delivery_type: 'api_key' })).rejects.toThrow('暂不支持开通');
    await expect(updateAdminProduct(env, 1, { delivery_type: 'api_key' })).rejects.toThrow('暂不支持开通');
  } finally {
    close();
  }
});
