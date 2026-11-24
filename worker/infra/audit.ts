import type { AdminAuditLogsQuery } from '@shared/index';
import { and, desc, eq, gte, like, or, sql } from 'drizzle-orm';
import { type AdminAuditLogRow, adminAuditLogs } from '../db/schema/core';
import type { AppDatabase } from './db';

const SENSITIVE_KEY_PATTERN =
  /(^key$|secret|password|passwd|token|api[_-]?key|private[_-]?key|cards?_text|card_content|lines|authorization|cookie)/i;

/** 递归脱敏审计对象中的密钥、密码与卡密明文，防止敏感凭证落入日志表 */
function sanitizeAuditValue(input: unknown, depth = 0): unknown {
  if (depth > 5) return '[DepthTruncated]';
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input.length > 500 ? `${input.slice(0, 500)}…[len=${input.length}]` : input;
  }
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    return input.slice(0, 30).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        if (typeof v === 'string' && v.trim()) {
          out[k] = `***(len=${v.trim().length})`;
        } else if (v) {
          out[k] = '***';
        } else {
          out[k] = '';
        }
      } else {
        out[k] = sanitizeAuditValue(v, depth + 1);
      }
    }
    return out;
  }
  return String(input);
}

export interface AuditActorContext {
  actorUserId: number;
  actorEmail: string;
  actorRole: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface RecordAdminAuditInput {
  action: string;
  targetType: string;
  targetId?: string | number;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** 写入一条运营总控操作审计日志（永不因日志写入异常阻断主业务） */
export async function recordAdminAudit(
  db: AppDatabase,
  actor: AuditActorContext,
  entry: RecordAdminAuditInput
): Promise<void> {
  try {
    const beforeJson = entry.before !== undefined ? JSON.stringify(sanitizeAuditValue(entry.before)) : '{}';
    const afterJson = entry.after !== undefined ? JSON.stringify(sanitizeAuditValue(entry.after)) : '{}';
    await db.insert(adminAuditLogs).values({
      actorUserId: actor.actorUserId,
      actorEmail: actor.actorEmail.slice(0, 120),
      actorRole: actor.actorRole.slice(0, 32),
      action: entry.action.slice(0, 80),
      targetType: entry.targetType.slice(0, 64),
      targetId: entry.targetId !== undefined ? String(entry.targetId).slice(0, 80) : '',
      summary: entry.summary.slice(0, 240),
      beforeJson: beforeJson.slice(0, 4000),
      afterJson: afterJson.slice(0, 4000),
      ip: (actor.ip || '').slice(0, 64),
      userAgent: (actor.userAgent || '').slice(0, 200),
      requestId: (actor.requestId || '').slice(0, 64),
    });
  } catch (err) {
    console.warn('写入管理操作审计日志失败:', err instanceof Error ? err.message : String(err));
  }
}

/** 根据后台管理 HTTP 请求路径映射语义化的动作分类与目标对象 */
export function resolveAdminRouteAuditMeta(
  method: string,
  pathname: string
): { action: string; targetType: string; targetId: string } {
  const clean = pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
  const parts = clean.split('/').filter(Boolean);
  const resource = parts[0] || 'system';
  if (
    method === 'POST' &&
    resource === 'upstreams' &&
    parts[1] === 'local-orders' &&
    parts[3] === 'manual-fulfill'
  ) {
    return { action: 'upstreams.create_or_exec.manual-fulfill', targetType: resource, targetId: parts[2] };
  }
  const targetId = parts[1] && !['reorder', 'generate', 'csv', 'test'].includes(parts[1]) ? parts[1] : '';
  const verb = method === 'DELETE' ? 'delete' : method === 'POST' ? 'create_or_exec' : 'update';
  const sub = parts[2] ? `.${parts[2]}` : parts[1] && !targetId ? `.${parts[1]}` : '';
  return {
    action: `${resource}.${verb}${sub}`,
    targetType: resource,
    targetId,
  };
}

/** 分页检索总控操作审计日志 */
export async function queryAdminAuditLogs(
  db: AppDatabase,
  query: AdminAuditLogsQuery
): Promise<AdminAuditLogRow[]> {
  const days = Math.max(1, Math.min(365, Number(query.days || 30)));
  const limit = Math.max(1, Math.min(200, Number(query.limit || 80)));
  const conditions = [gte(adminAuditLogs.createdAt, sql`datetime('now', ${`-${days} days`})`)];

  if (query.action) {
    conditions.push(like(adminAuditLogs.action, `%${query.action}%`));
  }
  if (query.target_type) {
    conditions.push(eq(adminAuditLogs.targetType, query.target_type));
  }
  if (query.q) {
    const kw = `%${query.q}%`;
    const orExpr = or(
      like(adminAuditLogs.actorEmail, kw),
      like(adminAuditLogs.summary, kw),
      like(adminAuditLogs.targetId, kw),
      like(adminAuditLogs.action, kw)
    );
    if (orExpr) conditions.push(orExpr);
  }

  const rows = await db
    .select()
    .from(adminAuditLogs)
    .where(and(...conditions))
    .orderBy(desc(adminAuditLogs.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, beforeJson: '{}', afterJson: readSafeAuditSnapshot(row) }));
}

function readSafeAuditSnapshot(row: AdminAuditLogRow): string {
  try {
    const value = JSON.parse(row.afterJson) as Record<string, unknown>;
    if (row.action === 'setup.initialize' && row.targetType === 'system') {
      return JSON.stringify({
        ...(typeof value.admin_email === 'string' ? { admin_email: value.admin_email } : {}),
        ...(typeof value.brand_name === 'string' ? { brand_name: value.brand_name } : {}),
      });
    }
    if (row.action === 'payment-plugins.update') {
      return JSON.stringify({
        ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
        ...(typeof value.credentials_updated === 'boolean'
          ? { credentials_updated: value.credentials_updated }
          : {}),
      });
    }
    if (row.action === 'upstreams.create_or_exec.manual-fulfill' && typeof value.count === 'number') {
      return JSON.stringify({ count: value.count });
    }
    if (
      (row.action === 'agent-tiers.create_or_exec' || row.action === 'agent-tiers.update') &&
      typeof value.loss_discount_rate === 'number' &&
      typeof value.loss_cost_version === 'string' &&
      /^[a-f0-9]{64}$/.test(value.loss_cost_version)
    ) {
      return JSON.stringify({
        loss_discount_rate: value.loss_discount_rate,
        loss_cost_version: value.loss_cost_version,
      });
    }
  } catch {
    // 旧日志的快照可能已经截断。无法解析时不向外提供任何快照值。
  }
  return '{}';
}

function escapeCsvCell(val: unknown): string {
  const raw = String(val ?? '');
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

/** 构建防公式注入的审计日志 CSV 导出文本 */
export function buildAdminAuditCsv(rows: AdminAuditLogRow[]): string {
  const header = ['ID', '时间', '操作人', '角色', '动作', '目标类型', '目标ID', '摘要', '变更后快照', 'IP'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.id,
        r.createdAt,
        r.actorEmail,
        r.actorRole,
        r.action,
        r.targetType,
        r.targetId,
        r.summary,
        r.afterJson,
        r.ip,
      ]
        .map(escapeCsvCell)
        .join(',')
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}
