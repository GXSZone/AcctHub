import { eq, sql } from 'drizzle-orm';
import { type Env, isPublicDemoMode } from '../../env';
import { createDb } from '../../infra/db';
import {
  adminAuditLogs,
  affiliateLedgers,
  agentProductOverrides,
  agentProductPrices,
  agents,
  agentTiers,
  agentWithdrawals,
  announcements,
  categories,
  categoryGroups,
  commissionLedger,
  coupons,
  emailDeliveryLogs,
  groupBuyMembers,
  groupBuySessions,
  helpArticles,
  ipBlacklist,
  mailOutbox,
  oauthAuthStates,
  oauthExchangeTickets,
  orderRefunds,
  orders,
  outboundWebhooks,
  passwordResetCodes,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  productUpstreamBindings,
  promoTransactions,
  rechargeCdks,
  rechargeRecords,
  refundCommissionRecoveries,
  refundPolicies,
  restockSubscriptions,
  riskEvents,
  siteMailConfigs,
  siteSettings,
  supportTickets,
  tenantDomains,
  tenantPaymentPlugins,
  tenantSettings,
  tenantSsoTickets,
  ticketMessages,
  upstreamItems,
  upstreamOrders,
  upstreamSources,
  upstreamSyncLogs,
  userLoginLogs,
  userOauthIdentities,
  userSessions,
  users,
  userTotpVault,
  walletEvents,
  walletTransactions,
} from '../schema';
import { clearDemoSeedCache, ensureDemoSeeded, getBeijingDayKey } from './index';

const DEMO_RESET_SETTING_KEY = 'demo_last_reset_date';
const resetPromises = new WeakMap<D1Database, Promise<boolean>>();

/**
 * 公开演示库每日自动重置并恢复原始演示数据
 *
 * 严格遵循零运行时 DDL 与零裸 SQL 约束：按外键安全顺序通过 Drizzle ORM 批量清空全部业务表
 * （保留迁移账本 `accthub_schema_migrations`），复位自增主键序列并重新灌入完整演示数据集。
 */
export async function resetPublicDemoDatabase(env: Env, dayKey = getBeijingDayKey()): Promise<boolean> {
  if (!isPublicDemoMode(env)) {
    return false;
  }
  const inflight = resetPromises.get(env.DB);
  if (inflight) {
    return inflight;
  }

  const task = runResetOnce(env, dayKey).finally(() => {
    resetPromises.delete(env.DB);
  });
  resetPromises.set(env.DB, task);
  return task;
}

/** 按北京时间（UTC+8）检查当日是否已完成演示库重置，跨天未重置则自动恢复初始状态 */
export async function maybeRunDailyDemoReset(env: Env, dayKey = getBeijingDayKey()): Promise<boolean> {
  if (!isPublicDemoMode(env)) {
    return false;
  }
  const db = createDb(env.DB);
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, DEMO_RESET_SETTING_KEY))
    .limit(1);

  if (row?.value === dayKey) {
    return false;
  }
  return resetPublicDemoDatabase(env, dayKey);
}

async function runResetOnce(env: Env, dayKey: string): Promise<boolean> {
  const db = createDb(env.DB);

  // 先清空叶子与关联子表（尤其是引用 users 的 user_sessions），再清空基础主表
  await db.batch([
    db.delete(ticketMessages),
    db.delete(supportTickets),
    db.delete(refundCommissionRecoveries),
    db.delete(orderRefunds),
    db.delete(groupBuyMembers),
    db.delete(groupBuySessions),
    db.delete(commissionLedger),
    db.delete(affiliateLedgers),
    db.delete(promoTransactions),
    db.delete(walletTransactions),
    db.delete(walletEvents),
    db.delete(paymentIntents),
    db.delete(upstreamOrders),
    db.delete(upstreamSyncLogs),
    db.delete(productUpstreamBindings),
    db.delete(upstreamItems),
    db.delete(productCards),
    db.delete(restockSubscriptions),
    db.delete(orders),
    db.delete(rechargeRecords),
    db.delete(rechargeCdks),
    db.delete(coupons),
    db.delete(agentProductOverrides),
    db.delete(agentProductPrices),
    db.delete(agentWithdrawals),
    db.delete(tenantDomains),
    db.delete(tenantPaymentPlugins),
    db.delete(tenantSettings),
    db.delete(tenantSsoTickets),
    db.delete(userSessions),
    db.delete(userLoginLogs),
    db.delete(userOauthIdentities),
    db.delete(oauthAuthStates),
    db.delete(oauthExchangeTickets),
    db.delete(passwordResetCodes),
    db.delete(userTotpVault),
    db.delete(emailDeliveryLogs),
    db.delete(mailOutbox),
    db.delete(riskEvents),
    db.delete(ipBlacklist),
    db.delete(outboundWebhooks),
    db.delete(adminAuditLogs),
    db.delete(announcements),
    db.delete(helpArticles),
    db.delete(paymentPlugins),
    db.delete(siteMailConfigs),
    db.delete(refundPolicies),
    db.delete(upstreamSources),
    db.delete(products),
    db.delete(categories),
    db.delete(categoryGroups),
    db.delete(agents),
    db.delete(agentTiers),
    db.delete(users),
    db.delete(siteSettings),
  ]);

  // 复位 SQLite AUTOINCREMENT 序列，确保重置后的商品、分类与分站 ID 与初始状态一致
  await db.run(sql`DELETE FROM sqlite_sequence`).catch(() => undefined);

  clearDemoSeedCache(env.DB);
  await ensureDemoSeeded(env);

  await db
    .insert(siteSettings)
    .values({ key: DEMO_RESET_SETTING_KEY, value: dayKey })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: dayKey, updatedAt: sql`(datetime('now'))` },
    });

  return true;
}
