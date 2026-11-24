import type { AccountAffiliateQuery } from '@shared/contracts/account.contract';
import { roundCurrency } from '@shared/domain/money';
import type { Env } from '../../env';
import { type AppDatabase, createDb } from '../../infra/db';
import {
  assignUserReferralCodeIfEmptyRepo,
  findUserByReferralCodeRepo,
  getUserPromoMetaRepo,
  loadAffiliateConfigRepo,
  loadUserAffiliateDashboardRepo,
  saveSiteAffiliateConfigRepo,
} from './affiliate.repo';
import {
  findAffiliateReward,
  listUnsettledAffiliateOrders,
  postAffiliateRewardAtomically,
  reserveOrderPromoAtomically,
} from './affiliate-posting.repo';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCandidateReferralCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let suffix = '';
  for (const b of bytes) {
    suffix += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return `AH${suffix}`;
}

/** 懒生成并固化用户唯一邀请码（冲突时自动重试） */
export async function ensureUserReferralCode(db: AppDatabase, userId: number): Promise<string> {
  const existing = await getUserPromoMetaRepo(db, userId);
  if (existing?.referralCode) return existing.referralCode;

  for (let i = 0; i < 6; i++) {
    const code = makeCandidateReferralCode();
    const ok = await assignUserReferralCodeIfEmptyRepo(db, userId, code);
    if (ok) return code;
    const refetched = await getUserPromoMetaRepo(db, userId);
    if (refetched?.referralCode) return refetched.referralCode;
  }
  return `AH${userId.toString(36).toUpperCase().padStart(6, '0')}`;
}

/** 注册时解析推荐码归因：仅在当前站点开启推广活动且同站存在该推荐人时绑定，严格跨站隔离 */
export async function resolveReferrerUserIdOnRegister(
  db: AppDatabase,
  referralCode: string | undefined,
  siteAgentId: number
): Promise<number | null> {
  const trimmed = (referralCode || '').trim();
  if (!trimmed) return null;
  const cfg = await loadAffiliateConfigRepo(db, siteAgentId);
  if (!cfg.enabled) return null;
  const referrer = await findUserByReferralCodeRepo(db, trimmed, siteAgentId);
  return referrer ? referrer.id : null;
}

/** 校验当前站点新注册会员是否需要发放专属邀请码 */
export async function issueReferralCodeIfEnabledForSite(
  db: AppDatabase,
  userId: number,
  siteAgentId: number
): Promise<string | null> {
  const cfg = await loadAffiliateConfigRepo(db, siteAgentId);
  return cfg.enabled ? ensureUserReferralCode(db, userId) : null;
}

/** 查询/保存指定站点（含代理分站）的独立推广消费金策略 */
export async function getSiteAffiliateConfig(env: Env, siteAgentId: number) {
  const db = createDb(env.DB);
  const cfg = await loadAffiliateConfigRepo(db, siteAgentId);
  return {
    enabled: cfg.enabled,
    commission_rate: cfg.commissionRate,
    min_order_amount: cfg.minOrderAmount,
    max_reward: cfg.maxReward,
  };
}

export async function updateSiteAffiliateConfig(
  env: Env,
  siteAgentId: number,
  input: { enabled: boolean; commission_rate: number; min_order_amount: number; max_reward: number }
) {
  const db = createDb(env.DB);
  await saveSiteAffiliateConfigRepo(db, siteAgentId, input);
  return { ok: true, ...(await getSiteAffiliateConfig(env, siteAgentId)) };
}

/**
 * 下单时按可用推广消费金余额原子扣减抵扣额：
 * 推广金不可提现，仅可站内消费抵扣，扣减即落不可变 promo_transactions 流水。
 */
export async function reservePromoBalanceForOrder(
  db: AppDatabase,
  params: {
    userId: number;
    maxPayableAmount: number;
    orderNo: string;
    productTitle: string;
  }
): Promise<number> {
  const maxAllowed = Math.max(0, roundCurrency(params.maxPayableAmount));
  if (maxAllowed <= 0) return 0;

  return reserveOrderPromoAtomically(db, {
    ...params,
    maxAmount: maxAllowed,
    note: `订单使用推广消费金抵扣（${params.productTitle} / ${params.orderNo}）`,
  });
}

/**
 * 订单付款并成功履约后，按当前站点独立推广规则为推荐人结算不可提现推广消费金：
 * 1. 仅按订单所属站点（主站 siteId=0 或分站 siteId=agentId）读取独立开关、比例与单笔封顶；
 * 2. 推荐关系严格跨站隔离（允许同站会员及分站所属活跃店长绑定各自站点普通买家）；
 * 3. 仅限普通会员（buyer.role === 'user'），代理/店主自购订单不产佣且禁用自邀；
 * 4. 计佣基数仅为实付现金/主余额 totalAmount（排除推广金抵扣额，防循环滚雪球）且 >= 最低门槛。
 */
export async function settleAffiliateRewardForOrder(env: Env, orderNo: string): Promise<number> {
  const db = createDb(env.DB);
  const pending = await findAffiliateReward(db, orderNo);
  return pending?.status === 'pending' && (await postAffiliateRewardAtomically(db, pending))
    ? pending.rewardAmount
    : 0;
}

/** 为已付款订单补结上次未成功完成的推广返佣。 */
export async function recoverPendingAffiliateRewards(env: Env): Promise<number> {
  const db = createDb(env.DB);
  const pending = await listUnsettledAffiliateOrders(db);
  let settled = 0;
  for (const { reward } of pending) {
    try {
      if (await postAffiliateRewardAtomically(db, reward)) settled += 1;
    } catch {
      console.warn('推广返佣结算未成功，下一轮将重试', { orderNo: reward.orderNo });
    }
  }
  return settled;
}

/** 查询会员推广中心面板数据（自动懒分配专属邀请码） */
export async function getMemberAffiliateSummary(
  env: Env,
  userId: number,
  siteAgentId: number,
  page: AccountAffiliateQuery
) {
  const db = createDb(env.DB);
  const [meta, cfg, dash] = await Promise.all([
    getUserPromoMetaRepo(db, userId),
    loadAffiliateConfigRepo(db, siteAgentId),
    loadUserAffiliateDashboardRepo(db, userId, page),
  ]);
  const referralCode = cfg.enabled ? await ensureUserReferralCode(db, userId) : meta?.referralCode || null;

  return {
    available_on_site: true,
    affiliate_enabled: cfg.enabled,
    commission_rate: cfg.commissionRate,
    min_order_amount: cfg.minOrderAmount,
    max_reward: cfg.maxReward,
    referral_code: cfg.enabled ? referralCode : null,
    referral_path: cfg.enabled && referralCode ? `/?ref=${encodeURIComponent(referralCode)}` : null,
    promo_balance: roundCurrency(Number(meta?.promoBalance ?? 0)),
    referred_count: dash.referredCount,
    settled_reward_total: roundCurrency(dash.settledRewardTotal),
    ledger_next_before_id: dash.ledgerNextBeforeId,
    promo_next_before_id: dash.promoNextBeforeId,
    ledgers: dash.ledgers.map((l) => ({
      id: l.id,
      order_no: l.orderNo,
      order_amount: l.orderAmount,
      commission_rate: l.commissionRate,
      reward_amount: l.rewardAmount,
      clawed_back_amount: l.clawedBackAmount,
      status: l.status,
      created_at: l.createdAt,
    })),
    promo_transactions: dash.promoTransactions.map((tx) => ({
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      balance_after: tx.balanceAfter,
      ref_no: tx.refNo,
      note: tx.note,
      created_at: tx.createdAt,
    })),
  };
}
