import type { AgentRechargeInput } from '@shared/index';
import { type Env, isSandboxEnabled, type TenantContext } from '../../env';
import { getCloudflareSaasConfig } from '../../infra/cloudflare-saas';
import { generateBizNo } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { getUserBalance } from '../account/wallet.repo';
import { findAgentByUserId, findUserById, mapAgentRowWithSecret } from '../auth/auth.repo';
import { getAuthUser, getUserAgentTier } from '../auth/auth.service';
import { isAsyncPaymentProvider } from '../payment/payment.gateway';
import { createPaymentIntent } from '../payment/payment.service';
import { checkAgentSlugAvailability } from './agent.brand.service';
import { assertActiveAgent, parseTierWithPerks } from './agent.guard';
import {
  findAgentTierByScope,
  listAgentTiersByOwner,
  listUserRechargeRecords,
  loadAgentWorkbenchData,
  readAgentWithdrawalFeePct,
} from './agent.repo';
import { planAgentUpgrade } from './upgrade-plan.service';
import { postAgentUpgradePayment } from './upgrade-posting.repo';

/** 公开查询当前站点开放招募的代理等级列表 */
export async function listPublicStorefrontTiers(env: Env, tenant: TenantContext) {
  const db = createDb(env.DB);
  const ownerScope = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const tiers = await listAgentTiersByOwner(db, ownerScope);
  return {
    owner_agent_id: ownerScope,
    site_brand: tenant.isSubAgent ? tenant.brandName : null,
    tiers: tiers.map(parseTierWithPerks),
  };
}

/** 获取当前已登录用户的代理工作台全量数据（兼容未开通前与已开通 6-Tab 状态） */
export async function getAgentWorkbenchBootstrap(env: Env, req: Request, tenant: TenantContext) {
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');

  const db = createDb(env.DB);
  const currentSiteOwnerId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const agentRow = await findAgentByUserId(db, user.id);
  if (agentRow) assertActiveAgent(user, agentRow);
  const agent = agentRow ? await mapAgentRowWithSecret(env, agentRow) : null;
  const upstreamOwnerId = agent ? Number(agent.parent_agent_id || 0) : currentSiteOwnerId;

  const [upstreamTiersRaw, rechargeRecordsList, saasCfg, currentTier, withdrawalFeePct] = await Promise.all([
    listAgentTiersByOwner(db, upstreamOwnerId),
    listUserRechargeRecords(db, user.id),
    getCloudflareSaasConfig(env),
    getUserAgentTier(env, user.id),
    readAgentWithdrawalFeePct(db),
  ]);

  const upstreamTiers = upstreamTiersRaw.map(parseTierWithPerks);
  const nextTier =
    upstreamTiers.find((t) =>
      currentTier
        ? t.level_rank > currentTier.level_rank || t.discount_rate < currentTier.discount_rate
        : true
    ) || null;

  const domainConfig = {
    neutral_base_domain: saasCfg.neutralBaseDomain,
    saas_cname_target: saasCfg.cnameTarget,
    cf_saas_enabled: Boolean(saasCfg.zoneId && saasCfg.apiToken),
    provisioning_mode: saasCfg.zoneId && saasCfg.apiToken ? 'cloudflare_saas' : 'manual_review',
  };

  if (!agent) {
    return {
      agent: null,
      tier: null,
      next_tier: nextTier,
      all_tiers: upstreamTiers,
      my_downline_tiers: [],
      total_recharged: user.total_recharged ?? 0,
      balance: user.balance,
      sub_agents: [],
      direct_sub_count: 0,
      total_downline_count: 0,
      commission_ledger: [],
      withdrawals: [],
      recharge_records: rechargeRecordsList,
      recent_orders: [],
      withdrawal_fee_pct: withdrawalFeePct,
      domain_config: domainConfig,
    };
  }

  const wb = await loadAgentWorkbenchData(db, agent.id);
  const rawTotalRecharged = Number(user.total_recharged ?? 0);
  // 若管理员曾手动调低等级导致历史 total_recharged 高于当前等级门槛，展示与补差基准自动对齐当前等级
  const effectiveTotalRecharged =
    currentTier && nextTier && rawTotalRecharged > Number(currentTier.min_recharge || 0)
      ? Number(currentTier.min_recharge || 0)
      : rawTotalRecharged;
  return {
    agent,
    tier: currentTier ? parseTierWithPerks(currentTier) : null,
    next_tier: nextTier,
    all_tiers: upstreamTiers,
    my_downline_tiers: wb.myTiers.map(parseTierWithPerks),
    total_recharged: effectiveTotalRecharged,
    balance: user.balance,
    sub_agents: wb.directSubs,
    direct_sub_count: wb.directSubs.length,
    total_downline_count: wb.totalDownlineCount,
    commission_ledger: wb.ledger,
    withdrawals: wb.withdrawals,
    recharge_records: rechargeRecordsList,
    recent_orders: wb.recentOrders,
    withdrawal_fee_pct: withdrawalFeePct,
    domain_config: domainConfig,
  };
}

