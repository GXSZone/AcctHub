import type { OAuthProvider, PublicOAuthProviderDto } from '@shared/contracts/oauth.contract';
import { type Env, getRegistrationWelcomeCredit, type TenantContext } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { hashPassword } from '../../infra/auth-crypto';
import { sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { bumpEdgeCacheVersion } from '../../infra/security';
import {
  issueReferralCodeIfEnabledForSite,
  resolveReferrerUserIdOnRegister,
} from '../account/affiliate.service';
import {
  createUserRecord,
  findAgentByUserId,
  findUserById,
  findUserBySiteEmail,
  insertLoginAuditLog,
  insertWalletTxRecord,
  isEmailBlacklisted,
  mapAgentRowWithSecret,
  mapAuthUserRow,
} from '../auth/auth.repo';
import { getAuthUser, getUserAgentTier } from '../auth/auth.service';
import { issueAuthSession } from '../auth/auth.session';
import { extractClientIp } from '../orders/orders.risk-fee';
import { buildOAuthAuthorizeUrl, fetchOAuthUserProfile } from './oauth.providers';
import {
  consumeOAuthExchangeTicketAtomicRepo,
  consumeOAuthStateAtomicRepo,
  deleteUserOAuthIdentityRepo,
  findOAuthIdentityByUnionIdRepo,
  findOAuthIdentityRepo,
  insertOAuthExchangeTicketRepo,
  insertOAuthStateRepo,
  listUserOAuthIdentitiesRepo,
  loadOAuthConfigsByOwnerRepo,
  saveOAuthConfigsByOwnerRepo,
  upsertUserOAuthIdentityRepo,
} from './oauth.repo';

const STATE_TTL_MS = 10 * 60_000;
const TICKET_TTL_MS = 60_000;

function randomHex(prefix: string, bytesLen = 24): string {
  const bytes = new Uint8Array(bytesLen);
  crypto.getRandomValues(bytes);
  return `${prefix}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sanitizeRedirectPath(raw?: string): string {
  const trimmed = (raw || '/').trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}

function resolveSiteAgentId(tenant: TenantContext): number {
  return tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
}

/** 查询当前站点自身已启用且配置完整的公开 OAuth 登录渠道（主站与分站严格独立隔离，零跨站暴露） */
export async function listPublicOAuthProviders(
  env: Env,
  tenant: TenantContext
): Promise<{ providers: PublicOAuthProviderDto[] }> {
  if (tenant.isSuspended) return { providers: [] };
  const db = createDb(env.DB);
  const ownerAgentId = resolveSiteAgentId(tenant);
  const { credentials } = await loadOAuthConfigsByOwnerRepo(env, db, ownerAgentId);
  const providers: PublicOAuthProviderDto[] = [];
  for (const [provider, creds] of credentials.entries()) {
    if (creds.enabled && creds.clientId && creds.clientSecret) {
      providers.push({ provider, enabled: true });
    }
  }
  return { providers };
}

/** 发起 OAuth 授权跳转（主站与分站均严格使用各自独立的 OAuth 凭证与自身域名回调，杜绝白牌暴露） */
export async function startOAuthAuthorize(
  env: Env,
  req: Request,
  tenant: TenantContext,
  input: { provider: OAuthProvider; mode: 'login' | 'bind'; redirect_path?: string; referral_code?: string }
) {
  if (tenant.isSuspended) throw Errors.forbidden('当前代理分站已暂停营业');
  const db = createDb(env.DB);
  const siteAgentId = resolveSiteAgentId(tenant);
  const { callbackBaseUrl, credentials } = await loadOAuthConfigsByOwnerRepo(env, db, siteAgentId);
  const creds = credentials.get(input.provider);
  if (!creds?.enabled || !creds.clientId || !creds.clientSecret) {
    throw Errors.validation('当前站点尚未启用该第三方登录渠道或未完成密钥配置');
  }

  let bindUserId: number | null = null;
  if (input.mode === 'bind') {
    const authUser = await getAuthUser(req, env, tenant);
    if (!authUser) throw Errors.unauthorized('绑定第三方账号前请先登录');
    bindUserId = authUser.id;
  }

  const reqOrigin = new URL(req.url).origin;
  const callbackOrigin = callbackBaseUrl || reqOrigin;
  const redirectUri = `${callbackOrigin}/api/auth/oauth/${input.provider}/callback`;
  const rawState = randomHex('oas_', 20);
  const stateHash = await sha256Hex(rawState);
  const codeVerifier = randomHex('pkce_', 24);

  await insertOAuthStateRepo(db, {
    stateHash,
    provider: input.provider,
    siteAgentId,
    returnOrigin: reqOrigin,
    redirectPath: sanitizeRedirectPath(input.redirect_path),
    mode: input.mode,
    bindUserId,
    codeVerifier,
    referralCode: (input.referral_code || '').trim().toUpperCase().slice(0, 32),
    expiresAt: Date.now() + STATE_TTL_MS,
  });

  const authorizeUrl = await buildOAuthAuthorizeUrl({
    creds,
    redirectUri,
    state: rawState,
    codeVerifier,
  });
  return { ok: true, authorize_url: authorizeUrl };
}

/** 处理第三方 OAuth 回调：严格同租户校验 state、拉取用户画像、登录/自动注册/绑定并签发 60 秒一次性票据 */
export async function handleOAuthCallback(
  env: Env,
  req: Request,
  tenant: TenantContext,
  provider: OAuthProvider,
  code: string,
  rawState: string
): Promise<string> {
  if (tenant.isSuspended) throw Errors.forbidden('当前代理分站已暂停营业');
  const db = createDb(env.DB);
  const currentSiteAgentId = resolveSiteAgentId(tenant);
  const stateHash = await sha256Hex(rawState.trim());
  const stateRow = await consumeOAuthStateAtomicRepo(db, stateHash, provider, currentSiteAgentId);
  if (!stateRow) {
    throw Errors.unauthorized('授权登录状态已过期、无效或跨站不匹配，请返回本站重新发起登录');
  }

  const buildErrorRedirect = (msg: string) => {
    const target = new URL('/oauth/callback', stateRow.returnOrigin);
    target.searchParams.set('error', msg);
    return target.toString();
  };

  try {
    const { callbackBaseUrl, credentials } = await loadOAuthConfigsByOwnerRepo(env, db, currentSiteAgentId);
    const creds = credentials.get(provider);
    if (!creds?.enabled || !creds.clientId || !creds.clientSecret) {
      return buildErrorRedirect('当前站点已停用该第三方登录渠道');
    }
    const callbackOrigin = callbackBaseUrl || new URL(req.url).origin;
    const redirectUri = `${callbackOrigin}/api/auth/oauth/${provider}/callback`;

    const profile = await fetchOAuthUserProfile({
      creds,
      code,
      redirectUri,
      codeVerifier: stateRow.codeVerifier,
    });

    if (profile.email && (await isEmailBlacklisted(db, profile.email))) {
      return buildErrorRedirect('该邮箱已被列入平台黑名单，禁止登录');
    }

    const siteAgentId = currentSiteAgentId;
    let targetUserId: number;

    if (stateRow.mode === 'bind') {
      if (!stateRow.bindUserId) return buildErrorRedirect('绑定会话无效');
      const existing = await findOAuthIdentityRepo(db, siteAgentId, provider, profile.providerUserId);
      if (existing && existing.userId !== stateRow.bindUserId) {
        return buildErrorRedirect('该第三方账号已被本站其他会员绑定');
      }
      await upsertUserOAuthIdentityRepo(db, {
        siteAgentId,
        userId: stateRow.bindUserId,
        provider,
        providerUserId: profile.providerUserId,
        unionId: profile.unionId,
        email: profile.email,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
      });
      targetUserId = stateRow.bindUserId;
    } else {
      // 登录/自动注册模式：优先按 providerUserId，其次按微信 unionId，再次按同站点已验证邮箱匹配
      const directIdentity = await findOAuthIdentityRepo(db, siteAgentId, provider, profile.providerUserId);
      const identity =
        directIdentity ??
        (profile.unionId ? await findOAuthIdentityByUnionIdRepo(db, siteAgentId, profile.unionId) : null);

      if (identity) {
        const user = await findUserById(db, identity.userId);
        if (!user) return buildErrorRedirect('关联的会员账号不存在');
        if (user.status && user.status !== 'active') {
          return buildErrorRedirect('该账号已被平台拉黑限制登录');
        }
        if (user.role !== 'admin' && (await isEmailBlacklisted(db, user.email))) {
          return buildErrorRedirect('该邮箱已被列入平台黑名单，禁止登录');
        }
        await upsertUserOAuthIdentityRepo(db, {
          siteAgentId,
          userId: user.id,
          provider,
          providerUserId: profile.providerUserId,
          unionId: profile.unionId,
          email: profile.email,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
        });
        targetUserId = user.id;
      } else {
        const matchedUser =
          profile.email && profile.emailVerified
            ? await findUserBySiteEmail(db, siteAgentId, profile.email)
            : null;
        if (matchedUser) {
          if (matchedUser.status && matchedUser.status !== 'active') {
            return buildErrorRedirect('该账号已被平台拉黑限制登录');
          }
          targetUserId = matchedUser.id;
        } else {
          // 首次登录自动注册新会员
          const fallbackEmail =
            profile.email ||
            `${provider}_${(await sha256Hex(`${siteAgentId}:${provider}:${profile.providerUserId}`)).slice(0, 12)}@oauth.local`;
          const duplicateEmail = await findUserBySiteEmail(db, siteAgentId, fallbackEmail);
          const finalEmail = duplicateEmail
            ? `${provider}_${(await sha256Hex(`${Date.now()}:${profile.providerUserId}`)).slice(0, 12)}@oauth.local`
            : fallbackEmail;

          const welcomeCredit = getRegistrationWelcomeCredit(env);
          const randomPwdHash = await hashPassword(randomHex('oauth_pwd_', 24));
          const referrerId = stateRow.referralCode
            ? await resolveReferrerUserIdOnRegister(db, stateRow.referralCode, siteAgentId)
            : null;
          const newUserId = await createUserRecord(db, {
            siteAgentId,
            email: finalEmail,
            displayName: profile.nickname || 'Member',
            passwordHash: randomPwdHash,
            role: 'user',
            balance: welcomeCredit,
            referredByUserId: referrerId,
          });
          if (welcomeCredit > 0) {
            await insertWalletTxRecord(db, {
              userId: newUserId,
              type: 'register_bonus',
              amount: welcomeCredit,
              balanceAfter: welcomeCredit,
              note: '第三方快捷登录注册体验金',
            });
          }
          await issueReferralCodeIfEnabledForSite(db, newUserId, siteAgentId).catch(() => undefined);
          targetUserId = newUserId;
        }

        await upsertUserOAuthIdentityRepo(db, {
          siteAgentId,
          userId: targetUserId,
          provider,
          providerUserId: profile.providerUserId,
          unionId: profile.unionId,
          email: profile.email,
          nickname: profile.nickname,
          avatarUrl: profile.avatarUrl,
        });
      }
    }

    const rawTicket = randomHex('aho_', 24);
    await insertOAuthExchangeTicketRepo(db, {
      ticketHash: await sha256Hex(rawTicket),
      siteAgentId,
      userId: targetUserId,
      redirectPath: stateRow.redirectPath,
      action: stateRow.mode,
      provider,
      expiresAt: Date.now() + TICKET_TTL_MS,
    });

    const target = new URL('/oauth/callback', stateRow.returnOrigin);
    target.searchParams.set('ticket', rawTicket);
    return target.toString();
  } catch (err) {
    return buildErrorRedirect(err instanceof Error ? err.message : '第三方授权登录失败');
  }
}

/** 当前主站/分站原子核销一次性 OAuth 票据并签发当前站点独立会话 */
export async function exchangeOAuthTicket(env: Env, req: Request, tenant: TenantContext, rawTicket: string) {
  if (tenant.isSuspended) throw Errors.forbidden('当前代理分站已暂停营业');
  const db = createDb(env.DB);
  const currentSiteAgentId = resolveSiteAgentId(tenant);
  const ticketHash = await sha256Hex(rawTicket.trim());
  const claimed = await consumeOAuthExchangeTicketAtomicRepo(db, ticketHash, currentSiteAgentId);
  if (!claimed) throw Errors.unauthorized('第三方登录票据无效、已使用或已过期，请重新登录');

  const userRow = await findUserById(db, claimed.userId);
  if (!userRow) throw Errors.unauthorized('对应会员账号不存在');
  if (userRow.status && userRow.status !== 'active') {
    throw Errors.forbidden('该账号已被平台拉黑限制登录');
  }
  if (userRow.role !== 'admin' && (await isEmailBlacklisted(db, userRow.email))) {
    throw Errors.forbidden('该邮箱已被列入平台黑名单，禁止登录');
  }

  const [token, agentRow, tier] = await Promise.all([
    issueAuthSession(
      db,
      env,
      {
        id: userRow.id,
        role: userRow.role,
        siteAgentId: userRow.siteAgentId,
        sessionVersion: userRow.sessionVersion,
      },
      currentSiteAgentId
    ),
    findAgentByUserId(db, userRow.id),
    getUserAgentTier(env, userRow.id),
  ]);
  await insertLoginAuditLog(
    db,
    userRow.id,
    extractClientIp(req),
    (req.headers.get('User-Agent') || '').slice(0, 220)
  ).catch(() => undefined);

  const agentMapped = agentRow ? await mapAgentRowWithSecret(env, agentRow) : null;
  return {
    ok: true,
    token,
    action: claimed.action as 'login' | 'bind',
    provider: claimed.provider,
    redirect_path: sanitizeRedirectPath(claimed.redirectPath),
    user: {
      ...mapAuthUserRow(userRow),
      agent: agentMapped,
      agent_tier: tier,
    },
  };
}

/** 会员中心读取自身已绑定的第三方登录列表 */
export async function listMyOAuthBindings(env: Env, req: Request, tenant: TenantContext) {
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  const rows = await listUserOAuthIdentitiesRepo(createDb(env.DB), user.id);
  return {
    bindings: rows.map((r) => ({
      provider: r.provider as OAuthProvider,
      nickname: r.nickname,
      email: r.email,
      avatar_url: r.avatarUrl,
      created_at: r.createdAt,
    })),
  };
}

/** 会员中心解绑第三方登录（防锁死：若为占位邮箱账号且仅剩最后 1 个第三方绑定则拒绝解绑） */
export async function unbindMyOAuthIdentity(
  env: Env,
  req: Request,
  tenant: TenantContext,
  provider: OAuthProvider
) {
  const authUser = await getAuthUser(req, env, tenant);
  if (!authUser) throw Errors.unauthorized('请先登录账号');
  const db = createDb(env.DB);
  const [user, bindings] = await Promise.all([
    findUserById(db, authUser.id),
    listUserOAuthIdentitiesRepo(db, authUser.id),
  ]);
  if (!user) throw Errors.unauthorized('账号不存在');
  if (user.email.endsWith('@oauth.local') && bindings.length <= 1) {
    throw Errors.conflict('当前账号尚未设置独立邮箱密码，无法解绑最后一个第三方登录方式');
  }
  const deleted = await deleteUserOAuthIdentityRepo(db, authUser.id, provider);
  if (deleted.length === 0) throw Errors.notFound('未找到该第三方绑定记录');
  return { ok: true };
}

/** 读取指定站点租户的 OAuth 配置（主站 ownerAgentId = 0；分站 ownerAgentId = agent.id） */
export async function getSiteOAuthConfig(env: Env, ownerAgentId: number) {
  const db = createDb(env.DB);
  const { callbackBaseUrl, adminView } = await loadOAuthConfigsByOwnerRepo(env, db, ownerAgentId);
  return { callback_base_url: callbackBaseUrl, providers: adminView };
}

/** 保存指定站点租户的 OAuth 配置（主站写审计日志，分站仅写自身 tenant_settings） */
export async function updateSiteOAuthConfig(
  env: Env,
  ownerAgentId: number,
  input: Parameters<typeof saveOAuthConfigsByOwnerRepo>[3],
  actor?: AuditActorContext
) {
  const db = createDb(env.DB);
  await saveOAuthConfigsByOwnerRepo(env, db, ownerAgentId, input);
  bumpEdgeCacheVersion();
  if (ownerAgentId === 0 && actor) {
    await recordAdminAudit(db, actor, {
      action: 'oauth.update_config',
      targetType: 'settings',
      targetId: 0,
      summary: '更新主站第三方 OAuth 授权登录配置（QQ / 微信 / Google / GitHub）',
      after: {
        callback_base_url: input.callback_base_url ?? '',
        enabled_providers: Object.entries(input.providers)
          .filter(([, v]) => v?.enabled)
          .map(([k]) => k),
      },
    });
  }
  return getSiteOAuthConfig(env, ownerAgentId);
}
