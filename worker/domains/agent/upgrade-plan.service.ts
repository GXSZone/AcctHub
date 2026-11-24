import { addMoney, roundCurrency } from '@shared/domain/money';
import { eq } from 'drizzle-orm';
import { siteSettings } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import {
  findActiveAgentById,
  findAgentByUserId,
  findAgentTierById,
  findEligibleAgentTier,
  findUserById,
  mapAgentTierRow,
} from '../auth/auth.repo';
import { prepareAgentAccount } from '../auth/auth.service';

export async function planAgentUpgrade(
  env: Env,
  input: {
    userId: number;
    amount: number;
    ownerId: number;
    tierId?: number;
    desiredSlug?: string;
    desiredBrandName?: string;
  }
) {
  const { userId, amount, ownerId, tierId, desiredSlug, desiredBrandName } = input;
  const db = createDb(env.DB);
  const [user, agent] = await Promise.all([findUserById(db, userId), findAgentByUserId(db, userId)]);
  if (!user) throw Errors.notFound('代理升级付款账号不存在');
  const parentId = agent ? (agent.parentAgentId ?? 0) : ownerId;
  const current = agent?.tierId ? await findAgentTierById(db, agent.tierId) : null;
  // 若代理曾被后台手动调低等级导致历史 totalRecharged 高于当前等级门槛，则以当前等级门槛为补差基数
  const basePaid =
    current && user.totalRecharged > current.minRecharge ? current.minRecharge : user.totalRecharged;
  const nextTotalRecharged = addMoney(basePaid, amount);
  const tier = await findEligibleAgentTier(db, parentId, nextTotalRecharged, tierId);
  const changeTier =
    tier && (!current || tier.levelRank >= current.levelRank || tier.discountRate < current.discountRate);
  const newAgent =
    tier && !agent ? await prepareAgentAccount(env, user, parentId, { desiredSlug, desiredBrandName }) : null;
  const settledParentId = agent ? parentId : newAgent?.parentAgentId;
  const parent = settledParentId ? await findActiveAgentById(db, settledParentId) : null;
  let settlement = null;
  if (parent && parent.userId !== userId && amount > 0) {
    const fee = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, 'agent_signup_platform_fee_pct'))
      .get();
    const platformFeePct = Math.min(80, Math.max(0, Number(fee?.value ?? 0) || 0));
    const platformCut = roundCurrency((amount * platformFeePct) / 100);
    settlement = { parent, platformFeePct, platformCut, parentIncome: roundCurrency(amount - platformCut) };
  }
  return {
    user,
    agent,
    newAgent,
    tier: tier ? mapAgentTierRow(tier) : null,
    changeTier,
    settlement,
    nextTotalRecharged,
  };
}

export type AgentUpgradePlan = Awaited<ReturnType<typeof planAgentUpgrade>>;
