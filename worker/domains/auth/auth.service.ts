import type { LoginInput, RegisterInput, TopupDemoInput } from '@shared/index';
import type { AgentTier, AuthUser } from '../../db/types';
import { type Env, getRegistrationWelcomeCredit, isSandboxEnabled, type TenantContext } from '../../env';
import {
  generateRandomCode,
  hashPassword,
  normalizeSubdomainSlug,
  RESERVED_SUBDOMAINS,
  verifyPassword,
} from '../../infra/auth-crypto';
import { encryptSecret, sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { getClientIp, verifyTurnstileIfConfigured } from '../../infra/security';
import {
  issueReferralCodeIfEnabledForSite,
  resolveReferrerUserIdOnRegister,
} from '../account/affiliate.service';
import { resolveTenantContext } from '../tenant/tenant.service';
import { assertAdminLogin2FaIfEnabled } from './admin-2fa.service';
import {
  createAgentRecord,
  createUserRecord,
  existsAgentBySlug,
  findActiveAgentById,
  findActiveAgentBySlug,
  findAgentByUserId,
  findAgentTierById,
  findEligibleAgentTier,
  findFallbackAgentTier,
  findUserById,
  findUserByIdAndEmail,
  findUserBySiteEmail,
  incrementUserBalance,
  insertLoginAuditLog,
  insertWalletTxRecord,
  isEmailBlacklisted,
  mapAgentRowWithSecret,
  mapAgentTierRow,
  mapAuthUserRow,
  seedStarterDownlineTier,
  updateAgentTierId,
  updateUserRole,
} from './auth.repo';
import { issueAuthSession, readAuthSession } from './auth.session';

/**
 * 鉴权 Bearer JWT 并强制执行租户级账号隔离：
 * - 在站点 X 注册的账号仅允许在站点 X 登录访问；
 * - 代理店主例外：店主账号可访问自家独立分站域名以便直接进入代理工作台。
 */
export async function getAuthUser(
  req: Request,
  env: Env,
  preResolvedTenant?: TenantContext
): Promise<AuthUser | null> {
  const userRow = await readAuthSession(req, env);
  if (!userRow) return null;

  const tenant = preResolvedTenant ?? (await resolveTenantContext(req, env));
  if (userRow.role === 'admin' && tenant.isSubAgent) return null;
  const currentSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;

  const sameSite = Number(userRow.siteAgentId || 0) === currentSiteAgentId;
  const isOwnerVisitingOwnStore =
    currentSiteAgentId > 0 &&
    tenant.ownerUserId !== null &&
    Number(tenant.ownerUserId) === Number(userRow.id);

  if (!sameSite && !isOwnerVisitingOwnStore) {
    return null;
  }
  // 拉黑账号立即拒绝会话认证；非管理员同时执行全站同邮箱黑名单联防
  if (userRow.status && userRow.status !== 'active') {
    return null;
  }
  if (userRow.role !== 'admin' && (await isEmailBlacklisted(createDb(env.DB), userRow.email))) {
    return null;
  }

  return mapAuthUserRow(userRow);
}

/** 获取代理有效等级（若存在上级代理，自动按上级拿货折扣底线钳位防倒挂） */
export async function getUserAgentTier(env: Env, userId: number): Promise<AgentTier | null> {
  const db = createDb(env.DB);
  const agent = await findAgentByUserId(db, userId);
  if (agent?.status !== 'active') return null;

  let parentFloor = 0;
  if (agent.parentAgentId) {
    const parentAgent = await findActiveAgentById(db, agent.parentAgentId);
    if (parentAgent?.tierId) {
      const parentTier = await findAgentTierById(db, parentAgent.tierId);
      if (parentTier) parentFloor = Number(parentTier.discountRate || 0);
    }
  }

  const clampTierFloor = (t: AgentTier | null): AgentTier | null => {
    if (!t) return null;
    if (parentFloor > 0 && Number(t.discount_rate) < parentFloor) {
      return { ...t, discount_rate: parentFloor };
    }
    return t;
  };

  if (agent.tierId) {
    const tierRow = await findAgentTierById(db, agent.tierId);
    if (tierRow) return clampTierFloor(mapAgentTierRow(tierRow));
  }

  const fallback = await findFallbackAgentTier(db, agent.parentAgentId ?? 0);
  return clampTierFloor(fallback ? mapAgentTierRow(fallback) : null);
}

/** 解析新代理的上级血缘路径与层级深度 */
async function resolveParentLineage(
  env: Env,
  parentSlug?: string | null,
  parentId?: number | null
): Promise<{ parentAgentId: number | null; depth: number; ancestorPath: string }> {
  const db = createDb(env.DB);
  const parent = parentId
    ? await findActiveAgentById(db, parentId)
    : parentSlug
      ? await findActiveAgentBySlug(db, parentSlug)
      : null;

  if (!parent?.canRecruit) {
    return { parentAgentId: null, depth: 1, ancestorPath: '/' };
  }

  const basePath = parent.ancestorPath?.endsWith('/') ? parent.ancestorPath : '/';
  return {
    parentAgentId: parent.id,
    depth: Number(parent.depth || 1) + 1,
    ancestorPath: `${basePath}${parent.id}/`,
  };
}

/** 生成全局唯一的代理分站子域 Slug（跳过平台保留黑名单） */
async function generateUniqueAgentSlug(env: Env, seedText: string, userId: number): Promise<string> {
  const db = createDb(env.DB);
  const cleaned = normalizeSubdomainSlug(seedText).slice(0, 12);
  const base = cleaned.length >= 3 && !RESERVED_SUBDOMAINS.has(cleaned) ? cleaned : 'shop';
  const candidates = [`${base}${userId}`, `${base}${userId}${generateRandomCode('', 3).toLowerCase()}`];
  for (let i = 0; i < 6; i++) {
    candidates.push(`shop${generateRandomCode('', 6).toLowerCase()}`);
  }
  for (const cand of candidates) {
    const slug = normalizeSubdomainSlug(cand);
    if (slug.length < 3 || RESERVED_SUBDOMAINS.has(slug)) continue;
    if (!(await existsAgentBySlug(db, slug))) return slug;
  }
  return `s${userId}${Date.now().toString(36).slice(-5)}`;
}

/** 准备新店铺的身份和密钥，写入由调用方的业务事务负责。 */
export async function prepareAgentAccount(
  env: Env,
  user: { id: number; email: string; displayName: string },
  ownerAgentId: number,
  options?: { desiredSlug?: string; desiredBrandName?: string }
) {
  const db = createDb(env.DB);
  const lineage = await resolveParentLineage(env, null, ownerAgentId > 0 ? ownerAgentId : null);
  const cleanedDesired = options?.desiredSlug ? normalizeSubdomainSlug(options.desiredSlug) : '';
  const canUseDesired =
    cleanedDesired.length >= 3 &&
    cleanedDesired.length <= 24 &&
    !RESERVED_SUBDOMAINS.has(cleanedDesired) &&
    !(await existsAgentBySlug(db, cleanedDesired));
  const slug = canUseDesired
    ? cleanedDesired
    : await generateUniqueAgentSlug(env, cleanedDesired || user.email.split('@')[0] || 'shop', user.id);
  const customBrand = (options?.desiredBrandName || '').trim().slice(0, 64);
  const rawApiKey = generateRandomCode('ah_agent_', 16).replace(/-/g, '');
  const [apiKeyHash, apiKeyEnc] = await Promise.all([sha256Hex(rawApiKey), encryptSecret(env, rawApiKey)]);
  return {
    userId: user.id,
    ...lineage,
    slug,
    brandName: customBrand || `${user.displayName} Store`,
    brandTagline: '严选正版数字席位 · 极速自动交付',
    markupPercent: 12,
    apiKey: crypto.randomUUID(),
    apiKeyHash,
    apiKeyEnc,
  };
}

/** 按累计充值金额自动开通或升级代理商等级，并初始化默认下级招募等级 */
export async function syncUserTierByRecharge(
  env: Env,
  userId: number,
  ownerAgentId = 0,
  explicitTierId?: number | null
): Promise<{
  tier: AgentTier | null;
  autoCreatedAgent: boolean;
  agentId: number | null;
  agentSlug: string | null;
}> {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) return { tier: null, autoCreatedAgent: false, agentId: null, agentSlug: null };

  const existingAgent = await findAgentByUserId(db, userId);
  const tierScopeOwnerId = existingAgent ? Number(existingAgent.parentAgentId || 0) : ownerAgentId;

  const eligibleRow = await findEligibleAgentTier(db, tierScopeOwnerId, user.totalRecharged, explicitTierId);
  if (!eligibleRow) {
    return {
      tier: null,
      autoCreatedAgent: false,
      agentId: existingAgent?.id ?? null,
      agentSlug: existingAgent?.slug ?? null,
    };
  }
  const eligibleTier = mapAgentTierRow(eligibleRow);

  let autoCreatedAgent = false;
  let agentId: number | null = existingAgent?.id ?? null;
  let agentSlug: string | null = existingAgent?.slug ?? null;

  if (existingAgent) {
    const currentTier = existingAgent.tierId ? await findAgentTierById(db, existingAgent.tierId) : null;
    if (
      !currentTier ||
      eligibleTier.level_rank >= currentTier.levelRank ||
      eligibleTier.discount_rate < currentTier.discountRate
    ) {
      await updateAgentTierId(db, existingAgent.id, eligibleTier.id);
    }
  } else {
    const account = await prepareAgentAccount(env, user, ownerAgentId);
    agentId = await createAgentRecord(db, { ...account, tierId: eligibleTier.id });
    agentSlug = account.slug;

    if (user.role === 'user') {
      await updateUserRole(db, user.id, 'agent');
    }
    autoCreatedAgent = true;

    if (eligibleTier.discount_rate <= 0.94 && agentId) {
      const childDiscount = Number(Math.min(0.96, eligibleTier.discount_rate + 0.06).toFixed(2));
      await seedStarterDownlineTier(db, agentId, childDiscount);
    }
  }

  return { tier: eligibleTier, autoCreatedAgent, agentId, agentSlug };
}

