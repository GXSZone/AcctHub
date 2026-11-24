import {
  type RiskControlConfig,
  type RiskEmergencyMode,
  riskControlConfigSchema,
} from '@shared/contracts/risk.contract';
import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { ipBlacklist, orders, riskEvents, siteSettings, users } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

const RISK_KEYS = [
  'risk_emergency_mode',
  'risk_max_cards_5m',
  'risk_max_cards_1h',
  'risk_max_upstream_daily_spend',
  'risk_review_order_amount_threshold',
  'risk_review_order_qty_threshold',
  'risk_max_pending_orders_per_ip_10m',
  'risk_max_pending_orders_per_email_10m',
  'risk_min_cost_guard_enabled',
  'risk_alert_emails',
] as const;

/** 读取全站 5 维反盗刷风控配置（100% Drizzle ORM） */
export async function loadRiskControlConfigRepo(db: AppDatabase): Promise<RiskControlConfig> {
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(inArray(siteSettings.key, [...RISK_KEYS]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return riskControlConfigSchema.parse({
    emergency_mode: map.get('risk_emergency_mode') || 'normal',
    max_cards_5m: map.has('risk_max_cards_5m') ? Number(map.get('risk_max_cards_5m')) : 50,
    max_cards_1h: map.has('risk_max_cards_1h') ? Number(map.get('risk_max_cards_1h')) : 200,
    max_upstream_daily_spend: map.has('risk_max_upstream_daily_spend')
      ? Number(map.get('risk_max_upstream_daily_spend'))
      : 50000,
    review_order_amount_threshold: map.has('risk_review_order_amount_threshold')
      ? Number(map.get('risk_review_order_amount_threshold'))
      : 0,
    review_order_qty_threshold: map.has('risk_review_order_qty_threshold')
      ? Number(map.get('risk_review_order_qty_threshold'))
      : 0,
    max_pending_orders_per_ip_10m: map.has('risk_max_pending_orders_per_ip_10m')
      ? Number(map.get('risk_max_pending_orders_per_ip_10m'))
      : 15,
    max_pending_orders_per_email_10m: map.has('risk_max_pending_orders_per_email_10m')
      ? Number(map.get('risk_max_pending_orders_per_email_10m'))
      : 15,
    min_cost_guard_enabled: map.get('risk_min_cost_guard_enabled') !== '0',
    alert_emails: map.get('risk_alert_emails') || '',
  });
}

/** 写入全站风控配置 */
export async function saveRiskControlConfigRepo(db: AppDatabase, cfg: RiskControlConfig): Promise<void> {
  const entries: Array<[string, string]> = [
    ['risk_emergency_mode', cfg.emergency_mode],
    ['risk_max_cards_5m', String(cfg.max_cards_5m)],
    ['risk_max_cards_1h', String(cfg.max_cards_1h)],
    ['risk_max_upstream_daily_spend', String(cfg.max_upstream_daily_spend)],
    ['risk_review_order_amount_threshold', String(cfg.review_order_amount_threshold)],
    ['risk_review_order_qty_threshold', String(cfg.review_order_qty_threshold)],
    ['risk_max_pending_orders_per_ip_10m', String(cfg.max_pending_orders_per_ip_10m)],
    ['risk_max_pending_orders_per_email_10m', String(cfg.max_pending_orders_per_email_10m)],
    ['risk_min_cost_guard_enabled', cfg.min_cost_guard_enabled ? '1' : '0'],
    ['risk_alert_emails', cfg.alert_emails],
  ];
  for (const [key, value] of entries) {
    await db
      .insert(siteSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
  }
}

/** 单独快速切换一键紧急止损模式 */
export async function setRiskEmergencyModeRepo(db: AppDatabase, mode: RiskEmergencyMode): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ key: 'risk_emergency_mode', value: mode })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: mode } });
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

function matchesIpPattern(ip: string, pattern: string): boolean {
  const target = ip.trim().toLowerCase();
  const pat = pattern.trim().toLowerCase();
  if (!target || !pat) return false;
  if (target === pat) return true;
  if (pat.includes('/')) {
    const [base, bitsStr] = pat.split('/');
    const bits = Number(bitsStr);
    const ipInt = ipv4ToInt(target);
    const baseInt = ipv4ToInt(base);
    if (ipInt !== null && baseInt !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    }
  }
  return false;
}

/** 检查 IP 是否命中全站 IP / CIDR 黑名单 */
export async function isIpBlacklistedRepo(db: AppDatabase, ip: string): Promise<boolean> {
  if (!ip || ip === '127.0.0.1' || ip === '::1') {
    const exact = await db
      .select({ id: ipBlacklist.id })
      .from(ipBlacklist)
      .where(eq(ipBlacklist.ipPattern, ip))
      .limit(1);
    return exact.length > 0;
  }
  const rows = await db.select({ ipPattern: ipBlacklist.ipPattern }).from(ipBlacklist).limit(500);
  return rows.some((r) => matchesIpPattern(ip, r.ipPattern));
}

