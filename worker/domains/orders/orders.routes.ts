import { createOrderInputSchema, lookupOrdersInputSchema, recoverCheckoutInputSchema } from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { sendQueuedOrderEmails } from '../../infra/mail.outbox';
import { parseJsonBody } from '../../middleware/validate.middleware';
import { readCheckout } from './orders.checkout';
import { createRetailOrder, lookupRetailOrders } from './orders.service';

export const orderRoutes = new Hono<AppBindings>();

orderRoutes.post('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  const input = await parseJsonBody(c, createOrderInputSchema);
  const result = await createRetailOrder(c.env, c.req.raw, c.get('tenant'), input, (promise) => {
    try {
      c.executionCtx?.waitUntil(promise);
    } catch {
      void promise;
    }
  });
  const publicNo = result.order?.public_order_no;
  if (publicNo) {
    const job = sendQueuedOrderEmails(c.env, c.get('tenant').agentId ?? 0, publicNo).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(job);
    } catch {
      await job;
    }
  }
  return c.json(result);
});

orderRoutes.post('/lookup', async (c) => {
  c.header('Cache-Control', 'no-store');
  const query = await parseJsonBody(c, lookupOrdersInputSchema);
  const result = await lookupRetailOrders(c.env, c.req.raw, c.get('tenant'), query);
  return c.json(result);
});

orderRoutes.post('/recover', async (c) => {
  c.header('Cache-Control', 'no-store');
  const input = await parseJsonBody(c, recoverCheckoutInputSchema);
  return c.json(
    await readCheckout(c.env, c.req.raw, c.get('tenant'), input.idempotency_key, input.checkout_secret)
  );
});
