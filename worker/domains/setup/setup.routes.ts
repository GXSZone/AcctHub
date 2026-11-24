import { setupInitializeInputSchema } from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody } from '../../middleware/validate.middleware';
import { getSetupStatus, initializeSystemSetup } from './setup.service';

export const setupRoutes = new Hono<AppBindings>();

setupRoutes.get('/status', async (c) => c.json(await getSetupStatus(c.env)));

setupRoutes.post('/initialize', async (c) => {
  const input = await parseJsonBody(c, setupInitializeInputSchema);
  return c.json(await initializeSystemSetup(c.env, c.req.raw, input));
});
