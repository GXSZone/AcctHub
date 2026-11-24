import {
  agentPaymentPluginUpdateSchema,
  agentPrivateCardsImportSchema,
  agentPrivateProductInputSchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseRouteParams } from '../../middleware/validate.middleware';
import {
  listAgentPaymentPlugins,
  retryAgentOrderFunding,
  updateAgentPaymentPlugin,
} from '../payment/tenant-payment.service';
import { requireActiveAgent } from './agent.guard';
import {
  createAgentPrivateProduct,
  deleteAgentPrivateCard,
  deleteAgentPrivateProduct,
  importAgentPrivateCards,
  listAgentPrivateCards,
  listAgentPrivateProducts,
  updateAgentPrivateProduct,
} from './agent-catalog.service';

export const agentCatalogRoutes = new Hono<AppBindings>();

const updatePrivateProductSchema = agentPrivateProductInputSchema.partial();

agentCatalogRoutes.get('/private-products', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentPrivateProducts(c.env, ctx));
});

agentCatalogRoutes.post('/private-products', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentPrivateProductInputSchema);
  return c.json(await createAgentPrivateProduct(c.env, ctx, body), 201);
});

agentCatalogRoutes.put('/private-products/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, updatePrivateProductSchema);
  return c.json(await updateAgentPrivateProduct(c.env, ctx, id, body));
});

agentCatalogRoutes.delete('/private-products/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAgentPrivateProduct(c.env, ctx, id));
});

agentCatalogRoutes.get('/private-products/:id/cards', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await listAgentPrivateCards(c.env, ctx, id));
});

agentCatalogRoutes.post('/private-products/:id/cards', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, agentPrivateCardsImportSchema);
  return c.json(await importAgentPrivateCards(c.env, ctx, id, body), 201);
});

agentCatalogRoutes.delete('/private-cards/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAgentPrivateCard(c.env, ctx, id));
});

const pluginIdParamSchema = z.object({ pluginId: z.string().trim().min(2).max(40) });
const retryOrderNoParamSchema = z.object({ orderNo: z.string().trim().min(3).max(64) });

// Phase 4：分站自有收款通道配置与待补款订单补扣发卡
agentCatalogRoutes.get('/payment-plugins', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentPaymentPlugins(c.env, ctx));
});

agentCatalogRoutes.put('/payment-plugins/:pluginId', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { pluginId } = parseRouteParams(c, pluginIdParamSchema);
  const body = await parseJsonBody(c, agentPaymentPluginUpdateSchema);
  return c.json(await updateAgentPaymentPlugin(c.env, ctx, pluginId, body));
});

agentCatalogRoutes.post('/orders/:orderNo/retry-funding', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { orderNo } = parseRouteParams(c, retryOrderNoParamSchema);
  return c.json(await retryAgentOrderFunding(c.env, ctx, orderNo, new URL(c.req.url).origin));
});