/** 会员注册业务编排（含租户隔离、Turnstile 校验与沙盒体验余额发放） */
export async function registerUser(env: Env, req: Request, tenant: TenantContext, input: RegisterInput) {
  const tsCheck = await verifyTurnstileIfConfigured(
    req,
    env,
    'register',
    input['cf-turnstile-response'] || input.turnstile_token
  );
  if (!tsCheck.ok) throw Errors.forbidden(tsCheck.error);

  const db = createDb(env.DB);
  const currentSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const email = input.email.toLowerCase();
  const displayName = (input.display_name || email.split('@')[0] || '会员用户').trim();
  const welcomeBonus = getRegistrationWelcomeCredit(env);

  // 全站跨分站黑名单联防：只要该邮箱在主站或任一分站被拉黑，全站禁止再注册
  if (await isEmailBlacklisted(db, email)) {
    throw Errors.forbidden('该邮箱已被列入平台黑名单，禁止注册与访问');
  }

  const exists = await findUserBySiteEmail(db, currentSiteAgentId, email);
  if (exists) {
    throw Errors.conflict('该邮箱已在本站注册，请直接登录');
  }

  const passwordHash = await hashPassword(input.password);
  const referredByUserId = await resolveReferrerUserIdOnRegister(db, input.referral_code, currentSiteAgentId);
  const userId = await createUserRecord(db, {
    siteAgentId: currentSiteAgentId,
    email,
    displayName,
    passwordHash,
    role: 'user',
    balance: welcomeBonus,
    referredByUserId,
  });
  const referralCode = await issueReferralCodeIfEnabledForSite(db, userId, currentSiteAgentId);

  const token = await issueAuthSession(db, env, {
    id: userId,
    role: 'user',
    siteAgentId: currentSiteAgentId,
    sessionVersion: 0,
  });

  if (welcomeBonus > 0) {
    await insertWalletTxRecord(db, {
      userId,
      type: 'recharge',
      amount: welcomeBonus,
      balanceAfter: welcomeBonus,
      note: '新会员注册赠送沙盒体验余额',
    });
  }
  await insertLoginAuditLog(
    db,
    userId,
    getClientIp(req),
    (req.headers.get('User-Agent') || '').slice(0, 180)
  );

  return {
    token,
    user: {
      id: userId,
      site_agent_id: currentSiteAgentId,
      email,
      display_name: displayName,
      role: 'user',
      balance: welcomeBonus,
      total_recharged: 0,
      referral_code: referralCode,
      promo_balance: 0,
      agent: null,
      agent_tier: null,
    },
  };
}

