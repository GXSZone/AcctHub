import {
  conciergeMatchInputSchema,
  restockSubscribeInputSchema,
  storefrontProductParamSchema,
  storefrontProductsQuerySchema,
  validateCouponInputSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { withEdgeCache } from '../../infra/security';
import { parseJsonBody, parseQueryParams, parseRouteParams } from '../../middleware/validate.middleware';
import {
  getStorefrontBootstrap,
  getStorefrontProductDetail,
  listHelpArticles,
  listStorefrontProducts,
  matchConciergeProducts,
  subscribeRestockAlert,
  validateCheckoutCoupon,
} from './storefront.service';

export const storefrontRoutes = new Hono<AppBindings>();

storefrontRoutes.get('/bootstrap', async (c) => {
  const tenant = c.get('tenant');
  if (tenant.isSuspended) {
    return c.json({ error: '当前代理分站已暂停营业' }, 403);
  }
  return withEdgeCache(c, 15, () => getStorefrontBootstrap(c.env, tenant));
});

storefrontRoutes.get('/products', async (c) => {
  const tenant = c.get('tenant');
  if (tenant.isSuspended) {
    return c.json({ error: '当前代理分站已暂停营业' }, 403);
  }
  const query = parseQueryParams(c, storefrontProductsQuerySchema);
  return withEdgeCache(c, 10, () => listStorefrontProducts(c.env, tenant, query));
});

storefrontRoutes.get('/products/:idOrSlug', async (c) => {
  const { idOrSlug } = parseRouteParams(c, storefrontProductParamSchema);
  const accessCode = (c.req.query('access_code') || c.req.header('X-Product-Access-Code') || '').trim();
  const result = await getStorefrontProductDetail(c.env, c.get('tenant'), idOrSlug, accessCode);
  return c.json(result);
});

storefrontRoutes.post('/concierge/match', async (c) => {
  const input = await parseJsonBody(c, conciergeMatchInputSchema);
  const result = await matchConciergeProducts(c.env, c.get('tenant'), input.prompt);
  return c.json(result);
});

storefrontRoutes.get('/help', async (c) => {
  const result = await listHelpArticles(c.env, c.get('tenant'));
  return c.json(result);
});

storefrontRoutes.post('/coupons/validate', async (c) => {
  const input = await parseJsonBody(c, validateCouponInputSchema);
  const result = await validateCheckoutCoupon(c.env, c.get('tenant'), input);
  return c.json(result);
});

storefrontRoutes.post('/restock-subscribe', async (c) => {
  const input = await parseJsonBody(c, restockSubscribeInputSchema);
  const result = await subscribeRestockAlert(c.env, c.get('tenant'), input);
  return c.json(result);
});
