import { updateUpstreamSourceSchema, upsertUpstreamSourceSchema } from '@shared/index';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../../env';
import { AppError, Errors } from '../../infra/errors';
import {
  createUpstreamSource,
  deleteUpstreamBinding,
  deleteUpstreamSource,
  getUpstreamAdminOverview,
  listUpstreamBindings,
  listUpstreamSourceItems,
  mutateUpstreamItem,
  refreshUpstreamSourceBalance,
  testUpstreamSource,
  updateUpstreamBinding,
  updateUpstreamSource,
  upsertUpstreamBinding,
} from './upstream.admin.service';
import { pollSingleUpstreamOrder } from './upstream.fulfillment.service';
import {
  getUpstreamOrdersLedger,
  manualFulfillLocalOrder,
  processUpstreamWebhook,
  retryLocalOrderProcurement,
} from './upstream.ops.service';
import {
  procureAfterSaleReplacementForTicket,
  pullUpstreamCardsToLocalStock,
  refundFailedOrderToUserBalance,
} from './upstream.recovery.service';
import { sendReplacementMail } from './upstream.replacement.service';
import { syncUpstreamSource } from './upstream.sync.service';

export const upstreamAdminRoutes = new Hono<AppBindings>();
export const upstreamWebhookRoutes = new Hono<AppBindings>();

// 公开带签名上游异步发货回调：POST /api/webhooks/upstream/:sourceId
upstreamWebhookRoutes.post('/:sourceId', async (c) => {
  const sourceId = Number(c.req.param('sourceId'));
  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return c.json({ error: '无效的上游源 ID' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const res = await processUpstreamWebhook(
    c.env,
    sourceId,
    body,
    c.req.raw.headers,
    new URL(c.req.url).origin
  );
  return c.json(res.body, res.status as ContentfulStatusCode);
});

upstreamAdminRoutes.get('/', async (c) => c.json(await getUpstreamAdminOverview(c.env)));

upstreamAdminRoutes.post('/', async (c) => {
  const parsed = upsertUpstreamSourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.validation('货源配置无效');
  return c.json(await createUpstreamSource(c.env, parsed.data, c.req.header('Idempotency-Key')));
});

upstreamAdminRoutes.put('/:id', async (c) => {
  const parsed = updateUpstreamSourceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw Errors.validation('货源配置无效');
  return c.json(await updateUpstreamSource(c.env, Number(c.req.param('id')), parsed.data));
});

upstreamAdminRoutes.delete('/:id', async (c) =>
  c.json(await deleteUpstreamSource(c.env, Number(c.req.param('id'))))
);

upstreamAdminRoutes.post('/:id/test', async (c) =>
  c.json(await testUpstreamSource(c.env, Number(c.req.param('id'))))
);

upstreamAdminRoutes.post('/:id/balance', async (c) =>
  c.json(await refreshUpstreamSourceBalance(c.env, Number(c.req.param('id'))))
);

upstreamAdminRoutes.post('/:id/sync', async (c) =>
  c.json(await syncUpstreamSource(c.env, Number(c.req.param('id')), 'manual'))
);

upstreamAdminRoutes.get('/:id/items', async (c) =>
  c.json(await listUpstreamSourceItems(c.env, Number(c.req.param('id'))))
);

upstreamAdminRoutes.put('/items/:itemId', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof mutateUpstreamItem>[2];
  return c.json(await mutateUpstreamItem(c.env, Number(c.req.param('itemId')), body));
});

// SKU 级多上游路由绑定 CRUD 与预拉囤货
function parseProductScope(raw: string | undefined) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw Errors.validation('请提供有效的商品编号');
  return id;
}

upstreamAdminRoutes.get('/bindings/list', async (c) => {
  const rawPid = c.req.query('product_id');
  return c.json(
    await listUpstreamBindings(c.env, rawPid === undefined ? undefined : parseProductScope(rawPid))
  );
});

upstreamAdminRoutes.post('/bindings', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json(await upsertUpstreamBinding(c.env, body));
});

upstreamAdminRoutes.put('/bindings/:bindingId', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json(
    await updateUpstreamBinding(
      c.env,
      Number(c.req.param('bindingId')),
      parseProductScope(c.req.query('product_id')),
      body
    )
  );
});

upstreamAdminRoutes.delete('/bindings/:bindingId', async (c) =>
  c.json(
    await deleteUpstreamBinding(
      c.env,
      Number(c.req.param('bindingId')),
      parseProductScope(c.req.query('product_id'))
    )
  )
);

upstreamAdminRoutes.post('/bindings/:bindingId/pull-cards', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { quantity?: number };
  try {
    const res = await pullUpstreamCardsToLocalStock(c.env, {
      bindingId: Number(c.req.param('bindingId')),
      quantity: Number(body.quantity || 5),
      originUrl: new URL(c.req.url).origin,
    });
    return c.json({ ok: true, ...res });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '预拉卡密失败' }, 400);
  }
});

// 采购台账、主动查单、异常单换源重试、人工补发、异常退款与售后换新
upstreamAdminRoutes.get('/orders/ledger', async (c) => c.json(await getUpstreamOrdersLedger(c.env)));

upstreamAdminRoutes.post('/orders/:upOrderId/poll', async (c) => {
  try {
    const res = await pollSingleUpstreamOrder(
      c.env,
      Number(c.req.param('upOrderId')),
      new URL(c.req.url).origin
    );
    return c.json({ ok: true, ...res });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '主动查单失败' }, 400);
  }
});

upstreamAdminRoutes.post('/local-orders/:orderNo/retry', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { source_id?: number };
  return c.json(
    await retryLocalOrderProcurement(
      c.env,
      c.req.param('orderNo'),
      body.source_id ? Number(body.source_id) : undefined,
      new URL(c.req.url).origin
    )
  );
});

upstreamAdminRoutes.post('/local-orders/:orderNo/manual-fulfill', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    cards_text?: string;
    upstream_order_no?: string;
    upstream_cost?: number;
  };
  return c.json(
    await manualFulfillLocalOrder(c.env, c.req.param('orderNo'), body, new URL(c.req.url).origin)
  );
});

upstreamAdminRoutes.post('/local-orders/:orderNo/refund-balance', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { walletCompensation?: boolean } | null;
  try {
    const res = await refundFailedOrderToUserBalance(
      c.env,
      c.req.param('orderNo'),
      body?.walletCompensation === true
    );
    return c.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof AppError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

upstreamAdminRoutes.post('/tickets/:ticketId/replace-via-upstream', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    quantity?: number;
    source_id?: number;
    note?: string;
  };
  try {
    const res = await procureAfterSaleReplacementForTicket(c.env, {
      ticketId: Number(c.req.param('ticketId')),
      quantity: body.quantity ? Number(body.quantity) : 1,
      specificSourceId: body.source_id ? Number(body.source_id) : undefined,
      note: body.note,
      originUrl: new URL(c.req.url).origin,
    });
    return c.json(res);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : '上游补采换新失败' }, 400);
  }
});

upstreamAdminRoutes.post('/tickets/:ticketId/retry-replacement-email', async (c) => {
  const res = await sendReplacementMail(
    c.env,
    Number(c.req.param('ticketId')),
    new URL(c.req.url).origin,
    true
  );
  return c.json(res);
});
