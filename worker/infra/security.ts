import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../env';

// =========================================================================
// 1. 分层滑动窗口限流器（按 IP / API Key 维度防护，超限返回 HTTP 429）
//    边界说明：当前使用 Worker 单 Isolate 内存桶限流（单实例突发与防刷有效，跨边缘节点不共享）；
//    生产环境高频接口（/api/auth/*、/api/payments/*、/api/orders/lookup）应叠加 Cloudflare WAF Rate Limiting Rules。
// =========================================================================
interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
  byApiKey?: boolean;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();
const MAX_RATE_BUCKETS = 5000;
let lastPruneAt = 0;

function pruneExpiredBuckets(now: number) {
  if (now - lastPruneAt < 30_000 && buckets.size < 2000) return;
  lastPruneAt = now;
  for (const [k, v] of buckets.entries()) {
    if (v.resetAt <= now) buckets.delete(k);
  }
  // 若清理过期项后仍超过容量上限，按插入顺序淘汰最旧桶，防止随机伪造 IP 耗尽 Worker 内存
  if (buckets.size >= MAX_RATE_BUCKETS) {
    const overflow = buckets.size - MAX_RATE_BUCKETS + 500;
    let removed = 0;
    for (const k of buckets.keys()) {
      buckets.delete(k);
      removed++;
      if (removed >= overflow) break;
    }
  }
}

/** 仅在单元测试间重置内存限流桶 */
export function resetRateLimitBucketsForTest(): void {
  buckets.clear();
  lastPruneAt = 0;
}

/** 提取客户端真实 IP（优先 Cloudflare 连接 IP） */
export function getClientIp(req: Request): string {
  const cfIp = req.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();
  const xff = req.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return '127.0.0.1';
}

function resolveRateRule(method: string, path: string): RateRule | null {
  if (method === 'OPTIONS' || path === '/api/health') return null;

  if (method === 'POST' && path === '/api/auth/login') {
    return { name: 'auth_login', limit: 12, windowMs: 60_000 };
  }
  if (method === 'POST' && path === '/api/auth/register') {
    return { name: 'auth_register', limit: 12, windowMs: 60_000 };
  }
  if (method === 'POST' && (path === '/api/orders' || path === '/api/v1/reseller/order')) {
    return {
      name: 'order_write',
      limit: 15,
      windowMs: 60_000,
      byApiKey: path.startsWith('/api/v1/reseller'),
    };
  }
  if (method === 'POST' && (path === '/api/orders/lookup' || path === '/api/orders/recover')) {
    return { name: 'order_lookup', limit: 20, windowMs: 60_000 };
  }
  if (method === 'POST' && /^\/api\/payments\/intents\/[^/]+\/check$/.test(path)) {
    return { name: 'payment_check', limit: 10, windowMs: 60_000 };
  }
  if (method === 'GET' && path.startsWith('/api/payments/intents/')) {
    return { name: 'payment_poll', limit: 60, windowMs: 60_000 };
  }
  if (method === 'POST' && path === '/api/storefront/concierge/match') {
    return { name: 'concierge', limit: 20, windowMs: 60_000 };
  }
  if (path.startsWith('/api/v1/reseller/')) {
    return { name: 'reseller_read', limit: 60, windowMs: 60_000, byApiKey: true };
  }
  if (path.startsWith('/api/storefront/')) {
    return { name: 'public_read', limit: 180, windowMs: 60_000 };
  }
  if (path.startsWith('/api/admin/')) {
    return { name: 'admin_api', limit: 300, windowMs: 60_000, byApiKey: true };
  }
  if (
    method === 'GET' &&
    (path === '/api/auth/me' || path.startsWith('/api/account/') || path.startsWith('/api/agent/'))
  ) {
    return { name: 'portal_read', limit: 240, windowMs: 60_000, byApiKey: true };
  }
  return { name: 'api_default', limit: 120, windowMs: 60_000 };
}

function extractKeyFingerprint(req: Request): string {
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const raw = auth.slice(7).trim();
    if (raw) return raw.length > 12 ? `${raw.slice(0, 6)}..${raw.slice(-4)}` : raw.slice(0, 6);
  }
  const apiKey = (req.headers.get('X-API-Key') || '').trim();
  if (apiKey) return apiKey.length > 12 ? `${apiKey.slice(0, 6)}..${apiKey.slice(-4)}` : apiKey.slice(0, 6);
  return 'anon';
}