export async function listIpBlacklistRepo(db: AppDatabase) {
  return db.select().from(ipBlacklist).orderBy(desc(ipBlacklist.id)).limit(200);
}

export async function addIpBlacklistRepo(
  db: AppDatabase,
  input: { ipPattern: string; reason: string; createdBy: string }
) {
  const [row] = await db
    .insert(ipBlacklist)
    .values({
      ipPattern: input.ipPattern.trim(),
      reason: input.reason.trim().slice(0, 180),
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: ipBlacklist.ipPattern,
      set: { reason: input.reason.trim().slice(0, 180), createdBy: input.createdBy },
    })
    .returning();
  return row;
}

export async function removeIpBlacklistRepo(db: AppDatabase, id: number): Promise<void> {
  await db.delete(ipBlacklist).where(eq(ipBlacklist.id, id));
}

/** 统计近 N 分钟内全站已交付出卡件数（跨边缘节点 D1 全局准确计数） */
export async function countDeliveredCardsInWindowRepo(db: AppDatabase, minutes: number): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.quantity}), 0)` })
    .from(orders)
    .where(
      and(
        inArray(orders.status, RECOGNIZED_ORDER_STATUSES),
        gte(orders.createdAt, sql`datetime('now', ${`-${Math.max(1, minutes)} minutes`})`)
      )
    );
  return Number(rows[0]?.total || 0);
}

/** 统计今日全站上游采购累计成本支出 */
export async function sumUpstreamSpendTodayRepo(db: AppDatabase): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.upstreamCostTotal}), 0)` })
    .from(orders)
    .where(and(gte(orders.createdAt, sql`date('now')`), sql`${orders.upstreamCostTotal} > 0`));
  return Number(Number(rows[0]?.total || 0).toFixed(2));
}

/** 统计近 N 分钟内同 IP 与同邮箱的待支付挂起单数量 */
export async function countPendingOrdersInWindowRepo(
  db: AppDatabase,
  buyerIp: string,
  email: string,
  minutes: number
): Promise<{ byIp: number; byEmail: number }> {
  const timeCond = gte(orders.createdAt, sql`datetime('now', ${`-${Math.max(1, minutes)} minutes`})`);
  const [ipRows, emailRows] = await Promise.all([
    buyerIp
      ? db
          .select({ c: sql<number>`count(*)` })
          .from(orders)
          .where(and(eq(orders.status, 'pending_payment'), eq(orders.buyerIp, buyerIp), timeCond))
      : Promise.resolve([{ c: 0 }]),
    email
      ? db
          .select({ c: sql<number>`count(*)` })
          .from(orders)
          .where(and(eq(orders.status, 'pending_payment'), eq(orders.contactEmail, email), timeCond))
      : Promise.resolve([{ c: 0 }]),
  ]);
  return { byIp: Number(ipRows[0]?.c || 0), byEmail: Number(emailRows[0]?.c || 0) };
}

/** 查询近期是否已有同类风控告警（冷却窗口防邮件轰炸死循环） */
export async function hasRecentRiskEventRepo(
  db: AppDatabase,
  eventType: string,
  cooldownMinutes: number
): Promise<boolean> {
  const rows = await db
    .select({ id: riskEvents.id })
    .from(riskEvents)
    .where(
      and(
        eq(riskEvents.eventType, eventType),
        gte(riskEvents.createdAt, sql`datetime('now', ${`-${Math.max(1, cooldownMinutes)} minutes`})`)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertRiskEventRepo(
  db: AppDatabase,
  input: {
    eventType: string;
    severity?: string;
    orderNo?: string;
    buyerIp?: string;
    contactEmail?: string;
    summary: string;
    detailJson?: string;
    mailAlertCount?: number;
  }
) {
  const [row] = await db
    .insert(riskEvents)
    .values({
      eventType: input.eventType,
      severity: input.severity || 'critical',
      orderNo: input.orderNo || '',
      buyerIp: input.buyerIp || '',
      contactEmail: input.contactEmail || '',
      summary: input.summary.slice(0, 500),
      detailJson: input.detailJson || '{}',
      mailAlertCount: input.mailAlertCount ?? 0,
    })
    .returning();
  return row;
}

export async function listRiskEventsRepo(db: AppDatabase, limit = 80) {
  return db
    .select()
    .from(riskEvents)
    .orderBy(desc(riskEvents.id))
    .limit(Math.min(200, Math.max(1, limit)));
}

export async function listSuperAdminEmailsRepo(db: AppDatabase): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, 'admin'), or(eq(users.status, 'active'), eq(users.status, ''))));
  return rows.map((r) => r.email).filter(Boolean);
}
