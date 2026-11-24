import {
  adminAuditLogsQuerySchema,
  adminAuthorizeDomainSchema,
  adminSaasPolicySchema,
  positiveIntIdParamSchema,
} from '@shared/index';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../../env';
import { buildAdminAuditCsv, queryAdminAuditLogs } from '../../infra/audit';
import { Errors } from '../../infra/errors';
import { parseJsonBody, parseQueryParams, parseRouteParams } from '../../middleware/validate.middleware';
import {
  buildFinanceReconciliationCsv,
  getAdminCashflows,
  getFinanceReconciliation,
} from '../finance/finance.service';
import { syncLiveExchangeRates } from '../payment/payment.fx';
import { getOrderRefund, getRefundPolicy, saveRefundPolicy } from '../refund/refund.service';
import { adminAuthorizeDomain, listAdminDomains } from '../tenant/domain-auth.service';
import {
  createCategory,
  createCategoryGroup,
  deleteAdminDownlinePopupHistory,
  deleteCategory,
  deleteCategoryGroup,
  getAdminOverview,
  getAdminSaasPolicy,
  reorderCategories,
  reorderCategoryGroups,
  updateAdminSaasPolicy,
  updateCategory,
  updateCategoryGroup,
  updateSaasConfig,
  updateSiteSettings,
} from './admin.catalog.service';
import { adminMembersRoutes } from './admin.members.routes';
import {
  createAdminAgentTier,
  createAdminCoupon,
  deleteAdminAgentTier,
  deleteAdminCdk,
  deleteAdminCoupon,
  generateAdminCdks,
  previewAdminAgentTierLoss,
  refundAdminOrder,
  reviewAgentWithdrawal,
  updateAdminAgent,
  updateAdminAgentTier,
  updateAdminCoupon,
} from './admin.ops.service';
import { adminOrdersCardsRoutes } from './admin.orders-cards.routes';
import {
  createAdminProduct,
  deleteAdminProduct,
  deleteAdminProductCard,
  importAdminProductCards,
  listAdminProductCards,
  updateAdminProduct,
} from './admin.product.service';
import {
  createAdminAnnouncement,
  createAdminHelpArticle,
  deleteAdminAnnouncement,
  deleteAdminHelpArticle,
  getAdminMailConfig,
  getAdminTicketDetail,
  replyAdminTicket,
  resendAdminOrderEmail,
  saveAdminMailConfig,
  sendAdminMailTest,
  sendAdminNotifyTest,
  updateAdminAnnouncement,
  updateAdminHelpArticle,
  updateAdminNotifyConfig,
  updateAdminPaymentPlugin,
  updateAdminTicketStatus,
} from './admin.support.service';

export const adminRoutes = new Hono<AppBindings>();

// 概览与基础/SaaS 配置
adminRoutes.get('/overview', async (c) => c.json(await getAdminOverview(c.env)));

adminRoutes.put('/settings', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  return c.json(await updateSiteSettings(c.env, body));
});

adminRoutes.delete('/downline-popup-history/:historyId', async (c) =>
  c.json(await deleteAdminDownlinePopupHistory(c.env, c.req.param('historyId')))
);

adminRoutes.put('/saas-config', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof updateSaasConfig>[1];
  return c.json(await updateSaasConfig(c.env, body));
});

// 一级大类与二级分类 CRUD
adminRoutes.post('/groups', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof createCategoryGroup>[1];
  return c.json(await createCategoryGroup(c.env, body));
});

adminRoutes.put('/groups/reorder', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ordered_ids?: number[] };
  return c.json(await reorderCategoryGroups(c.env, Array.isArray(body.ordered_ids) ? body.ordered_ids : []));
});

adminRoutes.put('/groups/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateCategoryGroup>[2];
  return c.json(await updateCategoryGroup(c.env, Number(c.req.param('id')), body));
});

adminRoutes.delete('/groups/:id', async (c) =>
  c.json(await deleteCategoryGroup(c.env, Number(c.req.param('id'))))
);

adminRoutes.post('/categories', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof createCategory>[1];
  return c.json(await createCategory(c.env, body));
});

adminRoutes.put('/categories/reorder', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ordered_ids?: number[] };
  return c.json(await reorderCategories(c.env, Array.isArray(body.ordered_ids) ? body.ordered_ids : []));
});

adminRoutes.put('/categories/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateCategory>[2];
  return c.json(await updateCategory(c.env, Number(c.req.param('id')), body));
});

adminRoutes.delete('/categories/:id', async (c) =>
  c.json(await deleteCategory(c.env, Number(c.req.param('id'))))
);

