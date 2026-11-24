import { eq, sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { coupons, orders, paymentIntents, products } from '../../worker/db/schema/index';
import { postPaidOrderStock } from '../../worker/domains/fulfillment/fulfillment.repo';
import { claimCouponUsageByCodeAtomic } from '../../worker/domains/payment/payment.fulfill.repo';
import {
  claimPaidIntentForFulfillRetryAtomic,
  paymentFulfillLeaseGuard,
} from '../../worker/domains/payment/payment.repo';
import { createDb } from '../../worker/infra/db';
import { startD1Harness } from './runtime-harness';

it('D1-LEASE-ORDER 优惠券和库存恢复点在真实 D1 上原子保存且接管不重复扣减', async () => {
  const runtime = await startD1Harness();
  try {
    const db = createDb(runtime.d1);
    const orderNo = 'D1-LEASE-STOCK-ORDER';
    const intentNo = 'D1-LEASE-STOCK-PAYMENT';
    const couponCode = 'D1-LEASE-STOCK-COUPON';
    const [product] = await db
      .insert(products)
      .values({
        categoryId: 1,
        slug: 'fixture-d1-lease-stock',
        title: '测试库存',
        basePrice: 10,
        stockMode: 'manual',
        manualStock: 2,
      })
      .returning();
    await db.insert(orders).values({
      orderNo,
      status: 'processing',
      contactEmail: 'fixture@example.test',
      productId: product.id,
      productTitle: product.title,
      quantity: 2,
      unitPrice: 10,
      totalAmount: 19,
      couponCode,
      paymentIntentNo: intentNo,
    });
    await db.insert(coupons).values({ code: couponCode, name: '测试券', maxUses: 1 });
    await db.insert(paymentIntents).values({
      intentNo,
      provider: 'stripe',
      bizRef: orderNo,
      amountCny: 19,
      payAmount: 19,
      status: 'paid',
      fulfillStatus: 'failed',
      expiresAt: sql`datetime('now', '+20 minutes')`,
    });
    const previous = await claimPaidIntentForFulfillRetryAtomic(db, intentNo);
    if (!previous?.fulfill_lease_token) throw new Error('租约领取失败');
    const lease = { intentNo, token: previous.fulfill_lease_token };
    const guard = paymentFulfillLeaseGuard(lease);
    if (!guard) throw new Error('租约条件未创建');
    const postStock = () =>
      postPaidOrderStock(db, { intentNo, guard, productId: product.id, quantity: 2, mode: 'manual' });

    await runtime.d1
      .prepare(`
      CREATE TRIGGER fail_stock_checkpoint BEFORE UPDATE OF payload_json ON payment_intents
      WHEN json_extract(NEW.payload_json, '$.fulfill_local_stock') IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'fixture stock checkpoint failure'); END
    `)
      .run();
    expect(await claimCouponUsageByCodeAtomic(db, couponCode, lease)).toBe(true);
    await expect(postStock()).rejects.toThrow();
    expect(await db.select().from(products).where(eq(products.id, product.id)).get()).toMatchObject({
      manualStock: 2,
      salesCount: 0,
    });
    await runtime.d1.prepare('DROP TRIGGER fail_stock_checkpoint').run();
    expect(await postStock()).toBe(1);

    await db
      .update(paymentIntents)
      .set({ fulfillLeaseUntil: '2000-01-01 00:00:00' })
      .where(eq(paymentIntents.intentNo, intentNo));
    expect(await postStock()).toBeNull();
    const recovered = await runtime.worker.fetch('/__test/recover-payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentNo }),
    });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toBe(true);
    expect(await db.select().from(products).where(eq(products.id, product.id)).get()).toMatchObject({
      manualStock: 0,
      salesCount: 2,
    });
    expect(await db.select().from(coupons).where(eq(coupons.code, couponCode)).get()).toMatchObject({
      usedCount: 1,
    });
    expect(await db.select().from(orders).where(eq(orders.orderNo, orderNo)).get()).toMatchObject({
      status: 'delivered',
    });
    expect(
      await db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, intentNo)).get()
    ).toMatchObject({ fulfillStatus: 'done', fulfillLeaseToken: null });
  } finally {
    await runtime.harness.close();
  }
});