/** 创建全站分层滑动窗口限流中间件 */
export function createRateLimitMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const rule = resolveRateRule(c.req.method, path);
    if (!rule) {
      await next();
      return;
    }

    const now = Date.now();
    pruneExpiredBuckets(now);

    const ip = getClientIp(c.req.raw);
    const keyPart = rule.byApiKey ? `:${extractKeyFingerprint(c.req.raw)}` : '';
    const bucketKey = `${rule.name}:${ip}${keyPart}`;

    let entry = buckets.get(bucketKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + rule.windowMs };
      buckets.set(bucketKey, entry);
    }

    entry.count += 1;
    const remaining = Math.max(0, rule.limit - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    c.header('X-RateLimit-Policy', `${rule.name};w=${Math.round(rule.windowMs / 1000)}`);
    c.header('X-RateLimit-Limit', String(rule.limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > rule.limit) {
      c.header('Retry-After', String(retryAfterSec));
      return c.json(
        {
          error: `请求过于频繁（已触发 ${rule.name} 频率限制），请 ${retryAfterSec} 秒后再试`,
          code: 'RATE_LIMITED',
          retry_after_seconds: retryAfterSec,
        },
        429
      );
    }

    await next();
  };
}

// =========================================================================
// 2. Cloudflare Turnstile 服务端人机校验（Fail-Closed）
// =========================================================================
export async function verifyTurnstileIfConfigured(
  req: Request,
  env: Env,
  expectedAction: string,
  bodyToken?: unknown
): Promise<{ ok: true; enforced: boolean } | { ok: false; status: 403; error: string }> {
  const secret = (env.TURNSTILE_SECRET || '').trim();
  if (!secret) {
    return { ok: true, enforced: false };
  }

  const headerToken = req.headers.get('X-Turnstile-Token') || req.headers.get('cf-turnstile-response');
  const token =
    typeof bodyToken === 'string' && bodyToken.trim() ? bodyToken.trim() : (headerToken || '').trim();

  if (!token || token.length > 2048) {
    return { ok: false, status: 403, error: '人机验证校验失败：缺少有效的 Turnstile 凭证' };
  }

  const expectedHostnames = new Set(
    (env.TURNSTILE_HOSTNAMES || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );

  let result: { success?: boolean; action?: string; hostname?: string; 'error-codes'?: string[] };
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: getClientIp(req),
      }),
    });
    if (!resp.ok) throw new Error(`siteverify HTTP ${resp.status}`);
    result = (await resp.json()) as typeof result;
  } catch {
    return { ok: false, status: 403, error: '人机验证服务暂不可用，请刷新重试' };
  }

  const hostnameValid =
    expectedHostnames.size === 0 ||
    (typeof result.hostname === 'string' && expectedHostnames.has(result.hostname.toLowerCase()));
  const actionValid = !expectedAction || result.action === expectedAction;

  if (!result.success || !actionValid || !hostnameValid) {
    return { ok: false, status: 403, error: '人机验证未通过，请重新完成安全校验' };
  }

  return { ok: true, enforced: true };
}

// =========================================================================
// 3. Cloudflare Edge Cache API 辅助（按 Host + 写版本号隔离租户缓存键，写后即时失效防脏读）
// =========================================================================
let edgeCacheGeneration = Date.now();

/** 后台或分站写操作成功后递增缓存世代号，使当前节点前台缓存即时失效 */
export function bumpEdgeCacheVersion(): void {
  edgeCacheGeneration = Math.max(edgeCacheGeneration + 1, Date.now());
}

export async function withEdgeCache(
  c: Context,
  ttlSeconds: number,
  compute: () => Promise<unknown>
): Promise<Response> {
  const reqUrl = new URL(c.req.url);
  const rawHost = (c.req.header('Host') || reqUrl.hostname || '').split(',')[0].trim();
  const host = rawHost.split(':')[0].toLowerCase();
  const bypassCache = reqUrl.searchParams.get('nocache') === '1';

  const cacheUrl = new URL(reqUrl.toString());
  cacheUrl.searchParams.set('_h', host);
  cacheUrl.searchParams.set('_v', String(edgeCacheGeneration));
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  const edgeCache =
    typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;

  if (edgeCache && !bypassCache) {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set('X-Edge-Cache', 'HIT');
        return new Response(cached.body, { status: cached.status, headers: hitHeaders });
      }
    } catch {
      // 本地开发运行时若不支持 Cache API 则直接穿透
    }
  }

  const payload = await compute();
  const body = JSON.stringify(payload);
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': bypassCache ? 'no-store' : `public, max-age=0, must-revalidate, s-maxage=${ttlSeconds}`,
    Vary: 'Host',
    'X-Edge-Cache': 'MISS',
  });

  const response = new Response(body, { status: 200, headers });

  if (edgeCache && !bypassCache) {
    const putPromise = edgeCache.put(cacheKey, response.clone()).catch((err) => {
      console.warn('Edge cache write skipped:', err instanceof Error ? err.message : String(err));
    });
    try {
      c.executionCtx.waitUntil(putPromise);
    } catch {
      await putPromise;
    }
  }

  return response;
}
