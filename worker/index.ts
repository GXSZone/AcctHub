import { resolveRequestLocale, translateApiErrorMessage } from '@shared/constants/error-codes';
import { Hono } from 'hono';
import { ensureDemoSeeded } from './db/seeds';
import { accountRoutes } from './domains/account/account.routes';
import { recoverPendingAffiliateRewards } from './domains/account/affiliate.service';
import { adminRoutes } from './domains/admin/admin.routes';
import { agentRoutes } from './domains/agent/agent.routes';
import { aiAdminRoutes } from './domains/ai/ai.routes';
import { admin2FaRoutes } from './domains/auth/admin-2fa.routes';
import { authRoutes } from './domains/auth/auth.routes';
import { getAuthUser } from './domains/auth/auth.service';
import { commerceAdminRoutes, commerceStorefrontRoutes } from './domains/commerce/commerce.routes';
import { runScheduledGroupBuyMaintenance } from './domains/commerce/group-buy.service';
import { runScheduledRenewalReminders } from './domains/commerce/renewal.service';
import { oauthAdminRoutes, oauthPublicRoutes } from './domains/oauth/oauth.routes';
import { recoverExpiredBalanceOrders } from './domains/orders/orders.balance-recovery.service';
import { orderRoutes } from './domains/orders/orders.routes';
import { recoverImmediateOrderAborts } from './domains/orders/orders.wallet.repo';
import { paymentRoutes } from './domains/payment/payment.routes';
import { runScheduledPaymentMaintenance } from './domains/payment/payment.service';
import { runScheduledRefundReconciliation } from './domains/refund/refund.service';
import { resellerApiRoutes } from './domains/reseller/reseller.routes';
import { adminRiskRoutes } from './domains/risk/risk.routes';
import { runScheduledFinanceSentinel } from './domains/risk/risk.service';
import { setupRoutes } from './domains/setup/setup.routes';
import { loadMainBrandSettingsForSeoRepo } from './domains/storefront/storefront.repo';
import { storefrontRoutes } from './domains/storefront/storefront.routes';
import { resolveTenantContext } from './domains/tenant/tenant.service';
import { runScheduledUpstreamOrderPoll } from './domains/upstream/upstream.fulfillment.service';
import { upstreamAdminRoutes, upstreamWebhookRoutes } from './domains/upstream/upstream.routes';
import { runScheduledUpstreamSync } from './domains/upstream/upstream.sync.service';
import { webhooksAdminRoutes, webhooksInboundRoutes } from './domains/webhooks/webhooks.routes';
import { type AppBindings, type Env, isSandboxEnabled } from './env';
import { rekeyStoredCredentials } from './infra/credential-rekey';
import { createDb } from './infra/db';
import { drainMailOutbox } from './infra/mail.outbox';
import { bumpEdgeCacheVersion, createRateLimitMiddleware } from './infra/security';
import { buildTenantSeoPayload, rewriteHtmlWithTenantSeo } from './infra/seo';
import { createAdminAuditMiddleware } from './middleware/admin-audit.middleware';
import { createCorsMiddleware } from './middleware/cors.middleware';
import { handleGlobalError } from './middleware/error.middleware';

export const app = new Hono<AppBindings>();

// Request context, DB client, tenant resolution, anti-traceability guard & API error i18n
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('db', createDb(c.env.DB));
  c.set('user', null);

  if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(c.env)) {
    await ensureDemoSeeded(c.env);
  }
  const tenant = await resolveTenantContext(c.req.raw, c.env);
  c.set('tenant', tenant);

  if (tenant.isBlockedCnameHost) {
    return c.text('Not Found', 404);
  }
  if (tenant.isUnauthorizedDomain && c.req.path !== '/api/health') {
    const reason = tenant.unauthorizedReason || '当前域名未获平台授权绑定，已拦截访问';
    if (c.req.path.startsWith('/api/')) {
      return c.json({ ok: false, error: reason, code: 'UNAUTHORIZED_DOMAIN' }, 403);
    }
    return c.html(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Domain Not Authorized</title><style>body{font-family:system-ui,sans-serif;background:#f8f7f4;color:#1c1917;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{max-width:460px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{font-size:13px;color:#57534e;line-height:1.6;margin:0}</style></head><body><div class="card"><h1>403 · 域名未授权</h1><p>${reason.replace(/[<>&"]/g, '')}</p></div></body></html>`,
      403,
      { 'Cache-Control': 'no-store' }
    );
  }
  if (
    c.req.path.startsWith('/api/admin') &&
    tenant.isSubAgent &&
    (tenant.resolvedVia === 'custom_domain' ||
      tenant.resolvedVia === 'neutral_subdomain' ||
      tenant.resolvedVia === 'local_subdomain')
  ) {
    return c.json({ ok: false, error: 'Not Found', code: 'NOT_FOUND' }, 404);
  }
  await next();

  // 后台与分站写操作成功后立即递增边缘缓存世代号，确保前台 bootstrap 与商品目录秒级生效
  if (
    c.req.method !== 'GET' &&
    c.req.method !== 'HEAD' &&
    c.req.method !== 'OPTIONS' &&
    c.res &&
    c.res.status < 400 &&
    (c.req.path.startsWith('/api/admin/') || c.req.path.startsWith('/api/agent/'))
  ) {
    bumpEdgeCacheVersion();
  }

  // 当客户端请求非简体中文语种 (X-Lang / Accept-Language: zh-TW | en | ja | ko) 且返回 JSON 错误时，自动对 error 消息执行 5 语种国际化转换
  const reqLocale = resolveRequestLocale(c.req.raw.headers);
  if (
    reqLocale !== 'zh-CN' &&
    c.res &&
    c.res.status >= 400 &&
    (c.res.headers.get('Content-Type') || '').includes('application/json')
  ) {
    try {
      const cloned = c.res.clone();
      const payload = (await cloned.json()) as Record<string, unknown>;
      if (typeof payload.error === 'string' && payload.error) {
        const translated = translateApiErrorMessage(
          payload.error,
          typeof payload.code === 'string' ? payload.code : undefined,
          reqLocale,
          c.res.status
        );
        if (translated !== payload.error) {
          const nextHeaders = new Headers(c.res.headers);
          nextHeaders.set('Content-Language', reqLocale);
          c.res = new Response(JSON.stringify({ ...payload, error: translated, error_zh: payload.error }), {
            status: c.res.status,
            headers: nextHeaders,
          });
        }
      }
    } catch {
      // 非标准 JSON 响应保持原样
    }
  }
});

