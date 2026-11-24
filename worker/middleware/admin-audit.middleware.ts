import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env';
import { recordAdminAudit, resolveAdminRouteAuditMeta } from '../infra/audit';
import { getClientIp } from '../infra/security';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditSnapshot(
  action: string,
  body: Record<string, unknown>,
  result: Record<string, unknown>
): Record<string, unknown> {
  if (action === 'payment-plugins.update') {
    const credentials = ['key', 'secret_key', 'webhook_secret', 'trongrid_api_key', 'explorer_api_key'];
    const config = body.config;
    const credentialsUpdated =
      config !== null &&
      typeof config === 'object' &&
      Object.entries(config).some(
        ([key, value]) => credentials.includes(key) && typeof value === 'string' && value.trim() !== ''
      );
    return {
      ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      credentials_updated: credentialsUpdated,
    };
  }
  if (action === 'upstreams.create_or_exec.manual-fulfill' && typeof result.count === 'number') {
    return { count: result.count };
  }
  if (
    (action === 'agent-tiers.create_or_exec' || action === 'agent-tiers.update') &&
    typeof result.loss_discount_rate === 'number' &&
    typeof result.loss_cost_version === 'string' &&
    /^[a-f0-9]{64}$/.test(result.loss_cost_version)
  ) {
    return { loss_discount_rate: result.loss_discount_rate, loss_cost_version: result.loss_cost_version };
  }
  return {};
}

/**
 * 运营总控敏感操作全量自动审计中间件：
 * 成功的总控写请求仅记录操作信息和显式允许的字段。
 */
export function createAdminAuditMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!WRITE_METHODS.has(method)) {
      await next();
      return;
    }

    const url = new URL(c.req.url);
    let parsedBody: Record<string, unknown> = {};
    if (method === 'PUT' && /^\/api\/admin\/payment-plugins\/[^/]+\/?$/.test(url.pathname)) {
      try {
        const cloned = c.req.raw.clone();
        const text = await cloned.text();
        if (text.trim().startsWith('{')) {
          parsedBody = JSON.parse(text) as Record<string, unknown>;
        }
      } catch {
        // 非 JSON Body 保持空对象记录
      }
    }

    await next();

    if (!c.res || c.res.status >= 400) return;

    const user = c.get('user');
    if (user?.role !== 'admin') return;

    let resData: Record<string, unknown> = {};
    try {
      if ((c.res.headers.get('Content-Type') || '').includes('application/json')) {
        const json = (await c.res.clone().json()) as Record<string, unknown>;
        if (json && typeof json === 'object') resData = json;
      }
    } catch {
      // 忽略非 JSON 响应体
    }

    const meta = resolveAdminRouteAuditMeta(method, url.pathname);
    const responseId = resData.id ?? resData.order_no;
    const targetId = meta.targetId || (typeof responseId === 'number' ? String(responseId) : '');
    await recordAdminAudit(
      c.get('db'),
      {
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        ip: getClientIp(c.req.raw),
        userAgent: c.req.header('User-Agent') || '',
        requestId: c.get('requestId'),
      },
      {
        action: meta.action,
        targetType: meta.targetType,
        targetId,
        summary: `执行管理操作 ${meta.action}${targetId ? ` (#${targetId})` : ''}`,
        after: auditSnapshot(meta.action, parsedBody, resData),
      }
    );
  };
}
