import type { AgentRow } from '../../db/schema/index';
import type { AgentTier, AuthUser } from '../../db/types';
import type { Env, TenantContext } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { findAgentByUserId, mapAgentRow } from '../auth/auth.repo';
import { getAuthUser, getUserAgentTier } from '../auth/auth.service';

export interface ActiveAgentContext {
  user: AuthUser;
  agent: ReturnType<typeof mapAgentRow>;
  agentRow: AgentRow;
  tier: AgentTier | null;
  tenant: TenantContext;
}

/** 将 AgentTier 附带解析后的权益 perks 数组 */
export function parseTierWithPerks(t: AgentTier) {
  return {
    ...t,
    perks: JSON.parse(t.perks_json || '[]') as string[],
  };
}

export function assertActiveAgent(user: AuthUser, agentRow: AgentRow | null): asserts agentRow is AgentRow {
  if (user.role === 'admin') {
    throw Errors.forbidden('总管理员请在「运营总控后台」管理平台。');
  }
  if (agentRow?.status !== 'active') {
    throw Errors.forbidden('您尚未开通认证代理分站');
  }
}

/**
 * 要求当前请求为已激活代理商身份（严格 SaaS 分站域名自治守卫）：
 * 默认要求请求必须落在分站自身域名上下文（tenant.isSubAgent && tenant.agentId === agent.id），
 * 仅主站跳转入口等只读接口可显式传 allowMainHost: true。
 */
export async function requireActiveAgent(
  req: Request,
  env: Env,
  preResolvedTenant: TenantContext,
  opts?: { allowMainHost?: boolean }
): Promise<ActiveAgentContext> {
  const user = await getAuthUser(req, env, preResolvedTenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  const db = createDb(env.DB);
  const agentRow = await findAgentByUserId(db, user.id);
  assertActiveAgent(user, agentRow);
  if (!opts?.allowMainHost) {
    if (!preResolvedTenant.isSubAgent || preResolvedTenant.agentId !== agentRow.id) {
      throw Errors.forbidden('请通过您的分站独立域名进入「运营管理」工作台进行操作');
    }
  }
  const tier = await getUserAgentTier(env, user.id);
  return { user, agent: mapAgentRow(agentRow), agentRow, tier, tenant: preResolvedTenant };
}

/** 清洗客服二维码/图片列表 JSON（仅放行 http/https 与安全图片 data URI） */
export function sanitizeSupportMediaJson(raw: unknown): string {
  try {
    const arr: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return '[]';
    const cleaned = arr
      .slice(0, 8)
      .map((rawItem) => {
        const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
        return {
          title: String(item.title || '')
            .trim()
            .slice(0, 40),
          url: String(item.url || '').trim(),
        };
      })
      .filter(
        (x) =>
          x.url &&
          (/^https?:\/\//i.test(x.url) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(x.url))
      );
    return JSON.stringify(cleaned);
  } catch {
    return '[]';
  }
}

/** 清洗客服外链 JSON（仅放行 http/https 协议防 XSS） */
export function sanitizeSupportLinksJson(raw: unknown): string {
  try {
    const arr: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return '[]';
    const cleaned = arr
      .slice(0, 8)
      .map((rawItem) => {
        const item = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
        return {
          label:
            String(item.label || '')
              .trim()
              .slice(0, 32) || '联系客服',
          url: String(item.url || '').trim(),
        };
      })
      .filter((x) => x.url && /^https?:\/\//i.test(x.url));
    return JSON.stringify(cleaned);
  } catch {
    return '[]';
  }
}