/** 会员/店主登录业务编排（禁止总控 admin 从代理分站登录以防反溯源） */
export async function loginUser(env: Env, req: Request, tenant: TenantContext, input: LoginInput) {
  const tsCheck = await verifyTurnstileIfConfigured(
    req,
    env,
    'login',
    input['cf-turnstile-response'] || input.turnstile_token
  );
  if (!tsCheck.ok) throw Errors.forbidden(tsCheck.error);

  const db = createDb(env.DB);
  const currentSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const email = input.email.toLowerCase();

  let userRow = await findUserBySiteEmail(db, currentSiteAgentId, email);
  if (!userRow && currentSiteAgentId > 0 && tenant.ownerUserId) {
    userRow = await findUserByIdAndEmail(db, tenant.ownerUserId, email);
  }

  if (!userRow || !(await verifyPassword(input.password, userRow.passwordHash))) {
    throw Errors.unauthorized('邮箱或密码不正确');
  }
  if (
    userRow.status === 'blacklisted' ||
    (userRow.role !== 'admin' && (await isEmailBlacklisted(db, email)))
  ) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止登录与访问');
  }
  if (userRow.status && userRow.status !== 'active') {
    throw Errors.forbidden('该账号已被限制访问，请联系平台客服处理');
  }
  if (currentSiteAgentId > 0 && userRow.role === 'admin') {
    throw Errors.unauthorized('邮箱或密码不正确');
  }
  await assertAdminLogin2FaIfEnabled(env, userRow, input.totp_code);

  const token = await issueAuthSession(db, env, userRow, currentSiteAgentId);

  const [agentRow, agentTier] = await Promise.all([
    findAgentByUserId(db, userRow.id),
    getUserAgentTier(env, userRow.id),
  ]);

  await insertLoginAuditLog(
    db,
    userRow.id,
    getClientIp(req),
    (req.headers.get('User-Agent') || '').slice(0, 180)
  );

  return {
    token,
    user: {
      ...mapAuthUserRow(userRow),
      agent: agentRow?.status === 'active' ? await mapAgentRowWithSecret(env, agentRow) : null,
      agent_tier: agentTier,
    },
  };
}

