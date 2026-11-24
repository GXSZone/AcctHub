import { eq } from 'drizzle-orm';
import { expect, it, vi } from 'vitest';
import { createTestD1Database } from '../../../tests/integration/helpers/test-d1';
import {
  orders,
  productUpstreamBindings,
  supportTickets,
  ticketMessages,
  upstreamOrders,
  upstreamSources,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { settleAsyncUpstreamCardsOutcome } from './upstream.poll.service';
import { procureAfterSaleReplacementForTicket } from './upstream.recovery.service';

it('[S41] 未付款且未交付的原单不得申请采购换新', async () => {
  const { d1, close } = createTestD1Database({ applyMigrations: true });
  const db = createDb(d1);
  try {
    await db.insert(orders).values({
      orderNo: 'PENDING-ORDER',
      contactEmail: 'buyer@example.test',
      productId: 42,
      productTitle: '待付款商品',
      unitPrice: 12,
      totalAmount: 12,
      status: 'pending_payment',
    });
    await db.insert(supportTickets).values({
      id: 44,
      ticketNo: 'PENDING-TICKET',
      orderNo: 'PENDING-ORDER',
      contactEmail: 'buyer@example.test',
      subject: '订单咨询',
    });
    await expect(
      procureAfterSaleReplacementForTicket({ DB: d1, APP_ENV: 'test' } as Env, {
        ticketId: 44,
        originUrl: 'https://shop.test',
      })
    ).rejects.toThrow('已付款且完成交付');
  } finally {
    close();
  }
});

it('[S18][B28][B46] 重试保留原采购，回执仅解决发起工单并单独报告通知', async () => {
  const { d1, close } = createTestD1Database({ applyMigrations: true });
  const db = createDb(d1);
  const env = { DB: d1, APP_ENV: 'test', SANDBOX_MODE: 'true' } as Env;
  const originUrl = 'https://shop.test';
  const transport = vi.fn(async () => Response.json({ order_no: 'UP-ORDER', status: 'upstream_pending' }));
  vi.stubGlobal('fetch', transport);
  try {
    await db.insert(orders).values({
      orderNo: 'DELIVERED-ORDER',
      contactEmail: 'buyer@example.test',
      productId: 42,
      productTitle: '原商品',
      unitPrice: 12,
      totalAmount: 12,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'delivered',
      deliveredPayload: 'ORIGINAL-UNIT',
    });
    for (const id of [1, 2]) {
      await db.insert(supportTickets).values({
        id,
        ticketNo: `T-${id}`,
        orderNo: 'DELIVERED-ORDER',
        contactEmail: 'buyer@example.test',
        subject: '售后',
      });
    }
    await db.insert(upstreamSources).values({
      id: 1,
      name: '供应商',
      baseUrl: 'https://supplier.test',
      adapterType: 'accthub_v1',
    });
    await db.insert(productUpstreamBindings).values({
      productId: 42,
      specId: 'default',
      sourceId: 1,
      upstreamItemId: '42',
      cachedStock: 1,
    });
    const pending = await Promise.all([
      procureAfterSaleReplacementForTicket(env, { ticketId: 1, originUrl }),
      procureAfterSaleReplacementForTicket(env, { ticketId: 1, originUrl }),
    ]);
    expect(pending.map((row) => row.status)).toEqual(['pending', 'pending']);
    expect(transport).toHaveBeenCalledTimes(1);
    const [purchase] = await db.select().from(upstreamOrders);
    expect(purchase.replacementTicketId).toBe(1);
    const input = {
      upOrder: purchase,
      sourceId: 1,
      cards: ['REPLACEMENT-UNIT'],
      upstreamOrderNo: 'UP-ORDER',
      actualCost: 2,
      originUrl,
    };
    await Promise.all([
      settleAsyncUpstreamCardsOutcome(env, input),
      settleAsyncUpstreamCardsOutcome(env, input),
    ]);
    const rows = await db.select().from(supportTickets).orderBy(supportTickets.id);
    expect(rows.map((row) => row.status)).toEqual(['resolved', 'open']);
    const replies = await db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, 1));
    expect(replies).toHaveLength(1);
    expect(replies[0].content).not.toContain('REPLACEMENT-UNIT');
    const delivered = await procureAfterSaleReplacementForTicket(env, { ticketId: 1, originUrl });
    expect(delivered.status).toBe('delivered');
    expect(delivered.mailStatus).not.toBe('sent');
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    close();
  }
});