/** 代理开通/补差升级（支持异步支付网关收银、余额 CAS 扣款与 CAS 防并发刷上级开户费） */
export async function rechargeAgentTier(
  env: Env,
  req: Request,
  tenant: TenantContext,
  body: AgentRechargeInput
) {
  if (tenant.isSuspended) {
    throw Errors.forbidden('当前上级分站已被暂停服务，无法在此开通或升级代理');
  }
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  if (user.role === 'admin') {
    throw Errors.forbidden('总管理员账号不可购买或升级代理身份，请在「运营总控后台」统一管理。');
  }

  const db = createDb(env.DB);
  const existingAgent = await findAgentByUserId(db, user.id);
  if (existingAgent && existingAgent.status !== 'active') {
    throw Errors.forbidden('您的代理资格已被冻结，请联系平台客服处理');
  }

  const upstreamOwnerId = existingAgent
    ? Number(existingAgent.parentAgentId || 0)
    : tenant.isSubAgent && tenant.agentId
      ? tenant.agentId
      : 0;

  if (existingAgent && existingAgent.id === upstreamOwnerId) {
    throw Errors.validation('不能在自己的分站为自己开通代理');
  }

  const targetTier = await findAgentTierByScope(db, upstreamOwnerId, {
    tierId: body.target_tier_id,
    tierCode: body.target_tier_code,
  });
  if (!targetTier) {
    throw Errors.notFound('当前站点暂未开放该代理等级，请联系站长配置。');
  }

  const currentTier = existingAgent ? await getUserAgentTier(env, user.id) : null;
  if (
    currentTier &&
    currentTier.level_rank >= targetTier.level_rank &&
    currentTier.discount_rate <= targetTier.discount_rate
  ) {
    throw Errors.validation(`您当前已达成或超越「${targetTier.name}」，无需重复购买。`);
  }

  const rawPaid = Number(user.total_recharged || 0);
  const effectivePaid =
    currentTier && rawPaid > Number(currentTier.min_recharge || 0)
      ? Number(currentTier.min_recharge || 0)
      : rawPaid;
  const amount = Math.max(0, Number((targetTier.min_recharge - effectivePaid).toFixed(2)));
  if (amount <= 0) {
    throw Errors.validation(`您当前已达成或超越「${targetTier.name}」，无需重复购买。`);
  }

  let desiredSlug: string | undefined;
  let desiredBrandName: string | undefined;
  if (!existingAgent) {
    const rawDesiredSlug = (body.desired_slug || '').trim();
    if (rawDesiredSlug) {
      const check = await checkAgentSlugAvailability(env, rawDesiredSlug, null);
      if (!check.available) {
        throw Errors.conflict(check.reason || '该二级域名前缀不可用，请更换后重试');
      }
      desiredSlug = check.normalized;
    }
    const rawBrand = (body.desired_brand_name || '').trim().slice(0, 64);
    if (rawBrand) desiredBrandName = rawBrand;
  }

  const payMethod = String(body.payment_method || '').trim();
  if (isAsyncPaymentProvider(payMethod)) {
    const originUrl = new URL(req.url).origin;
    const refNo = generateBizNo('AGT');
    const intent = await createPaymentIntent(env, {
      bizType: 'agent_upgrade',
      bizRef: refNo,
      userId: user.id,
      siteAgentId: upstreamOwnerId,
      provider: payMethod,
      amountCny: amount,
      subject: `开通/升级代理等级「${targetTier.name}」`,
      originUrl,
      returnUrl: `${originUrl}/agent`,
      customerEmail: user.email,
      payload: {
        target_tier_id: targetTier.id,
        upstream_owner_id: upstreamOwnerId,
        ...(desiredSlug ? { desired_slug: desiredSlug } : {}),
        ...(desiredBrandName ? { desired_brand_name: desiredBrandName } : {}),
      },
    });
    return {
      ok: true,
      requires_payment: true,
      payment_intent: {
        intent_no: intent.intent_no,
        provider: intent.provider,
        currency: intent.currency,
        amount_cny: intent.amount_cny,
        pay_amount: intent.pay_amount,
        pay_url: intent.pay_url,
        qr_content: intent.qr_content,
        status: intent.status,
        expires_at: intent.expires_at,
        sandbox_simulated: intent.sandbox_simulated,
        view_token: intent.view_token,
      },
    };
  }

  const mustDeductBalance = !isSandboxEnabled(env) || payMethod === 'balance';
  const ledgerRefNo = generateBizNo('AGT');
  const plan = await planAgentUpgrade(env, {
    userId: user.id,
    amount,
    ownerId: upstreamOwnerId,
    tierId: targetTier.id,
    desiredSlug,
    desiredBrandName,
  });
  if (plan.tier?.id !== targetTier.id || !plan.changeTier) {
    throw Errors.conflict('代理等级已变更，请重新选择要升级的等级');
  }
  const payment = await postAgentUpgradePayment(db, {
    refNo: ledgerRefNo,
    plan,
    amount,
    tierName: targetTier.name,
    paymentMethod: mustDeductBalance ? 'balance' : payMethod || 'demo_instant',
    fromBalance: mustDeductBalance,
    expectedTotal: Number(rawPaid.toFixed(2)),
  });
  if (!payment.applied) {
    if (mustDeductBalance && (await getUserBalance(db, user.id)) < amount) {
      throw Errors.insufficientBalance(
        `账户钱包余额不足（开通/升级「${targetTier.name}」需 ¥${amount.toFixed(2)}，当前余额 ¥${Number(user.balance || 0).toFixed(2)}），请先充值或使用充值卡密兑换`
      );
    }
    throw Errors.conflict('您的代理等级状态正在变更中，请勿并发重复提交');
  }

  const { tier, newAgent, settlement } = plan;
  const parentSettlement = settlement && {
    parentIncome: settlement.parentIncome,
    platformCut: settlement.platformCut,
    platformFeePct: settlement.platformFeePct,
  };

  const [updatedUser, updatedAgentRow] = await Promise.all([
    findUserById(db, user.id),
    findAgentByUserId(db, user.id),
  ]);

  return {
    ok: true,
    added: amount,
    balance: updatedUser?.balance ?? user.balance,
    total_recharged: updatedUser?.totalRecharged ?? plan.nextTotalRecharged,
    unlocked_tier: tier ? parseTierWithPerks(tier) : null,
    auto_created_agent: Boolean(newAgent),
    parent_settlement: parentSettlement,
    agent: updatedAgentRow ? await mapAgentRowWithSecret(env, updatedAgentRow) : null,
  };
}