// 商品与卡密库管理
adminRoutes.post('/products', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const res = await createAdminProduct(c.env, body);
  return c.json(res.body, res.status as ContentfulStatusCode);
});

adminRoutes.put('/products/:id', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  const res = await updateAdminProduct(c.env, Number(c.req.param('id')), body);
  return c.json(res.body, res.status as ContentfulStatusCode);
});

adminRoutes.delete('/products/:id', async (c) =>
  c.json(await deleteAdminProduct(c.env, Number(c.req.param('id'))))
);

adminRoutes.get('/products/:id/cards', async (c) =>
  c.json(await listAdminProductCards(c.env, Number(c.req.param('id'))))
);

adminRoutes.delete('/cards/:cardId', async (c) =>
  c.json(await deleteAdminProductCard(c.env, Number(c.req.param('cardId'))))
);

adminRoutes.post('/products/:id/cards', async (c) => {
  const body = (await c.req.json()) as {
    spec_id?: string;
    lines?: string;
    is_loop?: boolean;
    dedupe?: boolean;
  };
  const data = await importAdminProductCards(c.env, Number(c.req.param('id')), body, (job) => {
    try {
      c.executionCtx?.waitUntil(job);
    } catch {
      void job;
    }
  });
  return c.json(data);
});

// 公告与帮助中心 CRUD
adminRoutes.post('/announcements', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof createAdminAnnouncement>[1];
  return c.json(await createAdminAnnouncement(c.env, body));
});

adminRoutes.put('/announcements/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateAdminAnnouncement>[2];
  return c.json(await updateAdminAnnouncement(c.env, Number(c.req.param('id')), body));
});

adminRoutes.delete('/announcements/:id', async (c) =>
  c.json(await deleteAdminAnnouncement(c.env, Number(c.req.param('id'))))
);

adminRoutes.post('/help', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof createAdminHelpArticle>[1];
  return c.json(await createAdminHelpArticle(c.env, body));
});

adminRoutes.put('/help/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateAdminHelpArticle>[2];
  return c.json(await updateAdminHelpArticle(c.env, Number(c.req.param('id')), body));
});

adminRoutes.delete('/help/:id', async (c) =>
  c.json(await deleteAdminHelpArticle(c.env, Number(c.req.param('id'))))
);

// 代理管理、等级防亏与 SaaS 域名授权
adminRoutes.put('/agents/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateAdminAgent>[2];
  return c.json(await updateAdminAgent(c.env, Number(c.req.param('id')), body));
});

// SaaS 多租户域名授权与全局多租户开关策略
adminRoutes.get('/domains', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await listAdminDomains(c.env, c.req.query('status')));
});

adminRoutes.post('/domains/:id/authorize', async (c) => {
  const { id } = parseRouteParams(c, positiveIntIdParamSchema);
  const body = await parseJsonBody(c, adminAuthorizeDomainSchema);
  const adminUser = c.get('user');
  return c.json(await adminAuthorizeDomain(c.env, adminUser?.id ?? 0, id, body));
});

adminRoutes.get('/saas-policy', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getAdminSaasPolicy(c.env));
});

adminRoutes.put('/saas-policy', async (c) => {
  const body = await parseJsonBody(c, adminSaasPolicySchema);
  return c.json(await updateAdminSaasPolicy(c.env, body));
});

adminRoutes.get('/agent-tiers/loss-preview', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(
    await previewAdminAgentTierLoss(c.env, {
      code: c.req.query('code'),
      discountRate: c.req.query('discount_rate'),
    })
  );
});

adminRoutes.get('/agent-tiers/:id/loss-preview', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(
    await previewAdminAgentTierLoss(c.env, {
      id: Number(c.req.param('id')),
      discountRate: c.req.query('discount_rate'),
    })
  );
});

adminRoutes.post('/agent-tiers', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof createAdminAgentTier>[1];
  const res = await createAdminAgentTier(c.env, body);
  return c.json(res.body, res.status as ContentfulStatusCode);
});

adminRoutes.put('/agent-tiers/:id', async (c) => {
  const body = (await c.req.json()) as Parameters<typeof updateAdminAgentTier>[2];
  const res = await updateAdminAgentTier(c.env, Number(c.req.param('id')), body);
  return c.json(res.body, res.status as ContentfulStatusCode);
});

adminRoutes.delete('/agent-tiers/:id', async (c) =>
  c.json(await deleteAdminAgentTier(c.env, Number(c.req.param('id'))))
);

// 订单退款、提现审核、优惠券与 CDK
adminRoutes.get('/refund-policy', async (c) => c.json(await getRefundPolicy(c.env)));

adminRoutes.put('/refund-policy', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown } | null;
  return c.json(await saveRefundPolicy(c.env, body?.mode));
});

