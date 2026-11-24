import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { tenantSsoTickets, users } from '../../db/schema/index';
import type { Env, TenantContext } from '../../env';
import { getCloudflareSaasConfig } from '../../infra/cloudflare-saas';
import { sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { findPrimaryActiveHostname } from '../tenant/tenant.repo';
import { findAgentByUserId, mapAgentRowWithSecret, mapAuthUserRow } from './auth.repo';
import { getAuthUser, getUserAgentTier } from './auth.service';
import { issueAuthSession } from './auth.session';

const SSO_TICKET_TTL_MS = 60_000;

function generateRawSsoTicket(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `ahsso_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sanitizeRedirectPath(raw?: string): string {
  const trimmed = (raw || '/agent').trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/agent';
  return trimmed;
}

/** 计算分站当前权威访问源（优先活跃自定义主域 → 中性泛子域 → 本地 <slug>.localhost:<port>） */
export async function resolveAgentTargetOrigin(
  env: Env,
  req: Request,
  agent: { id: number; slug: string }
): Promise<string> {
  const db = createDb(env.DB);
  const [primaryHost, saasCfg] = await Promise.all([
    findPrimaryActiveHostname(db, agent.id),
    getCloudflareSaasConfig(env),
  ]);
  const reqUrl = new URL(req.url);
  const reqHost = reqUrl.hostname.toLowerCase();
  const isLocal = reqHost === 'localhost' || reqHost === '127.0.0.1' || reqHost.endsWith('.localhost');

  if (isLocal) {
    const portSuffix = reqUrl.port ? `:${reqUrl.port}` : '';
    return `${reqUrl.protocol}//${agent.slug}.localhost${portSuffix}`;
  }
  if (primaryHost) {
    return `https://${primaryHost}`;
  }
  if (saasCfg.neutralBaseDomain) {
    return `https://${agent.slug}.${saasCfg.neutralBaseDomain}`;
  }
  throw Errors.validation('分站尚未绑定可用独立域名，且平台未配置免费二级域基座');
}

/**
 * 为已登录的活跃分站站长签发一次性跨站免登 SSO 票据（60 秒有效、仅绑定目标分站）：
 * 主站点击「进入我的分站运营后台」后，浏览器携带该票据跳往分站真实域名完成原子免登。
 */
export async function issueTenantSsoTicket(
  env: Env,
  req: Request,
  tenant: TenantContext,
  redirectPath?: string
) {
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  const db = createDb(env.DB);
  const agentRow = await findAgentByUserId(db, user.id);
  if (agentRow?.status !== 'active') {
    throw Errors.forbidden('您尚未开通活跃代理分站，无法签发分站免登票据');
  }

  const targetOrigin = await resolveAgentTargetOrigin(env, req, agentRow);
  const rawTicket = generateRawSsoTicket();
  const ticketHash = await sha256Hex(rawTicket);
  const nextPath = sanitizeRedirectPath(redirectPath);
  const expiresAt = Date.now() + SSO_TICKET_TTL_MS;

  await db.insert(tenantSsoTickets).values({
    ticketHash,
    userId: user.id,
    targetAgentId: agentRow.id,
    redirectPath: nextPath,
    expiresAt,
  });

  const redirectUrl = new URL('/sso/callback', targetOrigin);
  redirectUrl.searchParams.set('ticket', rawTicket);
  redirectUrl.searchParams.set('next', nextPath);

  return {
    ok: true,
    ticket: rawTicket,
    target_origin: targetOrigin,
    redirect_url: redirectUrl.toString(),
    expires_in_sec: Math.floor(SSO_TICKET_TTL_MS / 1000),
  };
}

/**
 * 在目标分站域名下原子核销一次性 SSO 票据并签发当前分站独立会话：
 * 严格校验 target_agent_id === currentTenant.agentId、未过期、未使用（CAS 防重放）。
 */
export async function exchangeTenantSsoTicket(env: Env, tenant: TenantContext, rawTicket: string) {
  if (!tenant.isSubAgent || !tenant.agentId) {
    throw Errors.forbidden('免登票据仅允许在目标分站域名下核销');
  }
  if (tenant.isSuspended) {
    throw Errors.forbidden('当前代理分站已暂停营业');
  }

  const db = createDb(env.DB);
  const ticketHash = await sha256Hex(rawTicket.trim());
  const nowMs = Date.now();

  const claimed = await db
    .update(tenantSsoTickets)
    .set({ usedAt: nowMs })
    .where(
      and(
        eq(tenantSsoTickets.ticketHash, ticketHash),
        eq(tenantSsoTickets.targetAgentId, tenant.agentId),
        isNull(tenantSsoTickets.usedAt),
        gt(tenantSsoTickets.expiresAt, nowMs)
      )
    )
    .returning();

  const ticketRow = claimed[0];
  if (!ticketRow) {
    throw Errors.unauthorized('免登票据无效、已使用或已过期，请从主站重新进入');
  }

  const [userRow] = await db.select().from(users).where(eq(users.id, ticketRow.userId)).limit(1);
  if (!userRow) throw Errors.unauthorized('对应账户不存在');

  const agentRow = await findAgentByUserId(db, userRow.id);
  if (agentRow?.status !== 'active' || agentRow.id !== tenant.agentId) {
    throw Errors.forbidden('该账户不再具备当前分站站长权限');
  }

  const [token, agentMapped, tier] = await Promise.all([
    issueAuthSession(db, env, {
      id: userRow.id,
      role: userRow.role,
      siteAgentId: userRow.siteAgentId,
      sessionVersion: userRow.sessionVersion,
    }),
    mapAgentRowWithSecret(env, agentRow),
    getUserAgentTier(env, userRow.id),
  ]);

  // 顺手清理过期历史票据（非致命）
  await db
    .delete(tenantSsoTickets)
    .where(sql`${tenantSsoTickets.expiresAt} < ${nowMs - 300_000}`)
    .catch(() => undefined);

  return {
    ok: true,
    token,
    redirect_path: sanitizeRedirectPath(ticketRow.redirectPath),
    user: {
      ...mapAuthUserRow(userRow),
      agent: agentMapped,
      agent_tier: tier,
    },
  };
}
