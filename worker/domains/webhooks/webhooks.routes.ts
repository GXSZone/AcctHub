import {
  createOutboundWebhookSchema,
  externalFulfillCallbackSchema,
  positiveIntIdParamSchema,
  updateOutboundWebhookSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { AppBindings } from '../../env';
import { Errors } from '../../infra/errors';
import { parseJsonBody, parseRouteParams } from '../../middleware/validate.middleware';
import {
  createAdminWebhook,
  deleteAdminWebhook,
  handleExternalFulfillCallback,
  listAdminWebhooks,
  testAdminWebhook,
  updateAdminWebhook,
} from './webhooks.service';

export const webhooksAdminRoutes = new Hono<AppBindings>();
export const webhooksInboundRoutes = new Hono<AppBindings>();

webhooksAdminRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await listAdminWebhooks(c.env));
});

webhooksAdminRoutes.post('/', async (c) => {
  const body = await parseJsonBody(c, createOutboundWebhookSchema);
  return c.json(await createAdminWebhook(c.env, body), 201);
});

webhooksAdminRoutes.put('/:id', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, updateOutboundWebhookSchema);
  return c.json(await updateAdminWebhook(c.env, id, body));
});

webhooksAdminRoutes.delete('/:id', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAdminWebhook(c.env, id));
});

webhooksAdminRoutes.post('/:id/test', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await testAdminWebhook(c.env, id));
});

/** 外部系统自动开通完成后的 HMAC 签名凭证回填回调 */
webhooksInboundRoutes.post('/fulfill-callback', async (c) => {
  const rawBody = await c.req.text();
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw Errors.validation('无效的 JSON 请求体');
  }
  const parsed = externalFulfillCallbackSchema.safeParse(json);
  if (!parsed.success) {
    throw Errors.validation(parsed.error.issues[0]?.message || '请求参数无效');
  }
  return c.json(await handleExternalFulfillCallback(c.env, c.req.raw, rawBody, parsed.data));
});