adminRoutes.get('/orders/:orderNo/refund', async (c) =>
  c.json(await getOrderRefund(c.env, c.req.param('orderNo')))
);

adminRoutes.post('/orders/:orderNo/refund', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Parameters<typeof refundAdminOrder>[2] | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Errors.validation('退款请求格式无效');
  return c.json(await refundAdminOrder(c.env, c.req.param('orderNo'), body));
});

adminRoutes.put('/withdrawals/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof reviewAgentWithdrawal>[2];
  return c.json(await reviewAgentWithdrawal(c.env, Number(c.req.param('id')), body));
});

adminRoutes.post('/coupons', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof createAdminCoupon>[1];
  return c.json(await createAdminCoupon(c.env, body));
});

adminRoutes.put('/coupons/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { is_active?: number };
  return c.json(await updateAdminCoupon(c.env, Number(c.req.param('id')), body.is_active));
});

adminRoutes.delete('/coupons/:id', async (c) =>
  c.json(await deleteAdminCoupon(c.env, Number(c.req.param('id'))))
);

adminRoutes.post('/cdks/generate', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof generateAdminCdks>[1];
  return c.json(await generateAdminCdks(c.env, body));
});

adminRoutes.delete('/cdks/:id', async (c) => c.json(await deleteAdminCdk(c.env, Number(c.req.param('id')))));

// 工单总控、运营通知、发卡邮箱与支付插件
adminRoutes.get('/tickets/:id', async (c) =>
  c.json(await getAdminTicketDetail(c.env, Number(c.req.param('id'))))
);

adminRoutes.post('/tickets/:id/reply', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof replyAdminTicket>[2];
  return c.json(await replyAdminTicket(c.env, Number(c.req.param('id')), body));
});

adminRoutes.put('/tickets/:id/status', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: string };
  return c.json(await updateAdminTicketStatus(c.env, Number(c.req.param('id')), body.status));
});

adminRoutes.put('/notify-config', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof updateAdminNotifyConfig>[1];
  return c.json(await updateAdminNotifyConfig(c.env, body));
});

adminRoutes.post('/notify-test', async (c) => c.json(await sendAdminNotifyTest(c.env)));

adminRoutes.get('/mail-config', async (c) => c.json(await getAdminMailConfig(c.env)));

adminRoutes.put('/mail-config', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json(await saveAdminMailConfig(c.env, body));
});

adminRoutes.post('/mail-test', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { to_email?: string };
  return c.json(await sendAdminMailTest(c.env, body.to_email || ''));
});

adminRoutes.post('/orders/:orderNo/resend-email', async (c) =>
  c.json(await resendAdminOrderEmail(c.env, c.req.param('orderNo'), new URL(c.req.url).origin))
);

adminRoutes.put('/payment-plugins/:id', async (c) => {
  const body = (await c.req.json()) as { enabled?: boolean; config?: Record<string, string> };
  return c.json(await updateAdminPaymentPlugin(c.env, c.req.param('id'), body));
});

adminRoutes.post('/payment-plugins/sync-fx', async (c) =>
  c.json(await syncLiveExchangeRates(c.env, { force: true }))
);

// 财务对账中心、全店资金流水与 CSV 明细导出
adminRoutes.get('/finance/reconciliation', async (c) =>
  c.json(await getFinanceReconciliation(c.env, c.req.query('days')))
);

adminRoutes.get('/finance/cashflows', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await getAdminCashflows(c.env));
});

adminRoutes.get('/finance/reconciliation/csv', async (c) => {
  const { filename, csvBody } = await buildFinanceReconciliationCsv(c.env, c.req.query('days'));
  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// 全站会员管理、拉黑/删除、重置密码与人工余额调账子路由
adminRoutes.route('/members', adminMembersRoutes);

// 订单高级检索/详情/风控放行/人工发货补单 + 卡密反查/导出 TXT 子路由
adminRoutes.route('/', adminOrdersCardsRoutes);

// 运营总控敏感操作审计日志查询与 CSV 导出
adminRoutes.get('/audit-logs', async (c) => {
  const query = parseQueryParams(c, adminAuditLogsQuerySchema);
  const logs = await queryAdminAuditLogs(c.get('db'), query);
  return c.json({ logs });
});

adminRoutes.get('/audit-logs/csv', async (c) => {
  const query = parseQueryParams(c, adminAuditLogsQuerySchema);
  const logs = await queryAdminAuditLogs(c.get('db'), { ...query, limit: 200 });
  const csvBody = buildAdminAuditCsv(logs);
  return new Response(csvBody, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="accthub-admin-audit-logs.csv"',
    },
  });
});
