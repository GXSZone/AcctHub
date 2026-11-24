import {
  ipBlacklistCreateSchema,
  positiveIntIdParamSchema,
  riskControlConfigSchema,
  riskEmergencyModeInputSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseRouteParams } from '../../middleware/validate.middleware';
import {
  addAdminIpBlacklist,
  deleteAdminIpBlacklist,
  getAdminRiskOverview,
  sendAdminRiskTestAlert,
  switchAdminEmergencyMode,
  updateAdminRiskConfig,
} from './risk.service';

export const adminRiskRoutes = new Hono<AppBindings>();

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

adminRiskRoutes.get('/overview', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getAdminRiskOverview(c.env));
});

adminRiskRoutes.put('/config', async (c) => {
  const body = await parseJsonBody(c, riskControlConfigSchema);
  return c.json(await updateAdminRiskConfig(c.env, readActor(c), body));
});

adminRiskRoutes.post('/emergency', async (c) => {
  const body = await parseJsonBody(c, riskEmergencyModeInputSchema);
  return c.json(await switchAdminEmergencyMode(c.env, readActor(c), body.emergency_mode, body.reason));
});

adminRiskRoutes.post('/test-alert', async (c) => {
  return c.json(await sendAdminRiskTestAlert(c.env, readActor(c)));
});

adminRiskRoutes.post('/ip-blacklist', async (c) => {
  const body = await parseJsonBody(c, ipBlacklistCreateSchema);
  return c.json(await addAdminIpBlacklist(c.env, readActor(c), body), 201);
});

adminRiskRoutes.delete('/ip-blacklist/:id', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAdminIpBlacklist(c.env, readActor(c), id));
});