app.use('/api/*', createCorsMiddleware());
app.use('/api/*', createRateLimitMiddleware());

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    runtime: 'cloudflare-workers-edge',
    env: c.env.APP_ENV || 'development',
    release_sha: c.env.ACCTHUB_RELEASE_SHA,
    release_digest: c.env.ACCTHUB_RELEASE_DIGEST,
    time: new Date().toISOString(),
  })
);

app.route('/api/setup', setupRoutes);
app.route('/api/storefront', commerceStorefrontRoutes);
app.route('/api/storefront', storefrontRoutes);
app.route('/api/auth/oauth', oauthPublicRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/account', accountRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/agent', agentRoutes);
app.route('/api/v1/reseller', resellerApiRoutes);
app.route('/api/webhooks/upstream', upstreamWebhookRoutes);
app.route('/api/webhooks', webhooksInboundRoutes);
app.use('/api/admin/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  const user = await getAuthUser(c.req.raw, c.env, c.get('tenant'));
  if (user?.role !== 'admin') {
    return c.json({ error: '需要管理员权限（请登录管理员账号）' }, 403);
  }
  c.set('user', user);
  await next();
});
app.use('/api/admin/*', createAdminAuditMiddleware());
app.route('/api/admin/risk', adminRiskRoutes);
app.route('/api/admin/oauth', oauthAdminRoutes);
app.route('/api/admin/commerce', commerceAdminRoutes);
app.route('/api/admin/webhooks', webhooksAdminRoutes);
app.route('/api/admin/2fa', admin2FaRoutes);
app.route('/api/admin/upstreams', upstreamAdminRoutes);
app.route('/api/admin/ai', aiAdminRoutes);
app.route('/api/admin', adminRoutes);

// 未注册的 API 不交给静态资源的 SPA 回退。
app.all('/api/*', (c) => c.json({ ok: false, error: 'Not Found', code: 'NOT_FOUND' }, 404));

// Cloudflare Workers Assets 边缘 HTML SEO Meta 动态重写（支持分站独立标题、描述、OG 图与 Favicon）
app.get('*', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Not Found', 404);
  }
  const assetRes = await c.env.ASSETS.fetch(c.req.raw);
  const contentType = assetRes.headers.get('Content-Type') || '';
  if (!assetRes.ok || !contentType.includes('text/html')) {
    return assetRes;
  }
  const tenant = c.get('tenant');
  const mainSettings = tenant.isSubAgent
    ? undefined
    : await loadMainBrandSettingsForSeoRepo(c.get('db')).catch(() => undefined);
  const seo = buildTenantSeoPayload(tenant, c.req.url, mainSettings);
  const html = await assetRes.text();
  const rewritten = rewriteHtmlWithTenantSeo(html, seo);
  const headers = new Headers(assetRes.headers);
  headers.delete('Content-Length');
  headers.set('Cache-Control', 'no-cache');
  return new Response(rewritten, { status: assetRes.status, headers });
});

app.onError(handleGlobalError);

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(drainMailOutbox(env));
    ctx.waitUntil(recoverPendingAffiliateRewards(env));
    ctx.waitUntil(recoverImmediateOrderAborts(createDb(env.DB)));
    ctx.waitUntil(recoverExpiredBalanceOrders(env));
    ctx.waitUntil(runScheduledRefundReconciliation(env));
    if (env.DATA_REKEY_ENABLED === 'true') {
      ctx.waitUntil(
        rekeyStoredCredentials(env).then((counts) => {
          console.info('数据密钥迁移', counts);
        })
      );
    }
    ctx.waitUntil(
      (async () => {
        if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
          await ensureDemoSeeded(env);
        }
        await runScheduledPaymentMaintenance(env);
        await runScheduledUpstreamSync(env);
        await runScheduledUpstreamOrderPoll(env);
        await runScheduledFinanceSentinel(env).catch(() => undefined);
        await runScheduledGroupBuyMaintenance(env).catch(() => undefined);
        await runScheduledRenewalReminders(env).catch(() => undefined);
      })()
    );
  },
};
