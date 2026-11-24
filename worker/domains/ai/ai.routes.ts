import { aiOptimizeProductInputSchema, updateAiConfigInputSchema } from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { parseJsonBody } from '../../middleware/validate.middleware';
import { getAiConfigPublic, optimizeProductWithAi, saveAiConfigPublic, testAiConnection } from './ai.service';

export const aiAdminRoutes = new Hono<AppBindings>();

aiAdminRoutes.get('/config', async (c) => {
  return c.json({ config: await getAiConfigPublic(c.env) });
});

aiAdminRoutes.put('/config', async (c) => {
  const body = await parseJsonBody(c, updateAiConfigInputSchema);
  return c.json({ ok: true, config: await saveAiConfigPublic(c.env, body) });
});

aiAdminRoutes.post('/test', async (c) => {
  return c.json(await testAiConnection(c.env));
});

aiAdminRoutes.post('/optimize-product', async (c) => {
  const body = await parseJsonBody(c, aiOptimizeProductInputSchema);
  const result = await optimizeProductWithAi(c.env, body);
  return c.json({ ok: true, ...result });
});
