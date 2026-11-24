import { admin2FaDisableSchema, admin2FaEnableSchema } from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody } from '../../middleware/validate.middleware';
import { disableAdmin2Fa, enableAdmin2Fa, getAdmin2FaStatus, setupAdmin2Fa } from './admin-2fa.service';

export const admin2FaRoutes = new Hono<AppBindings>();

admin2FaRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

admin2FaRoutes.get('/status', async (c) => {
  const admin = c.get('user');
  return c.json(await getAdmin2FaStatus(c.env, admin?.id ?? 0));
});

admin2FaRoutes.post('/setup', async (c) => {
  const admin = c.get('user');
  return c.json(await setupAdmin2Fa(c.env, admin?.id ?? 0));
});

admin2FaRoutes.post('/enable', async (c) => {
  const admin = c.get('user');
  const body = await parseJsonBody(c, admin2FaEnableSchema);
  return c.json(
    await enableAdmin2Fa(
      c.env,
      admin?.id ?? 0,
      {
        actorUserId: admin?.id ?? 0,
        actorEmail: admin?.email ?? 'admin',
        actorRole: admin?.role ?? 'admin',
        ip: c.req.header('CF-Connecting-IP') || '',
        userAgent: c.req.header('User-Agent') || '',
      },
      body
    )
  );
});

admin2FaRoutes.post('/disable', async (c) => {
  const admin = c.get('user');
  const body = await parseJsonBody(c, admin2FaDisableSchema);
  return c.json(
    await disableAdmin2Fa(
      c.env,
      admin?.id ?? 0,
      {
        actorUserId: admin?.id ?? 0,
        actorEmail: admin?.email ?? 'admin',
        actorRole: admin?.role ?? 'admin',
        ip: c.req.header('CF-Connecting-IP') || '',
        userAgent: c.req.header('User-Agent') || '',
      },
      body
    )
  );
});
