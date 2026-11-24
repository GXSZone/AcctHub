import { discountDisplay } from '@shared/domain/money';
import { type Env, getRequiredJwtSecret } from '../../env';
import { generateRandomCode } from '../../infra/auth-crypto';
import { hmacSha256Hex, sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { bumpEdgeCacheVersion } from '../../infra/security';
import { rejectWithdrawalWithWalletPosting } from '../agent/withdrawal-posting.repo';
import { checkTierDiscountAgainstProducts } from './admin.margin';
import {
  countAgentsUsingTierRepo,
  createCouponRepo,
  createMainAgentTierRepo,
  deleteAvailableCdkRepo,
  deleteCouponRepo,
  deleteMainAgentTierRepo,
  findWithdrawalByIdRepo,
  insertRechargeCdksRepo,
  lockWithdrawalProcessedCasRepo,
  updateAgentAndCascadeFloorRepo,
  updateCouponActiveRepo,
  updateMainAgentTierAndCascadeRepo,
} from './admin.ops.repo';

export { processOrderRefund as refundAdminOrder } from '../refund/refund.service';

/** 调整代理状态/分成/加价/等级与单店能力覆写（变更等级时自动级联抬升下级折率防倒挂） */
export async function updateAdminAgent(
  env: Env,
  agentId: number,
  body: {
    status?: string;
    commission_rate?: number;
    markup_percent?: number;
    tier_id?: number;
    allow_private_products_override?: number | null;
    allow_own_payment_override?: number | null;
  }
) {
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.commission_rate !== undefined) patch.commissionRate = body.commission_rate;
  if (body.markup_percent !== undefined) patch.markupPercent = body.markup_percent;
  if (body.tier_id !== undefined) patch.tierId = body.tier_id;
  if (body.allow_private_products_override !== undefined) {
    patch.allowPrivateProductsOverride = body.allow_private_products_override;
  }
  if (body.allow_own_payment_override !== undefined) {
    patch.allowOwnPaymentOverride = body.allow_own_payment_override;
  }
  await updateAgentAndCascadeFloorRepo(createDb(env.DB), agentId, patch);
  bumpEdgeCacheVersion();
  return { ok: true };
}

async function evaluateTierLoss(env: Env, tierKey: string, discountRate: number) {
  const { losses, safe_min_discount } = await checkTierDiscountAgainstProducts(env, tierKey, discountRate);
  const lossConfirmation =
    losses.length > 0
      ? await hmacSha256Hex(
          getRequiredJwtSecret(env),
          JSON.stringify(['agent-tier-loss:v1', tierKey, discountRate, safe_min_discount, losses])
        )
      : null;
  return { loss_confirmation: lossConfirmation, safe_min_discount, loss_items: losses };
}

async function confirmedLossAudit(discountRate: number, confirmation: string | null) {
  return confirmation
    ? { loss_discount_rate: discountRate, loss_cost_version: await sha256Hex(confirmation) }
    : {};
}

