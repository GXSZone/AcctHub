import type { RiskControlConfig, RiskEmergencyMode } from '@shared/contracts/risk.contract';
import { eq } from 'drizzle-orm';
import { orders, siteSettings } from '../../db/schema/index';
import type { Env } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { type AppDatabase, createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { sendSiteEmail } from '../../infra/mail';
import { buildRiskAlertEmailTemplate } from '../../infra/mail.templates';
import { dispatchOpsNotification } from '../../infra/notify';
import { bumpEdgeCacheVersion } from '../../infra/security';
import { getFinanceReconciliation } from '../finance/finance.service';
import {
  addIpBlacklistRepo,
  countDeliveredCardsInWindowRepo,
  countPendingOrdersInWindowRepo,
  hasRecentRiskEventRepo,
  insertRiskEventRepo,
  isIpBlacklistedRepo,
  listIpBlacklistRepo,
  listRiskEventsRepo,
  listSuperAdminEmailsRepo,
  loadRiskControlConfigRepo,
  removeIpBlacklistRepo,
  saveRiskControlConfigRepo,
  setRiskEmergencyModeRepo,
  sumUpstreamSpendTodayRepo,
} from './risk.repo';

export type PreFulfillmentRiskVerdict =
  | { action: 'allow' }
  | { action: 'hold_review'; code: string; reason: string }
  | { action: 'block_bug'; code: string; reason: string };

/** 解析接收紧急告警邮件的管理员邮箱列表（优先风控配置，未配则回退全站超级管理员邮箱） */
async function resolveAlertEmails(db: AppDatabase, cfg: RiskControlConfig): Promise<string[]> {
  const configured = cfg.alert_emails
    .split(/[\r\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if (configured.length > 0) return [...new Set(configured)];
  return [...new Set((await listSuperAdminEmailsRepo(db)).map((e) => e.trim().toLowerCase()))];
}

async function resolveBrandName(db: AppDatabase): Promise<string> {
  const rows = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'brand_name'))
    .limit(1);
  return rows[0]?.value || 'AcctHub';
}

/**
 * 紧急风控熔断通知引擎：
 * 1) 记录不可变风控事件；
 * 2) 推送 Telegram / Webhook 红色告警；
 * 3) 向管理员邮箱连续发送 3 封防折叠独立主题紧急告警邮件（同类事件 10 分钟内冷却防死循环轰炸）。
 */
export async function dispatchEmergencyTripleAlert(
  env: Env,
  db: AppDatabase,
  input: {
    eventType: string;
    severity?: 'critical' | 'warning';
    orderNo?: string;
    buyerIp?: string;
    contactEmail?: string;
    summary: string;
    lines?: string[];
    detail?: Record<string, unknown>;
    forceSend?: boolean;
    cooldownMinutes?: number;
  }
): Promise<{ mailSentCount: number; eventId: number }> {
  const cooldown = input.cooldownMinutes ?? 10;
  const inCooldown = !input.forceSend && (await hasRecentRiskEventRepo(db, input.eventType, cooldown));
  const cfg = await loadRiskControlConfigRepo(db);
  const lines = [
    ...(input.orderNo ? [`关联订单：${input.orderNo}`] : []),
    ...(input.buyerIp ? [`来源 IP：${input.buyerIp}`] : []),
    ...(input.contactEmail ? [`客户邮箱：${input.contactEmail}`] : []),
    ...(input.lines || []),
  ];

  // 立即推送 Telegram / Webhook 运营告警
  if (!inCooldown) {
    void dispatchOpsNotification(env, 'upstream_alert', `🚨 紧急风控告警：${input.summary}`, lines).catch(
      () => undefined
    );
  }

  let mailSentCount = 0;
  if (!inCooldown) {
    const recipients = await resolveAlertEmails(db, cfg);
    if (recipients.length > 0) {
      const brandName = await resolveBrandName(db);
      const stamp = Date.now();
      for (const toEmail of recipients.slice(0, 3)) {
        for (let seq = 1; seq <= 3; seq++) {
          const tpl = buildRiskAlertEmailTemplate({
            brandName,
            seq,
            totalSeq: 3,
            eventType: input.eventType,
            summary: input.summary,
            lines: [...lines, `触发时间：${new Date().toISOString()}（告警编号 #${stamp}-${seq}）`],
          });
          const res = await sendSiteEmail(env, 0, {
            to: toEmail,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            orderNo: input.orderNo || 'RISK-ALERT',
            scene: 'risk_alert',
            forceIgnoreDisabled: false,
            idempotencyKey: `risk:${input.eventType}:${stamp}:${toEmail}:${seq}`,
          }).catch(() => ({ ok: false }));
          if (res.ok) mailSentCount += 1;
        }
      }
    }
  }

  const row = await insertRiskEventRepo(db, {
    eventType: input.eventType,
    severity: input.severity || 'critical',
    orderNo: input.orderNo,
    buyerIp: input.buyerIp,
    contactEmail: input.contactEmail,
    summary: input.summary,
    detailJson: JSON.stringify(input.detail ?? {}),
    mailAlertCount: mailSentCount,
  });

  return { mailSentCount, eventId: row.id };
}

/** 下单入口前 3 道硬闸：维护模式拦截 + IP/CIDR 黑名单拦截 + 同 IP/邮箱未付挂起单并发限流 */
export async function assertOrderCreationAllowed(
  _env: Env,
  db: AppDatabase,
  ctx: { buyerIp: string; email: string }
): Promise<void> {
  const cfg = await loadRiskControlConfigRepo(db);
  if (cfg.emergency_mode === 'maintenance') {
    throw Errors.forbidden('站点正在紧急安全维护中，暂时停止接收新订单，请稍后再试');
  }
  if (await isIpBlacklistedRepo(db, ctx.buyerIp)) {
    throw Errors.forbidden('当前网络 IP 已被列入平台安全黑名单，禁止下单');
  }
  if (cfg.max_pending_orders_per_ip_10m > 0 || cfg.max_pending_orders_per_email_10m > 0) {
    const pending = await countPendingOrdersInWindowRepo(db, ctx.buyerIp, ctx.email, 10);
    if (cfg.max_pending_orders_per_ip_10m > 0 && pending.byIp >= cfg.max_pending_orders_per_ip_10m) {
      throw Errors.rateLimited('您当前有过多未支付订单，请先完成或取消已有订单后再试', 600);
    }
    if (cfg.max_pending_orders_per_email_10m > 0 && pending.byEmail >= cfg.max_pending_orders_per_email_10m) {
      throw Errors.rateLimited('该邮箱待支付订单已达上限，请先完成付款或稍后再试', 600);
    }
  }
}

/**
 * 履约出卡 / 调上游前最后 1 毫秒独立 5 维熔断闸：
 * - 疑似 Bug / 0 元购 / 严重击穿成本 -> 直接 block_bug 硬拦截并触发 3 封紧急告警邮件；
 * - 一键暂停发卡 / 单笔大额多件 / 5分钟或1小时出卡速率超限 / 上游日采购触顶 -> hold_review 转人工待审并触发 3 封紧急告警邮件。
 */
export async function evaluatePreFulfillmentRisk(
  env: Env,
  db: AppDatabase,
  ctx: {
    orderNo: string;
    buyerIp: string;
    contactEmail: string;
    goodsTotal: number;
    promoUsed: number;
    quantity: number;
    unitCost: number | null;
    usesUpstream: boolean;
  }
): Promise<PreFulfillmentRiskVerdict> {
  const cfg = await loadRiskControlConfigRepo(db);
  const effectiveGoodsPaid = Number((ctx.goodsTotal + ctx.promoUsed).toFixed(2));

  // 维度 1：价格与成本防 Bug 硬校验（杜绝 0 元购、负数金额或逻辑 Bug 导致严重击穿成本）
  if (cfg.min_cost_guard_enabled) {
    if (!Number.isFinite(ctx.goodsTotal) || ctx.goodsTotal < 0 || effectiveGoodsPaid <= 0) {
      const reason = `检测到订单实付金额异常（¥${effectiveGoodsPaid}），已触发防 0 元购熔断拦截`;
      await dispatchEmergencyTripleAlert(env, db, {
        eventType: 'price_bug_zero_amount',
        orderNo: ctx.orderNo,
        buyerIp: ctx.buyerIp,
        contactEmail: ctx.contactEmail,
        summary: reason,
        detail: { goodsTotal: ctx.goodsTotal, promoUsed: ctx.promoUsed, qty: ctx.quantity },
      });
      return { action: 'block_bug', code: 'price_bug_zero_amount', reason };
    }
    if (ctx.unitCost !== null && ctx.unitCost > 0) {
      const totalCost = Number((ctx.unitCost * ctx.quantity).toFixed(2));
      // 严禁任何定价/优惠券 Bug 导致实收低于成本价 60%
      if (effectiveGoodsPaid + 0.01 < totalCost * 0.6) {
        const reason = `检测到订单实收 ¥${effectiveGoodsPaid.toFixed(2)} 严重击穿成本 ¥${totalCost.toFixed(2)}，疑似定价或优惠券 Bug`;
        await dispatchEmergencyTripleAlert(env, db, {
          eventType: 'price_bug_below_cost',
          orderNo: ctx.orderNo,
          buyerIp: ctx.buyerIp,
          contactEmail: ctx.contactEmail,
          summary: reason,
          detail: { effectiveGoodsPaid, totalCost, qty: ctx.quantity },
        });
        return { action: 'block_bug', code: 'price_bug_below_cost', reason };
      }
    }
  }

  // 维度 2：站长一键紧急暂停自动发卡模式
  if (cfg.emergency_mode === 'hold_delivery') {
    return {
      action: 'hold_review',
      code: 'emergency_hold',
      reason: '平台当前处于紧急风控复核模式，订单款项已安全保留，等待管理员审核放行发卡',
    };
  }

  // 维度 3：单笔大额 / 大数量自动转人工风控复核
  if (
    (cfg.review_order_amount_threshold > 0 && effectiveGoodsPaid >= cfg.review_order_amount_threshold) ||
    (cfg.review_order_qty_threshold > 0 && ctx.quantity >= cfg.review_order_qty_threshold)
  ) {
    const reason = `单笔订单触发大额/多件复核阈值（¥${effectiveGoodsPaid.toFixed(2)} / ${ctx.quantity} 件）`;
    await dispatchEmergencyTripleAlert(env, db, {
      eventType: 'high_value_review',
      severity: 'warning',
      orderNo: ctx.orderNo,
      buyerIp: ctx.buyerIp,
      contactEmail: ctx.contactEmail,
      summary: reason,
      detail: { effectiveGoodsPaid, qty: ctx.quantity },
    });
    return { action: 'hold_review', code: 'high_value_review', reason };
  }

  // 维度 4：D1 跨边缘节点全局出卡速率熔断（近 5 分钟 & 近 1 小时）
  if (cfg.max_cards_5m > 0 || cfg.max_cards_1h > 0) {
    const [cards5m, cards1h] = await Promise.all([
      cfg.max_cards_5m > 0 ? countDeliveredCardsInWindowRepo(db, 5) : Promise.resolve(0),
      cfg.max_cards_1h > 0 ? countDeliveredCardsInWindowRepo(db, 60) : Promise.resolve(0),
    ]);
    if (cfg.max_cards_5m > 0 && cards5m + ctx.quantity > cfg.max_cards_5m) {
      const reason = `近 5 分钟全站出卡件数触及熔断阀（当前 ${cards5m} + 本单 ${ctx.quantity} > 上限 ${cfg.max_cards_5m}）`;
      await dispatchEmergencyTripleAlert(env, db, {
        eventType: 'rate_circuit_5m',
        orderNo: ctx.orderNo,
        buyerIp: ctx.buyerIp,
        contactEmail: ctx.contactEmail,
        summary: reason,
        detail: { cards5m, qty: ctx.quantity, limit: cfg.max_cards_5m },
      });
      return { action: 'hold_review', code: 'rate_circuit_5m', reason };
    }
    if (cfg.max_cards_1h > 0 && cards1h + ctx.quantity > cfg.max_cards_1h) {
      const reason = `近 1 小时全站出卡件数触及熔断阀（当前 ${cards1h} + 本单 ${ctx.quantity} > 上限 ${cfg.max_cards_1h}）`;
      await dispatchEmergencyTripleAlert(env, db, {
        eventType: 'rate_circuit_1h',
        orderNo: ctx.orderNo,
        buyerIp: ctx.buyerIp,
        contactEmail: ctx.contactEmail,
        summary: reason,
        detail: { cards1h, qty: ctx.quantity, limit: cfg.max_cards_1h },
      });
      return { action: 'hold_review', code: 'rate_circuit_1h', reason };
    }
  }

  // 维度 5：单日上游采购支出硬上限（防 Bug 刷光上游预存余额）
  if (ctx.usesUpstream && cfg.max_upstream_daily_spend > 0) {
    const spentToday = await sumUpstreamSpendTodayRepo(db);
    const estCost = Number(((ctx.unitCost || 0) * ctx.quantity).toFixed(2));
    if (spentToday + estCost > cfg.max_upstream_daily_spend) {
      const reason = `今日上游采购累计支出触及硬上限（已用 ¥${spentToday.toFixed(2)} + 预估 ¥${estCost.toFixed(2)} > 上限 ¥${cfg.max_upstream_daily_spend}）`;
      await dispatchEmergencyTripleAlert(env, db, {
        eventType: 'upstream_daily_cap',
        orderNo: ctx.orderNo,
        buyerIp: ctx.buyerIp,
        contactEmail: ctx.contactEmail,
        summary: reason,
        detail: { spentToday, estCost, limit: cfg.max_upstream_daily_spend },
      });
      return { action: 'hold_review', code: 'upstream_daily_cap', reason };
    }
  }

  return { action: 'allow' };
}

/** 7×24 自动财务守恒哨兵（接入 5 分钟 Cron：发现任一资金守恒校验异常即连发 3 封紧急告警邮件） */
export async function runScheduledFinanceSentinel(
  env: Env
): Promise<{ healthy: boolean; failedKeys: string[] }> {
  const db = createDb(env.DB);
  const recon = await getFinanceReconciliation(env, '30');
  const failed = recon.integrity_checks.filter((c) => !c.passed);
  if (failed.length === 0) return { healthy: true, failedKeys: [] };

  const failedKeys = failed.map((f) => f.key);
  await dispatchEmergencyTripleAlert(env, db, {
    eventType: `finance_sentinel:${failedKeys.join(',')}`,
    summary: `7×24 财务守恒自动巡检发现 ${failed.length} 项账本异常！`,
    lines: failed.map((f) => `• [${f.label}] ${f.detail}（异常数 ${f.count}）`),
    detail: { failed },
    cooldownMinutes: 60,
  });
  return { healthy: false, failedKeys };
}

/** 管理端读取风控配置与实时熔断看板状态 */
export async function getAdminRiskOverview(env: Env) {
  const db = createDb(env.DB);
  const [config, cards5m, cards1h, upstreamToday, pendingReviewRows, ipList, events] = await Promise.all([
    loadRiskControlConfigRepo(db),
    countDeliveredCardsInWindowRepo(db, 5),
    countDeliveredCardsInWindowRepo(db, 60),
    sumUpstreamSpendTodayRepo(db),
    db.select({ id: orders.id }).from(orders).where(eq(orders.status, 'risk_review')),
    listIpBlacklistRepo(db),
    listRiskEventsRepo(db, 60),
  ]);
  return {
    config,
    live_metrics: {
      cards_5m: cards5m,
      cards_1h: cards1h,
      upstream_spend_today: upstreamToday,
      risk_review_orders: pendingReviewRows.length,
    },
    ip_blacklist: ipList.map((r) => ({
      id: r.id,
      ip_pattern: r.ipPattern,
      reason: r.reason,
      created_by: r.createdBy,
      created_at: r.createdAt,
    })),
    events: events.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      severity: e.severity,
      order_no: e.orderNo,
      buyer_ip: e.buyerIp,
      contact_email: e.contactEmail,
      summary: e.summary,
      detail_json: e.detailJson,
      mail_alert_count: e.mailAlertCount,
      created_at: e.createdAt,
    })),
  };
}

