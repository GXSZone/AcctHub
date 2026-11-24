import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../env';
import { parseQueryParams } from '../../middleware/validate.middleware';
import { requireActiveAgent } from './agent.guard';
import { listAgentStoreMembers, searchAgentOrders } from './agent.orders-members.service';

export const agentOrdersMembersRoutes = new Hono<AppBindings>();

const agentOrderQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  status: z.string().trim().max(32).optional().default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const agentMemberQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

agentOrdersMembersRoutes.get('/orders', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const query = parseQueryParams(c, agentOrderQuerySchema);
  return c.json(await searchAgentOrders(c.env, ctx, query));
});

agentOrdersMembersRoutes.get('/members', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const query = parseQueryParams(c, agentMemberQuerySchema);
  return c.json(await listAgentStoreMembers(c.env, ctx, query));
});
