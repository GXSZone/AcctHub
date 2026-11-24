import {
  adminOAuthConfigUpdateSchema,
  agentAffiliateConfigSchema,
  agentAnnouncementInputSchema,
  agentAnnouncementUpdateSchema,
  agentApiWhitelistSchema,
  agentBatchPricingSchema,
  agentBrandUpdateSchema,
  agentDownlineUpdateSchema,
  agentMailTestSchema,
  agentProductOverrideSchema,
  agentRechargeInputSchema,
  agentSinglePricingSchema,
  agentTicketEscalateSchema,
  agentTicketReplySchema,
  agentTierUpsertSchema,
  agentWithdrawalInputSchema,
  bindTenantDomainSchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../env';
import { parseJsonBody, parseRouteParams } from '../../middleware/validate.middleware';
import { getSiteAffiliateConfig, updateSiteAffiliateConfig } from '../account/affiliate.service';
import { getSiteOAuthConfig, updateSiteOAuthConfig } from '../oauth/oauth.service';
import {
  bindAgentDomain,
  deleteAgentDomain,
  listAgentDomains,
  setPrimaryAgentDomain,
  verifyAgentDomainById,
} from '../tenant/domain-auth.service';
import {
  checkAgentSlugForRequest,
  rotateAgentApiKey,
  updateAgentApiWhitelist,
  updateAgentStorefrontBrand,
} from './agent.brand.service';
import { agentCatalogRoutes } from './agent.catalog.routes';
import { agentContentRoutes } from './agent.content.routes';
import {
  createAgentWithdrawal,
  createMyDownlineTier,
  deleteMyDownlineTier,
  listAgentWithdrawals,
  listMyDownlineTiers,
  updateDirectDownline,
  updateMyDownlineTier,
} from './agent.downline.service';
import { requireActiveAgent } from './agent.guard';
import {
  createAgentAnnouncement,
  deleteAgentAnnouncement,
  deleteAgentDownlinePopupHistory,
  escalateAgentTicket,
  getAgentMailConfig,
  getAgentNoticesCenter,
  getAgentTicketDetail,
  listAgentTickets,
  replyAgentTicket,
  resendAgentOrderEmail,
  saveAgentMailConfig,
  sendAgentTestMail,
  updateAgentAnnouncement,
  updateAgentNoticeSettings,
} from './agent.ops.service';
import { agentOrdersMembersRoutes } from './agent.orders-members.routes';
import {
  batchUpdateAgentPricing,
  getAgentPricingMatrix,
  resetAgentProductOverride,
  setAgentSinglePrice,
  upsertAgentProductOverride,
} from './agent.pricing.service';
import {
  getAgentWorkbenchBootstrap,
  listPublicStorefrontTiers,
  rechargeAgentTier,
} from './agent.store.service';

export const agentRoutes = new Hono<AppBindings>();

const idParamSchema = z.object({ id: z.coerce.number().int().positive('无效的 ID 参数') });
const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive('无效的商品 ID'),
});
const downlineIdParamSchema = z.object({
  downlineId: z.coerce.number().int().positive('无效的下级 ID'),
});
const orderNoParamSchema = z.object({ orderNo: z.string().trim().min(1, '订单号不能为空') });
const downlineTierCreateSchema = agentTierUpsertSchema.extend({
  min_recharge: z.coerce.number().min(0).optional(),
  discount_rate: z.coerce.number().optional(),
  level_rank: z.coerce.number().int().min(1).max(99).optional(),
});
const downlineTierUpdateSchema = downlineTierCreateSchema.partial();

// 公开：查询当前站点招募的代理等级列表
agentRoutes.get('/tiers', async (c) => {
  const data = await listPublicStorefrontTiers(c.env, c.get('tenant'));
  return c.json(data);
});

agentRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

// 代理工作台全量数据引导（支持未开通与已开通状态）
agentRoutes.get('/me', async (c) => {
  const data = await getAgentWorkbenchBootstrap(c.env, c.req.raw, c.get('tenant'));
  return c.json(data);
});

// 代理开通/补差升级
agentRoutes.post('/recharge', async (c) => {
  const body = await parseJsonBody(c, agentRechargeInputSchema);
  const data = await rechargeAgentTier(c.env, c.req.raw, c.get('tenant'), body);
  return c.json(data);
});

// 免费二级域名前缀实时可用性检测（支持开通前普通会员实时查重）
agentRoutes.get('/check-slug', async (c) => {
  const data = await checkAgentSlugForRequest(c.req.raw, c.env, c.get('tenant'), c.req.query('slug') || '');
  return c.json(data);
});

// 品牌装修与客服配置保存
agentRoutes.put('/brand', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentBrandUpdateSchema);
  const data = await updateAgentStorefrontBrand(c.env, ctx, body as Record<string, unknown>);
  return c.json(data);
});

// 分站公告与上级渠道通知中心
agentRoutes.get('/notices', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getAgentNoticesCenter(c.env, ctx));
});

agentRoutes.put('/notices/settings', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  return c.json(await updateAgentNoticeSettings(c.env, ctx, body));
});

agentRoutes.delete('/notices/popup-history/:historyId', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await deleteAgentDownlinePopupHistory(c.env, ctx, c.req.param('historyId')));
});

agentRoutes.post('/announcements', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentAnnouncementInputSchema);
  return c.json(await createAgentAnnouncement(c.env, ctx, body), 201);
});

agentRoutes.put('/announcements/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  const body = await parseJsonBody(c, agentAnnouncementUpdateSchema);
  return c.json(await updateAgentAnnouncement(c.env, ctx, id, body));
});

agentRoutes.delete('/announcements/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  return c.json(await deleteAgentAnnouncement(c.env, ctx, id));
});