export async function updateAdminRiskConfig(env: Env, actor: AuditActorContext, cfg: RiskControlConfig) {
  const db = createDb(env.DB);
  await saveRiskControlConfigRepo(db, cfg);
  bumpEdgeCacheVersion();
  await recordAdminAudit(db, actor, {
    action: 'risk.update_config',
    targetType: 'settings',
    targetId: 0,
    summary: `更新全站安全风控阈值与策略（紧急模式：${cfg.emergency_mode}）`,
    after: cfg,
  });
  return { ok: true, config: cfg };
}

export async function switchAdminEmergencyMode(
  env: Env,
  actor: AuditActorContext,
  mode: RiskEmergencyMode,
  reason: string
) {
  const db = createDb(env.DB);
  await setRiskEmergencyModeRepo(db, mode);
  bumpEdgeCacheVersion();
  await recordAdminAudit(db, actor, {
    action: `risk.emergency_${mode}`,
    targetType: 'settings',
    targetId: 0,
    summary: `切换紧急止损模式为「${mode}」${reason ? `（原因：${reason}）` : ''}`,
    after: { emergency_mode: mode, reason },
  });
  if (mode !== 'normal') {
    await dispatchEmergencyTripleAlert(env, db, {
      eventType: `manual_emergency_${mode}`,
      summary: `管理员 ${actor.actorEmail} 已开启「${mode === 'maintenance' ? '紧急维护闭店' : '紧急暂停自动发卡'}」止损开关`,
      lines: reason ? [`操作原因：${reason}`] : [],
      forceSend: true,
    });
  }
  return { ok: true, emergency_mode: mode };
}

