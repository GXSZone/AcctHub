import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestD1Database } from '../../../tests/integration/helpers/test-d1';
import { productCards, products, productUpstreamBindings, upstreamSources } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { checkSpecAvailability, executeUnifiedFulfillment } from './fulfillment.service';

async function setupFulfillmentTestEnv(initialCards: Array<{ specId: string; cardContent: string }>) {
  const { d1, close } = createTestD1Database({ applyMigrations: true });
  const db = createDb(d1);

  await db.insert(products).values({
    id: 10,
    categoryId: 1,
    slug: 'claude-pro-test',
    title: 'Claude Pro',
    basePrice: 99,
    stockMode: 'cards',
    salesCount: 0,
  });

  if (initialCards.length > 0) {
    await db.insert(productCards).values(
      initialCards.map((c) => ({
        productId: 10,
        specId: c.specId,
        cardContent: c.cardContent,
        status: 'available',
      }))
    );
  }

  return {
    env: { DB: d1, APP_ENV: 'test' } as Env,
    db,
    close,
  };
}

describe('worker/domains/fulfillment/fulfillment.service', () => {
  it('[B06] 上游专供缺货时不发本地库存', async () => {
    const t = await setupFulfillmentTestEnv([{ specId: 'pro', cardContent: 'CARD-001' }]);
    try {
      await t.db.insert(upstreamSources).values({ id: 1, name: '货源', baseUrl: 'https://supplier.test' });
      await t.db.insert(productUpstreamBindings).values({
        productId: 10,
        specId: 'pro',
        sourceId: 1,
        upstreamItemId: '42',
        fulfillmentMode: 'upstream_only',
        cachedStock: 0,
      });
      const result = await checkSpecAvailability(t.env, {
        productId: 10,
        spec: { id: 'pro', name: '月付', price: 99 },
        specsCount: 2,
        quantity: 1,
        stockMode: 'cards',
        deliveryType: 'auto',
        manualStock: 0,
        seatTotal: 0,
        seatUsed: 0,
      });
      expect(result).toMatchObject({ forceUpstreamOnly: true, available: false });
    } finally {
      t.close();
    }
  });

  it('[B21] 人工算力库存不能作为算力开通回执', async () => {
    const t = await setupFulfillmentTestEnv([]);
    try {
      const result = await checkSpecAvailability(t.env, {
        productId: 10,
        spec: { id: 'pro', name: '算力', price: 99 },
        specsCount: 1,
        quantity: 1,
        stockMode: 'manual',
        deliveryType: 'api_key',
        manualStock: 10,
        seatTotal: 0,
        seatUsed: 0,
      });
      expect(result.available).toBe(false);
    } finally {
      t.close();
    }
  });
  it('atomically claims local cards for both web and reseller_api orders', async () => {
    const t = await setupFulfillmentTestEnv([
      { specId: 'pro', cardContent: 'CARD-001' },
      { specId: 'pro', cardContent: 'CARD-002' },
    ]);
    try {
      const spec = { id: 'pro', name: '月付', price: 99 };
      const availability = await checkSpecAvailability(t.env, {
        productId: 10,
        spec,
        specsCount: 2,
        quantity: 2,
        stockMode: 'cards',
        deliveryType: 'auto',
        manualStock: 0,
        seatTotal: 0,
        seatUsed: 0,
      });
      expect(availability.available).toBe(true);
      expect(availability.localCardAvail).toBe(2);

      const res = await executeUnifiedFulfillment(t.env, {
        orderNo: 'B2B998877',
        channel: 'reseller_api',
        paymentMethod: 'balance',
        productId: 10,
        productTitle: 'Claude Pro',
        spec,
        specsCount: 2,
        quantity: 2,
        stockMode: 'cards',
        deliveryType: 'auto',
        contactEmail: 'agent@example.com',
        totalAmount: 158.4,
        originUrl: 'https://shop.test',
        availability,
      });

      expect(res.ok).toBe(true);
      expect(res.fulfillmentSource).toBe('local');
      expect(res.orderStatus).toBe('delivered');
      expect(res.deliveredLines).toEqual(['CARD-001', 'CARD-002']);

      const cards = await t.db.select().from(productCards).where(eq(productCards.productId, 10));
      expect(cards.every((c) => c.status === 'sold' && c.orderNo === 'B2B998877')).toBe(true);

      const prod = (await t.db.select().from(products).where(eq(products.id, 10)))[0];
      expect(prod.salesCount).toBe(2);
    } finally {
      t.close();
    }
  });

  it('rejects checkout cleanly when local stock is insufficient and no healthy upstream exists', async () => {
    const t = await setupFulfillmentTestEnv([{ specId: 'pro', cardContent: 'CARD-001' }]);
    try {
      const availability = await checkSpecAvailability(t.env, {
        productId: 10,
        spec: { id: 'pro', name: '月付', price: 99 },
        specsCount: 2,
        quantity: 3,
        stockMode: 'cards',
        deliveryType: 'auto',
        manualStock: 0,
        seatTotal: 0,
        seatUsed: 0,
      });
      expect(availability.available).toBe(false);
      expect(availability.errorMessage).toContain('仅剩 1 件');
    } finally {
      t.close();
    }
  });

  it('rolls back partially claimed cards cleanly on mid-flight stock contention', async () => {
    const t = await setupFulfillmentTestEnv([{ specId: 'pro', cardContent: 'CARD-001' }]);
    try {
      const spec = { id: 'pro', name: '月付', price: 99 };
      const res = await executeUnifiedFulfillment(t.env, {
        orderNo: 'AH123456',
        channel: 'web',
        paymentMethod: 'balance',
        productId: 10,
        productTitle: 'Claude Pro',
        spec,
        specsCount: 2,
        quantity: 2,
        stockMode: 'cards',
        deliveryType: 'auto',
        contactEmail: 'buyer@example.com',
        totalAmount: 198,
        originUrl: 'https://shop.test',
        availability: {
          localCardAvail: 2,
          hasHealthyUpstream: false,
          forceUpstreamOnly: false,
          available: true,
        },
      });
      expect(res.ok).toBe(false);

      const cards = await t.db.select().from(productCards).where(eq(productCards.productId, 10));
      expect(cards[0]?.status).toBe('available');
      expect(cards[0]?.orderNo).toBeNull();
    } finally {
      t.close();
    }
  });
});
