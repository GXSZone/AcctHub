import {
  type AgentDownlineUpdateInput,
  type AgentWithdrawalInput,
  discountDisplay,
  roundCurrency,
} from '@shared/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { AppError, Errors } from '../../infra/errors';
import { dispatchOpsNotification } from '../../infra/notify';
import {
  countDownlinesUsingTier,
  createDownlineTierRepo,
  deleteDownlineTierRepo,
  findDirectDownlineAgent,
  listAgentWithdrawalsRepo,
  updateDirectDownlineRepo,
  updateDownlineTierRepo,
} from './agent.downline.repo';
import { type ActiveAgentContext, parseTierWithPerks } from './agent.guard';
import { findAgentTierByScope, listAgentTiersByOwner, readAgentWithdrawalFeePct } from './agent.repo';
import { createWithdrawalWithWalletPosting } from './withdrawal-posting.repo';

/** 查询当前代理自建的下级招募等级列表及自身底价防线 */
export async function listMyDownlineTiers(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const tiers = await listAgentTiersByOwner(db, ctx.agent.id);
  return {
    my_discount_floor: ctx.tier?.discount_rate ?? 0.9,
    tiers: tiers.map(parseTierWithPerks),
  };
}

/** 新增下级代理等级（严格执行防亏拦截：下级折率不得低于自身拿货底价） */
export async function createMyDownlineTier(
  env: Env,
  ctx: ActiveAgentContext,
  body: {
    code?: string;
    name?: string;
    level_rank?: number;
    min_recharge?: number;
    discount_rate?: number;
    badge_color?: string;
    perks?: string[];
  }
) {
  const myFloor = Number(ctx.tier?.discount_rate ?? 0.9);
  const name = (body.name || '').trim();
  if (!name) throw Errors.validation('请填写下级等级名称');

  const minRecharge = Number(body.min_recharge ?? 199);
  if (!Number.isFinite(minRecharge) || minRecharge < 10 || minRecharge > 100000) {
    throw Errors.validation('开户/升级费用需在 ¥10 – ¥100,000 之间');
  }

  const discountRate = Number(body.discount_rate ?? 0.95);
  if (!Number.isFinite(discountRate) || discountRate > 1 || discountRate < 0.1) {
    throw Errors.validation('下级拿货折扣必须在 0.10 – 1.00 之间');
  }
  const normalizedRate = Number(discountRate.toFixed(2));
  if (normalizedRate + 0.0001 < myFloor) {
    throw new AppError(
      'VALIDATION_ERROR',
      `防亏拦截：您当前的拿货底价折扣为 ${discountDisplay(myFloor).zhFold} 折（${myFloor}），给下级设置的拿货折扣（${discountDisplay(normalizedRate).zhFold}折）不得低于您自身的底价，否则每单都会倒贴亏损！`,
      { details: { sub_code: 'DOWNLINE_DISCOUNT_BELOW_FLOOR', min_safe_discount: myFloor } }
    );
  }

  const code =
    (body.code || `tier_${Date.now().toString(36)}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '') || `tier_${Date.now().toString(36)}`;

  const perks =
    Array.isArray(body.perks) && body.perks.length > 0
      ? body.perks
      : [
          `全站商品享 ${discountDisplay(normalizedRate).zhFold} 折供货底价`,
          '独立白标分站自主选品、改写图文与自由定价',
          '赠送 B2B 批采 API Key，支持继续发展下级分站',
        ];

  const db = createDb(env.DB);
  const id = await createDownlineTierRepo(db, {
    ownerAgentId: ctx.agent.id,
    code,
    name,
    levelRank: Number(body.level_rank || 1),
    minRecharge,
    discountRate: normalizedRate,
    badgeColor: body.badge_color || '#D97757',
    perksJson: JSON.stringify(perks),
  });

  return { ok: true, id };
}

/** 更新自建下级代理等级（带防亏底价拦截） */
export async function updateMyDownlineTier(
  env: Env,
  ctx: ActiveAgentContext,
  tierId: number,
  body: {
    name?: string;
    level_rank?: number;
    min_recharge?: number;
    discount_rate?: number;
    badge_color?: string;
    perks?: string[];
  }
) {
  const db = createDb(env.DB);
  const existing = await findAgentTierByScope(db, ctx.agent.id, { tierId });
  if (!existing) throw Errors.notFound('该等级不存在或无权编辑');

  const myFloor = Number(ctx.tier?.discount_rate ?? 0.9);
  const patch: Record<string, unknown> = {};

  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.level_rank !== undefined) patch.levelRank = Number(body.level_rank);
  if (body.min_recharge !== undefined) {
    const mr = Number(body.min_recharge);
    if (!Number.isFinite(mr) || mr < 10 || mr > 100000) {
      throw Errors.validation('开户/升级费用需在 ¥10 – ¥100,000 之间');
    }
    patch.minRecharge = Number(mr.toFixed(2));
  }
  if (body.discount_rate !== undefined) {
    const d = Number(body.discount_rate);
    if (!Number.isFinite(d) || d > 1 || d < 0.1) {
      throw Errors.validation('拿货折扣需在 0.10 – 1.00 之间');
    }
    const normalizedDiscount = Number(d.toFixed(2));
    if (normalizedDiscount + 0.0001 < myFloor) {
      throw new AppError(
        'VALIDATION_ERROR',
        `防亏拦截：给下级设置的拿货折扣（${discountDisplay(normalizedDiscount).zhFold}折）不得低于您自身的底价（${discountDisplay(myFloor).zhFold}折）！`,
        { details: { sub_code: 'DOWNLINE_DISCOUNT_BELOW_FLOOR', min_safe_discount: myFloor } }
      );
    }
    patch.discountRate = normalizedDiscount;
  }
  if (body.badge_color !== undefined) patch.badgeColor = body.badge_color;
  if (Array.isArray(body.perks)) patch.perksJson = JSON.stringify(body.perks);

  await updateDownlineTierRepo(db, tierId, ctx.agent.id, patch);
  return { ok: true };
}

/** 删除自建下级等级（若有下级正在使用则拒绝删除） */
export async function deleteMyDownlineTier(env: Env, ctx: ActiveAgentContext, tierId: number) {
  const db = createDb(env.DB);
  const inUse = await countDownlinesUsingTier(db, ctx.agent.id, tierId);
  if (inUse > 0) {
    throw Errors.validation(`当前有 ${inUse} 位直属下级正在使用此等级，请先为其调整等级后再删除。`);
  }
  await deleteDownlineTierRepo(db, tierId, ctx.agent.id);
  return { ok: true };
}

/** 调整直属下级分站的代理等级或启用/封禁状态 */
export async function updateDirectDownline(
  env: Env,
  ctx: ActiveAgentContext,
  downlineId: number,
  body: AgentDownlineUpdateInput
) {
  const db = createDb(env.DB);
  const found = await findDirectDownlineAgent(db, downlineId, ctx.agent.id);
  if (!found) throw Errors.forbidden('仅可管理您的直属下级分站');

  const patch: { tierId?: number; status?: string } = {};
  if (body.tier_id !== undefined) {
    const validTier = await findAgentTierByScope(db, ctx.agent.id, { tierId: body.tier_id });
    if (!validTier) throw Errors.validation('只能将直属下级调整为您自己创建的代理等级');
    patch.tierId = body.tier_id;
  }
  if (body.status === 'active' || body.status === 'suspended') {
    patch.status = body.status;
  }

  await updateDirectDownlineRepo(db, downlineId, ctx.agent.id, patch);
  return { ok: true };
}

/** 查询代理收益提现历史 */
export async function listAgentWithdrawals(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const withdrawals = await listAgentWithdrawalsRepo(db, ctx.agent.id);
  return { balance: ctx.user.balance, withdrawals };
}

/** 申请代理佣金提现（CAS 原子扣减钱包余额冻结，提交时固化手续费与预计实付金额） */
export async function createAgentWithdrawal(env: Env, ctx: ActiveAgentContext, body: AgentWithdrawalInput) {
  const db = createDb(env.DB);
  const amount = roundCurrency(body.amount);
  const feeRate = await readAgentWithdrawalFeePct(db);
  const feeAmount = feeRate > 0 ? roundCurrency((amount * feeRate) / 100) : 0;
  const netAmount = roundCurrency(Math.max(0, amount - feeAmount));
  const channel = body.channel;
  const accountInfo = body.account_info.trim();
  const accountName = (body.account_name || '').trim();

  const created = await createWithdrawalWithWalletPosting(db, {
    agentId: ctx.agent.id,
    userId: ctx.user.id,
    amount,
    feeRate,
    feeAmount,
    netAmount,
    channel,
    accountInfo,
    accountName,
  });
  if (!created) {
    throw Errors.validation(
      `可提现余额不足（申请 ¥${amount.toFixed(2)}，当前余额 ¥${ctx.user.balance.toFixed(2)}）`
    );
  }

  void dispatchOpsNotification(env, 'withdrawal', '新代理提现申请', [
    `分站：${ctx.agent.brand_name} (@${ctx.agent.slug})`,
    `申请金额：¥${amount.toFixed(2)}${feeAmount > 0 ? `（手续费 ${feeRate}% = ¥${feeAmount.toFixed(2)}，应打款 ¥${netAmount.toFixed(2)}）` : ''}`,
    `渠道与账号：${channel} / ${accountInfo}`,
  ]);

  return {
    ok: true,
    id: created.id,
    balance: created.balance,
    fee_rate: feeRate,
    fee_amount: feeAmount,
    net_amount: netAmount,
  };
}
