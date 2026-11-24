import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../../env';
import {
  authenticateResellerKey,
  buildResellerBalancePayload,
  createResellerOrder,
  getResellerCompatCatalog,
  getResellerOrderStatus,
  listResellerProducts,
} from './reseller.service';

// B2B 批发开放接口（/api/v1/reseller/*）：仅支持 Bearer / X-API-Key 请求头、IP 白名单与兼容目录
export const resellerApiRoutes = new Hono<AppBindings>();

resellerApiRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

resellerApiRoutes.get('/balance', async (c) => {
  const authRes = await authenticateResellerKey(c.req.raw, c.env);
  if ('error' in authRes) return c.json({ error: authRes.error }, authRes.status);
  return c.json(buildResellerBalancePayload(authRes.agent));
});

resellerApiRoutes.get('/products', async (c) => {
  const authRes = await authenticateResellerKey(c.req.raw, c.env);
  if ('error' in authRes) return c.json({ error: authRes.error }, authRes.status);
  const data = await listResellerProducts(c.env, authRes.agent);
  return c.json(data);
});

resellerApiRoutes.post('/order', async (c) => {
  const authRes = await authenticateResellerKey(c.req.raw, c.env);
  if ('error' in authRes) return c.json({ error: authRes.error }, authRes.status);

  const body = (await c.req.json().catch(() => ({}))) as {
    product_id?: number;
    spec_id?: string;
    quantity?: number;
    customer_ref?: string;
    idempotency_key?: string;
    out_trade_no?: string;
  };
  const res = await createResellerOrder(
    c.env,
    authRes.agent,
    body,
    c.req.header('Idempotency-Key'),
    new URL(c.req.url).origin
  );
  return c.json(res.body, res.status as ContentfulStatusCode);
});

resellerApiRoutes.get('/order', async (c) => {
  const authRes = await authenticateResellerKey(c.req.raw, c.env);
  if ('error' in authRes) return c.json({ error: authRes.error }, authRes.status);
  const result = await getResellerOrderStatus(c.env, authRes.agent, {
    orderNo: c.req.query('order_no'),
    idempotencyKey: c.req.query('idempotency_key'),
  });
  return c.json(result.body, result.status as ContentfulStatusCode);
});

// 兼容 AcgFaka（异次元）/ Dujiaoka（独角数卡）下游批采对接协议
resellerApiRoutes.get('/compat/catalog', async (c) => {
  const authRes = await authenticateResellerKey(c.req.raw, c.env);
  if ('error' in authRes) {
    return c.json({ code: authRes.status, msg: authRes.error }, authRes.status);
  }
  return c.json(await getResellerCompatCatalog(c.env, authRes.agent));
});