export async function addAdminIpBlacklist(
  env: Env,
  actor: AuditActorContext,
  input: { ip_pattern: string; reason: string }
) {
  const db = createDb(env.DB);
  const row = await addIpBlacklistRepo(db, {
    ipPattern: input.ip_pattern,
    reason: input.reason,
    createdBy: actor.actorEmail,
  });
  await recordAdminAudit(db, actor, {
    action: 'risk.ip_blacklist_add',
    targetType: 'ip_blacklist',
    targetId: row.id,
    summary: `将 IP/网段 ${row.ipPattern} 加入全站黑名单`,
  });
  return {
    ok: true,
    item: {
      id: row.id,
      ip_pattern: row.ipPattern,
      reason: row.reason,
      created_by: row.createdBy,
      created_at: row.createdAt,
    },
  };
}

export async function deleteAdminIpBlacklist(env: Env, actor: AuditActorContext, id: number) {
  const db = createDb(env.DB);
  await removeIpBlacklistRepo(db, id);
  await recordAdminAudit(db, actor, {
    action: 'risk.ip_blacklist_delete',
    targetType: 'ip_blacklist',
    targetId: id,
    summary: `移出 IP 黑名单条目 #${id}`,
  });
  return { ok: true };
}

export async function sendAdminRiskTestAlert(env: Env, actor: AuditActorContext) {
  const res = await dispatchEmergencyTripleAlert(env, createDb(env.DB), {
    eventType: 'manual_test_alert',
    severity: 'warning',
    summary: `站长 ${actor.actorEmail} 触发紧急风控 3 封告警演练测试`,
    lines: ['这是一次主动演练，验证 Telegram/Webhook 与管理员邮箱 3 封防折叠连发通道是否畅通。'],
    forceSend: true,
  });
  return { ok: true, mail_sent_count: res.mailSentCount, event_id: res.eventId };
}
