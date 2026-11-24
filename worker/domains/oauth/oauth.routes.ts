import {
  adminOAuthConfigUpdateSchema,
  oauthExchangeInputSchema,
  oauthProviderSchema,
  oauthStartInputSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody } from '../../middleware/validate.middleware';
import {
  exchangeOAuthTicket,
  getSiteOAuthConfig,
  handleOAuthCallback,
  listMyOAuthBindings,
  listPublicOAuthProviders,
  startOAuthAuthorize,
  unbindMyOAuthIdentity,
  updateSiteOAuthConfig,
} from './oauth.service';

export const oauthPublicRoutes = new Hono<AppBindings>();
export const oauthAdminRoutes = new Hono<AppBindings>();

oauthPublicRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

oauthPublicRoutes.get('/providers', async (c) =>
  c.json(await listPublicOAuthProviders(c.env, c.get('tenant')))
);

oauthPublicRoutes.post('/start', async (c) => {
  const body = await parseJsonBody(c, oauthStartInputSchema);
  return c.json(await startOAuthAuthorize(c.env, c.req.raw, c.get('tenant'), body));
});

oauthPublicRoutes.get('/:provider/callback', async (c) => {
  const parsed = oauthProviderSchema.safeParse(c.req.param('provider'));
  if (!parsed.success) return c.text('Unsupported OAuth provider', 400);
  const code = (c.req.query('code') || '').trim();
  const state = (c.req.query('state') || '').trim();
  if (!code || !state) {
    const errDesc = c.req.query('error_description') || c.req.query('error') || '授权已取消';
    const fallback = new URL('/oauth/callback', new URL(c.req.url).origin);
    fallback.searchParams.set('error', errDesc);
    return c.redirect(fallback.toString(), 302);
  }
  const redirectUrl = await handleOAuthCallback(c.env, c.req.raw, c.get('tenant'), parsed.data, code, state);
  return c.redirect(redirectUrl, 302);
});

oauthPublicRoutes.post('/exchange', async (c) => {
  const body = await parseJsonBody(c, oauthExchangeInputSchema);
  return c.json(await exchangeOAuthTicket(c.env, c.req.raw, c.get('tenant'), body.ticket));
});

oauthPublicRoutes.get('/bindings', async (c) =>
  c.json(await listMyOAuthBindings(c.env, c.req.raw, c.get('tenant')))
);

oauthPublicRoutes.delete('/bindings/:provider', async (c) => {
  const provider = oauthProviderSchema.parse(c.req.param('provider'));
  return c.json(await unbindMyOAuthIdentity(c.env, c.req.raw, c.get('tenant'), provider));
});

oauthAdminRoutes.get('/config', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getSiteOAuthConfig(c.env, 0));
});

oauthAdminRoutes.put('/config', async (c) => {
  const body = await parseJsonBody(c, adminOAuthConfigUpdateSchema);
  const adminUser = c.get('user');
  return c.json(
    await updateSiteOAuthConfig(c.env, 0, body, {
      actorUserId: adminUser?.id ?? 0,
      actorEmail: adminUser?.email ?? 'admin',
      actorRole: adminUser?.role ?? 'admin',
      ip: c.req.header('CF-Connecting-IP') || '',
      userAgent: c.req.header('User-Agent') || '',
    })
  );
});