// 分站独立发卡邮箱配置、测试与订单补发
agentRoutes.get('/mail-config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getAgentMailConfig(c.env, ctx));
});

agentRoutes.put('/mail-config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json(await saveAgentMailConfig(c.env, ctx, body));
});

agentRoutes.post('/mail-test', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { to_email } = await parseJsonBody(c, agentMailTestSchema);
  return c.json(await sendAgentTestMail(c.env, ctx, to_email));
});

agentRoutes.post('/orders/:orderNo/resend-email', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { orderNo } = parseRouteParams(c, orderNoParamSchema);
  return c.json(await resendAgentOrderEmail(c.env, ctx, orderNo, new URL(c.req.url).origin));
});

// 独立域名多域绑定、授权状态校验与 API Key 轮换
agentRoutes.get('/domains', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentDomains(c.env, ctx));
});

agentRoutes.post('/domains', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, bindTenantDomainSchema);
  return c.json(await bindAgentDomain(c.env, ctx, body));
});

agentRoutes.put('/domains/:id/primary', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await setPrimaryAgentDomain(c.env, ctx, id));
});

agentRoutes.post('/domains/:id/verify', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await verifyAgentDomainById(c.env, ctx, id));
});

agentRoutes.delete('/domains/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  return c.json(await deleteAgentDomain(c.env, ctx, id));
});

agentRoutes.post('/rotate-key', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await rotateAgentApiKey(c.env, ctx));
});

// 选品改价与单品内容覆写
agentRoutes.get('/pricing', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getAgentPricingMatrix(c.env, ctx));
});

agentRoutes.put('/pricing', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentSinglePricingSchema);
  return c.json(await setAgentSinglePrice(c.env, ctx, body));
});

agentRoutes.post('/pricing/batch', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentBatchPricingSchema);
  return c.json(await batchUpdateAgentPricing(c.env, ctx, body));
});

agentRoutes.put('/products/:productId/override', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { productId } = parseRouteParams(c, productIdParamSchema);
  const body = await parseJsonBody(c, agentProductOverrideSchema);
  return c.json(await upsertAgentProductOverride(c.env, ctx, productId, body));
});

agentRoutes.delete('/products/:productId/override', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { productId } = parseRouteParams(c, productIdParamSchema);
  return c.json(await resetAgentProductOverride(c.env, ctx, productId));
});

// 下级招募等级 CRUD 与直属下级管理
agentRoutes.get('/my-tiers', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listMyDownlineTiers(c.env, ctx));
});

agentRoutes.post('/my-tiers', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, downlineTierCreateSchema);
  return c.json(await createMyDownlineTier(c.env, ctx, body), 201);
});

agentRoutes.put('/my-tiers/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  const body = await parseJsonBody(c, downlineTierUpdateSchema);
  return c.json(await updateMyDownlineTier(c.env, ctx, id, body));
});

agentRoutes.delete('/my-tiers/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  return c.json(await deleteMyDownlineTier(c.env, ctx, id));
});

agentRoutes.put('/downlines/:downlineId', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { downlineId } = parseRouteParams(c, downlineIdParamSchema);
  const body = await parseJsonBody(c, agentDownlineUpdateSchema);
  return c.json(await updateDirectDownline(c.env, ctx, downlineId, body));
});

// 代理收益提现
agentRoutes.get('/withdrawals', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentWithdrawals(c.env, ctx));
});

agentRoutes.post('/withdrawals', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentWithdrawalInputSchema);
  return c.json(await createAgentWithdrawal(c.env, ctx, body), 201);
});

// 分站售后工单管理
agentRoutes.get('/tickets', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await listAgentTickets(c.env, ctx));
});

agentRoutes.get('/tickets/:id', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  return c.json(await getAgentTicketDetail(c.env, ctx, id));
});

agentRoutes.post('/tickets/:id/reply', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  const body = await parseJsonBody(c, agentTicketReplySchema);
  return c.json(await replyAgentTicket(c.env, ctx, id, body));
});

agentRoutes.post('/tickets/:id/escalate', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const { id } = parseRouteParams(c, idParamSchema);
  const body = await parseJsonBody(c, agentTicketEscalateSchema);
  return c.json(await escalateAgentTicket(c.env, ctx, id, body));
});

// B2B API 调用 IP 白名单
agentRoutes.put('/api-whitelist', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentApiWhitelistSchema);
  return c.json(await updateAgentApiWhitelist(c.env, ctx, body.ip_whitelist));
});

// 分站独立「邀请有礼 · 推广消费金」策略配置
agentRoutes.get('/affiliate-config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getSiteAffiliateConfig(c.env, ctx.agent.id));
});

agentRoutes.put('/affiliate-config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, agentAffiliateConfigSchema);
  return c.json(await updateSiteAffiliateConfig(c.env, ctx.agent.id, body));
});

// 分站自有独立第三方 OAuth 授权登录配置（严格按分站 ID 隔离，绝不暴露主站）
agentRoutes.get('/oauth/config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  return c.json(await getSiteOAuthConfig(c.env, ctx.agent.id));
});

agentRoutes.put('/oauth/config', async (c) => {
  const ctx = await requireActiveAgent(c.req.raw, c.env, c.get('tenant'));
  const body = await parseJsonBody(c, adminOAuthConfigUpdateSchema);
  return c.json(await updateSiteOAuthConfig(c.env, ctx.agent.id, body));
});

// 挂接分站扩展配置、优惠券、帮助文档、私有商品、自有卡密及本店订单/会员子路由
agentRoutes.route('/', agentContentRoutes);
agentRoutes.route('/', agentCatalogRoutes);
agentRoutes.route('/', agentOrdersMembersRoutes);
