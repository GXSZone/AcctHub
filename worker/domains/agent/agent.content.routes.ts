import {
  agentCouponCreateSchema,
  agentHelpArticleSchema,
  agentSitePreferencesSchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseRouteParams } from '../../middleware/validate.middleware';
import { resolveAgentTargetOrigin } from '../auth/sso.service';
import { requireActiveAgent } from './agent.guard';
import {
  createAgentCoupon,
  createAgentHelpArticle,
  deleteAgentCoupon,
  deleteAgentHelpArticle,
  getAgentSitePreferences,
  listAgentCoupons,
  listAgentHelpArticles,
  toggleAgentCoupon,
  updateAgentHelpArticle,
  updateAgentSitePreferences,
} from './agent.tenant-content.service';

export const agentContentRoutes = new Hono<AppBindings>();

const couponToggleSchema = z.object({ is_active: z.boolean() });
const helpArticleUpdateSchema = agentHelpArticleSchema.partial();

// 跨站只读入口：允许在主站域名查询自己的分站权威域名以便发起 SSO 一键免登
agentContentRoutes.get('/my-store-entry', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'), { allowMainHost: true });
  let targetOrigin: string | null = null;
  try {
    targetOrigin = await resolveAgentTargetOrigin(c.env, c.req.raw, {
      id: ctx.agent.id,
      slug: ctx.agent.slug,
    });
  } catch {
    targetOrigin = null;
  }
  return c.json({
    agent_id: ctx.agent.id,
    slug: ctx.agent.slug,
    brand_name: ctx.agent.brand_name,
    target_origin: targetOrigin,
  });
});

// 分站独立扩展设置（前台 API 文档显隐 / 帮助中心是否继承平台通用文章）
agentContentRoutes.get('/site-settings', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getAgentSitePreferences(c.env, ctx));
});

agentContentRoutes.put('/site-settings', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentSitePreferencesSchema);
  return c.json(await updateAgentSitePreferences(c.env, ctx, body));
});

// 分站专属优惠券管理
agentContentRoutes.get('/coupons', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentCoupons(c.env, ctx));
});

agentContentRoutes.post('/coupons', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentCouponCreateSchema);
  return c.json(await createAgentCoupon(c.env, ctx, body), 201);
});

agentContentRoutes.put('/coupons/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, couponToggleSchema);
  return c.json(await toggleAgentCoupon(c.env, ctx, id, body.is_active));
});

agentContentRoutes.delete('/coupons/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAgentCoupon(c.env, ctx, id));
});

// 分站专属帮助中心文章管理
agentContentRoutes.get('/help', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentHelpArticles(c.env, ctx));
});

agentContentRoutes.post('/help', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentHelpArticleSchema);
  return c.json(await createAgentHelpArticle(c.env, ctx, body), 201);
});

agentContentRoutes.put('/help/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, helpArticleUpdateSchema);
  return c.json(await updateAgentHelpArticle(c.env, ctx, id, body));
});

agentContentRoutes.delete('/help/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAgentHelpArticle(c.env, ctx, id));
});