function normalizeTierCode(code: string | undefined): string {
  return (code ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

export async function previewAdminAgentTierLoss(
  env: Env,
  params: { id?: number; code?: string; discountRate?: string }
) {
  const discountRate = Number(params.discountRate);
  if (!Number.isFinite(discountRate) || discountRate < 0.1 || discountRate > 1) {
    throw Errors.validation('代理拿货折扣必须在 0.10 – 1.00 之间');
  }
  const code = normalizeTierCode(params.code);
  if (params.id === undefined && !code) throw Errors.validation('请提供有效的代理等级代码');
  return evaluateTierLoss(
    env,
    params.id === undefined ? `create:${code}` : `update:${params.id}`,
    discountRate
  );
}

/** 创建主站招募代理等级（带全站在售商品防亏拦截） */
export async function createAdminAgentTier(
  env: Env,
  b: {
    code: string;
    name: string;
    level_rank: number;
    min_recharge: number;
    discount_rate: number;
    commission_rate: number;
    sub_override_rate?: number;
    max_sub_agents?: number;
    allow_custom_domain?: boolean;
    max_custom_domains?: number;
    allow_private_products?: boolean;
    allow_own_payment?: boolean;
    badge_color?: string;
    perks?: string[];
    loss_confirmation?: string;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  const discountRate = Number(b.discount_rate ?? 0.9);
  if (!Number.isFinite(discountRate) || discountRate < 0.1 || discountRate > 1) {
    return { status: 400, body: { error: '代理拿货折扣必须在 0.10 – 1.00 之间' } };
  }
  const code = normalizeTierCode(b.code) || `tier_${Date.now()}`;
  const risk = await evaluateTierLoss(env, `create:${code}`, discountRate);
  if (risk.loss_confirmation && b.loss_confirmation !== risk.loss_confirmation) {
    const { loss_items: losses, safe_min_discount } = risk;
    return {
      status: 400,
      body: {
        error: `防亏拦截：设置 ${discountDisplay(discountRate).zhFold} 折将导致 ${losses.length} 项在售商品/规格低于成本价亏损（如「${losses[0].product_title}」每单亏 ¥${losses[0].loss_amount}），当前全站安全最低折扣为 ${safe_min_discount}（${discountDisplay(safe_min_discount).zhFold}折）`,
        code: 'TIER_DISCOUNT_CAUSES_LOSS',
        safe_min_discount,
        loss_items: losses,
      },
    };
  }

  const id = await createMainAgentTierRepo(createDb(env.DB), {
    ownerAgentId: 0,
    code,
    name: b.name.trim(),
    levelRank: Number(b.level_rank || 1),
    minRecharge: Number(b.min_recharge || 100),
    discountRate,
    commissionRate: Number(b.commission_rate || 0),
    subOverrideRate: Number(b.sub_override_rate || 0),
    maxSubAgents: Number(b.max_sub_agents || 10),
    allowCustomDomain: b.allow_custom_domain === false ? 0 : 1,
    maxCustomDomains: Math.max(0, Number(b.max_custom_domains ?? 2)),
    allowPrivateProducts: b.allow_private_products ? 1 : 0,
    allowOwnPayment: b.allow_own_payment ? 1 : 0,
    badgeColor: b.badge_color || '#D97757',
    perksJson: JSON.stringify(Array.isArray(b.perks) ? b.perks : []),
  });
  return {
    status: 200,
    body: { id, ok: true, ...(await confirmedLossAudit(discountRate, risk.loss_confirmation)) },
  };
}

/** 更新主站代理等级（带防亏拦截与下级折率级联抬升） */
export async function updateAdminAgentTier(
  env: Env,
  id: number,
  b: {
    name?: string;
    level_rank?: number;
    min_recharge?: number;
    discount_rate?: number;
    commission_rate?: number;
    sub_override_rate?: number;
    max_sub_agents?: number;
    allow_custom_domain?: boolean;
    max_custom_domains?: number;
    allow_private_products?: boolean;
    allow_own_payment?: boolean;
    badge_color?: string;
    perks?: string[];
    loss_confirmation?: string;
  }
): Promise<{ status: number; body: Record<string, unknown> }> {
  let lossAudit: Awaited<ReturnType<typeof confirmedLossAudit>> = {};
  if (b.discount_rate !== undefined) {
    const discountRate = Number(b.discount_rate);
    if (!Number.isFinite(discountRate) || discountRate < 0.1 || discountRate > 1) {
      return { status: 400, body: { error: '代理拿货折扣必须在 0.10 – 1.00 之间' } };
    }
    const risk = await evaluateTierLoss(env, `update:${id}`, discountRate);
    if (risk.loss_confirmation && b.loss_confirmation !== risk.loss_confirmation) {
      const { loss_items: losses, safe_min_discount } = risk;
      return {
        status: 400,
        body: {
          safe_min_discount,
          loss_items: losses,
          error: `防亏拦截：将折扣调至 ${discountDisplay(discountRate).zhFold} 折会导致 ${losses.length} 项在售商品/规格折后价低于成本价（如「${losses[0].product_title}」每单亏 ¥${losses[0].loss_amount}），当前全站安全最低折扣为 ${safe_min_discount}（${discountDisplay(safe_min_discount).zhFold}折）`,
          code: 'TIER_DISCOUNT_CAUSES_LOSS',
        },
      };
    }
    lossAudit = await confirmedLossAudit(discountRate, risk.loss_confirmation);
  }

  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.level_rank !== undefined) patch.levelRank = b.level_rank;
  if (b.min_recharge !== undefined) patch.minRecharge = b.min_recharge;
  if (b.discount_rate !== undefined) patch.discountRate = b.discount_rate;
  if (b.commission_rate !== undefined) patch.commissionRate = b.commission_rate;
  if (b.sub_override_rate !== undefined) patch.subOverrideRate = b.sub_override_rate;
  if (b.max_sub_agents !== undefined) patch.maxSubAgents = b.max_sub_agents;
  if (b.allow_custom_domain !== undefined) patch.allowCustomDomain = b.allow_custom_domain ? 1 : 0;
  if (b.max_custom_domains !== undefined) patch.maxCustomDomains = Math.max(0, Number(b.max_custom_domains));
  if (b.allow_private_products !== undefined) patch.allowPrivateProducts = b.allow_private_products ? 1 : 0;
  if (b.allow_own_payment !== undefined) patch.allowOwnPayment = b.allow_own_payment ? 1 : 0;
  if (b.badge_color !== undefined) patch.badgeColor = b.badge_color;
  if (Array.isArray(b.perks)) patch.perksJson = JSON.stringify(b.perks);

  await updateMainAgentTierAndCascadeRepo(createDb(env.DB), id, patch);
  bumpEdgeCacheVersion();
  return { status: 200, body: { ok: true, ...lossAudit } };
}

export async function deleteAdminAgentTier(env: Env, id: number) {
  const db = createDb(env.DB);
  const inUse = await countAgentsUsingTierRepo(db, id);
  if (inUse > 0) {
    throw Errors.validation(`当前仍有 ${inUse} 个代理分站绑定在此等级下，请先调整这些代理的等级后再删除`);
  }
  await deleteMainAgentTierRepo(db, id);
  return { ok: true };
}

/** CAS 原子审核代理提现申请（驳回时自动退回冻结余额并记账） */
export async function reviewAgentWithdrawal(
  env: Env,
  id: number,
  body: { action?: 'paid' | 'rejected'; admin_note?: string }
) {
  if (body.action !== 'paid' && body.action !== 'rejected') {
    throw Errors.validation('无效的提现审核动作，必须显式传入 paid 或 rejected');
  }
  const db = createDb(env.DB);
  const w = await findWithdrawalByIdRepo(db, id);
  if (!w) throw Errors.notFound('提现申请不存在');
  if (w.status !== 'pending') throw Errors.conflict('该提现申请已处理，无法重复操作');

  const note = (body.admin_note || '').trim();
  const locked =
    body.action === 'rejected'
      ? await rejectWithdrawalWithWalletPosting(db, w, note)
      : await lockWithdrawalProcessedCasRepo(db, id, 'paid', note);
  if (!locked) throw Errors.conflict('状态已变更，请刷新重试');
  return { ok: true, status: body.action };
}

export async function createAdminCoupon(
  env: Env,
  body: {
    code?: string;
    name?: string;
    discount_type?: 'fixed' | 'percent';
    discount_value?: number;
    min_order_amount?: number;
    max_uses?: number;
    expires_at?: string;
  }
) {
  const code = (body.code || generateRandomCode('CPN', 8).replace(/-/g, '')).trim().toUpperCase();
  const name = (body.name || `优惠券 ${code}`).trim();
  const discountType = body.discount_type === 'percent' ? 'percent' : 'fixed';
  const discountValue = Number(body.discount_value ?? 5);
  if (
    !Number.isFinite(discountValue) ||
    discountValue <= 0 ||
    (discountType === 'percent' && discountValue > 90)
  ) {
    throw Errors.validation('优惠面额无效（折扣比例限 1–90%）');
  }
  const minOrderAmount = Number(body.min_order_amount ?? 0);
  const maxUses = Number(body.max_uses ?? 100);
  if (!Number.isFinite(minOrderAmount) || minOrderAmount < 0 || !Number.isFinite(maxUses) || maxUses < 0) {
    throw Errors.validation('最低订单金额或可用次数必须为有效非负数字');
  }

  const id = await createCouponRepo(createDb(env.DB), {
    code,
    name,
    discountType,
    discountValue,
    minOrderAmount: Math.max(0, minOrderAmount),
    maxUses: Math.max(0, Math.floor(maxUses)),
    expiresAt: (body.expires_at || '').trim() || null,
    isActive: 1,
  });
  return { ok: true, id, code };
}

export async function updateAdminCoupon(env: Env, id: number, isActive?: number) {
  await updateCouponActiveRepo(createDb(env.DB), id, isActive);
  return { ok: true };
}

export async function deleteAdminCoupon(env: Env, id: number) {
  await deleteCouponRepo(createDb(env.DB), id);
  return { ok: true };
}

export async function generateAdminCdks(
  env: Env,
  body: { amount?: number; count?: number; batch_note?: string; prefix?: string }
) {
  const rawAmt = Number(body.amount ?? 0);
  const rawCnt = Number(body.count ?? 5);
  if (!Number.isFinite(rawAmt) || !Number.isFinite(rawCnt)) {
    throw Errors.validation('制卡面额与数量必须为有效数字');
  }
  const amount = Number(rawAmt.toFixed(2));
  const count = Math.min(50, Math.max(1, Math.floor(rawCnt)));
  if (amount < 1 || amount > 50000) throw Errors.validation('单张面额需在 ¥1 – ¥50,000 之间');

  const prefix =
    (body.prefix || 'CDK-')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 8) || 'CDK-';
  const batchNote = (body.batch_note || '').trim().slice(0, 80);
  const generated: string[] = [];
  for (let i = 0; i < count; i++) generated.push(generateRandomCode(prefix, 12));

  await insertRechargeCdksRepo(
    createDb(env.DB),
    generated.map((code) => ({ code, amount, batchNote }))
  );
  return { ok: true, generated, count: generated.length };
}

export async function deleteAdminCdk(env: Env, id: number) {
  await deleteAvailableCdkRepo(createDb(env.DB), id);
  return { ok: true };
}
