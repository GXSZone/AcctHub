import {
  adminManualConfirmOrderSchema,
  adminOrdersSearchQuerySchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseQueryParams, parseRouteParams } from '../../middleware/validate.middleware';
import {
  approveRiskOrder,
  exportAvailableProductCardsTxt,
  getAdminOrderDetail,
  lookupAdminCardsByContent,
  manualConfirmAdminOrder,
  searchAdminOrders,
} from './admin.orders-cards.service';

export const adminOrdersCardsRoutes = new Hono<AppBindings>();

function readActor(c: {
  get: (key: 'user') => { id: number; email: string; role: string } | null;
  req: { header: (name: string) => string | undefined };
}) {
  const adminUser = c.get('user');
  return {
    actorUserId: adminUser?.id ?? 0,
    actorEmail: adminUser?.email ?? 'admin',
    actorRole: adminUser?.role ?? 'admin',
    ip: c.req.header('CF-Connecting-IP') || '',
    userAgent: c.req.header('User-Agent') || '',
  };
}

adminOrdersCardsRoutes.get('/orders/search', async (c) => {
  c.header('Cache-Control', 'no-store');
  const query = parseQueryParams(c, adminOrdersSearchQuerySchema);
  return c.json(await searchAdminOrders(c.env, query));
});

adminOrdersCardsRoutes.get('/orders/:orderNo/detail', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getAdminOrderDetail(c.env, c.req.param('orderNo')));
});

adminOrdersCardsRoutes.post('/orders/:orderNo/approve-risk', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { note?: string };
  return c.json(
    await approveRiskOrder(c.env, readActor(c), c.req.param('orderNo'), new URL(c.req.url).origin, body.note)
  );
});

adminOrdersCardsRoutes.post('/orders/:orderNo/manual-confirm', async (c) => {
  const body = await parseJsonBody(c, adminManualConfirmOrderSchema);
  return c.json(
    await manualConfirmAdminOrder(
      c.env,
      readActor(c),
      c.req.param('orderNo'),
      new URL(c.req.url).origin,
      body
    )
  );
});

adminOrdersCardsRoutes.get('/cards/lookup', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await lookupAdminCardsByContent(c.env, c.req.query('q') || ''));
});

adminOrdersCardsRoutes.get('/products/:id/cards/export', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const { filename, content } = await exportAvailableProductCardsTxt(c.env, id, c.req.query('spec_id'));
  return new Response(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