/** 查询当前已登录用户档案与代理权益 */
export async function getCurrentUserProfile(env: Env, req: Request, tenant: TenantContext) {
  const user = await getAuthUser(req, env, tenant);
  if (!user) return { user: null };

  const db = createDb(env.DB);
  const [agentRow, agentTier] = await Promise.all([
    findAgentByUserId(db, user.id),
    getUserAgentTier(env, user.id),
  ]);

  return {
    user: {
      ...user,
      agent: agentRow?.status === 'active' ? await mapAgentRowWithSecret(env, agentRow) : null,
      agent_tier: agentTier,
    },
  };
}

/** 本地沙盒测试余额加款（生产环境强制 403 禁用） */
export async function topupDemoBalance(env: Env, req: Request, tenant: TenantContext, input: TopupDemoInput) {
  if (!isSandboxEnabled(env)) {
    throw Errors.sandboxDisabled('生产环境已关闭沙盒测试余额加款接口');
  }
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized();

  const amount = Math.min(20000, Math.max(10, Number(input.amount || 100)));
  const db = createDb(env.DB);
  const updated = await incrementUserBalance(db, user.id, amount);
  const balAfter = updated?.balance ?? Number((user.balance + amount).toFixed(2));
  await insertWalletTxRecord(db, {
    userId: user.id,
    type: 'recharge',
    amount,
    balanceAfter: balAfter,
    refNo: `SBX-TOPUP-${Date.now()}`,
    note: '沙盒环境测试余额加款',
  });

  return {
    balance: balAfter,
    total_recharged: updated?.totalRecharged ?? (user.total_recharged || 0),
    added: amount,
  };
}
