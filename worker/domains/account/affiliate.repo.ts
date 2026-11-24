import type { AccountAffiliateQuery } from '@shared/contracts/account.contract';
import { and, desc, eq, exists, inArray, lt, or, sql } from 'drizzle-orm';
import { affiliateLedgers, agents, promoTransactions, users } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { getTenantSettingsMapRepo, upsertTenantSettingsRepo } from '../tenant/tenant-settings.repo';

/** 读取指定站点的合法推荐人（同站会员或本分站所属活跃店长，严格跨站隔离） */
export async function findUserByReferralCodeRepo(db: AppDatabase, referralCode: string, siteAgentId: number) {
  const code = referralCode.trim().toUpperCase();
  if (!code) return null;
  const siteCond =
    siteAgentId > 0
      ? or(
          eq(users.siteAgentId, siteAgentId),
          exists(
            db
              .select({ id: agents.id })
              .from(agents)
              .where(
                and(eq(agents.id, siteAgentId), eq(agents.userId, users.id), eq(agents.status, 'active'))
              )
          )
        )
      : eq(users.siteAgentId, 0);
  const rows = await db
    .select({ id: users.id, siteAgentId: users.siteAgentId, role: users.role })
    .from(users)
    .where(and(sql`upper(${users.referralCode}) = ${code}`, siteCond))
    .limit(1);
  return rows[0] ?? null;
}

/** 幂等写入用户唯一邀请码（若尚未分配） */
export async function assignUserReferralCodeIfEmptyRepo(
  db: AppDatabase,
  userId: number,
  candidateCode: string
): Promise<boolean> {
  try {
    const updated = await db
      .update(users)
      .set({ referralCode: candidateCode })
      .where(and(eq(users.id, userId), sql`${users.referralCode} IS NULL`))
      .returning({ id: users.id });
    return updated.length === 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/unique/i.test(msg)) return false;
    throw err;
  }
}

export async function getUserPromoMetaRepo(db: AppDatabase, userId: number) {
  const rows = await db
    .select({
      id: users.id,
      siteAgentId: users.siteAgentId,
      role: users.role,
      referralCode: users.referralCode,
      referredByUserId: users.referredByUserId,
      promoBalance: users.promoBalance,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

const AFFILIATE_SETTING_KEYS = [
  'affiliate_enabled',
  'affiliate_commission_rate',
  'affiliate_min_order_amount',
  'affiliate_max_reward',
] as const;

export async function loadAffiliateConfigRepo(db: AppDatabase, siteAgentId = 0) {
  const ownerId = Math.max(siteAgentId, 0);
  const map = await getTenantSettingsMapRepo(db, ownerId, AFFILIATE_SETTING_KEYS);
  const defaultEnabled = ownerId === 0;
  const rawEnabled = map.get('affiliate_enabled');
  const enabled = rawEnabled !== undefined ? rawEnabled !== '0' : defaultEnabled;
  const rawRate = Number(map.get('affiliate_commission_rate') ?? '0.05');
  const commissionRate = Number.isFinite(rawRate) ? Math.min(0.5, Math.max(0, rawRate)) : 0.05;
  const rawMin = Number(map.get('affiliate_min_order_amount') ?? '10');
  const minOrderAmount = Number.isFinite(rawMin) ? Math.max(0, rawMin) : 10;
  const rawMax = Number(map.get('affiliate_max_reward') ?? '0');
  const maxReward = Number.isFinite(rawMax) ? Math.max(0, rawMax) : 0;
  return { enabled, commissionRate, minOrderAmount, maxReward };
}

/** 独立保存指定站点（主站或分站）的邀请有礼推广消费金策略到统一 tenant_settings 表 */
export async function saveSiteAffiliateConfigRepo(
  db: AppDatabase,
  siteAgentId: number,
  input: { enabled: boolean; commission_rate: number; min_order_amount: number; max_reward: number }
) {
  const ownerId = Math.max(siteAgentId, 0);
  const entries: Array<[string, string]> = [
    ['affiliate_enabled', input.enabled ? '1' : '0'],
    ['affiliate_commission_rate', String(Math.min(0.5, Math.max(0, Number(input.commission_rate))))],
    ['affiliate_min_order_amount', String(Math.max(0, Number(input.min_order_amount)))],
    ['affiliate_max_reward', String(Math.max(0, Number(input.max_reward || 0)))],
  ];
  await upsertTenantSettingsRepo(db, ownerId, entries);
}

const AFFILIATE_PAGE_SIZE = 50;

export async function loadUserAffiliateDashboardRepo(
  db: AppDatabase,
  userId: number,
  page: AccountAffiliateQuery
) {
  const [referredRows, settledRewards, ledgersRows, promoTxRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.referredByUserId, userId)),
    db
      .select({ total: sql<number>`COALESCE(SUM(${affiliateLedgers.rewardAmount}), 0)` })
      .from(affiliateLedgers)
      .where(and(eq(affiliateLedgers.referrerUserId, userId), eq(affiliateLedgers.status, 'settled'))),
    db
      .select()
      .from(affiliateLedgers)
      .where(
        and(
          eq(affiliateLedgers.referrerUserId, userId),
          inArray(affiliateLedgers.status, ['settled', 'clawed_back']),
          page.ledger_before_id === undefined ? undefined : lt(affiliateLedgers.id, page.ledger_before_id)
        )
      )
      .orderBy(desc(affiliateLedgers.id))
      .limit(AFFILIATE_PAGE_SIZE + 1),
    db
      .select()
      .from(promoTransactions)
      .where(
        and(
          eq(promoTransactions.userId, userId),
          page.promo_before_id === undefined ? undefined : lt(promoTransactions.id, page.promo_before_id)
        )
      )
      .orderBy(desc(promoTransactions.id))
      .limit(AFFILIATE_PAGE_SIZE + 1),
  ]);
  const ledgers = ledgersRows.slice(0, AFFILIATE_PAGE_SIZE);
  const promoTransactionsPage = promoTxRows.slice(0, AFFILIATE_PAGE_SIZE);

  return {
    referredCount: Number(referredRows[0]?.c ?? 0),
    settledRewardTotal: Number(settledRewards[0]?.total ?? 0),
    ledgers,
    ledgerNextBeforeId: ledgersRows.length > AFFILIATE_PAGE_SIZE ? (ledgers.at(-1)?.id ?? null) : null,
    promoTransactions: promoTransactionsPage,
    promoNextBeforeId:
      promoTxRows.length > AFFILIATE_PAGE_SIZE ? (promoTransactionsPage.at(-1)?.id ?? null) : null,
  };
}
