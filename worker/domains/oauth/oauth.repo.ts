import { OAUTH_PROVIDERS, type OAuthProvider } from '@shared/contracts/oauth.contract';
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import {
  oauthAuthStates,
  oauthExchangeTickets,
  tenantSettings,
  userOauthIdentities,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { decryptSecret, encryptSecret, maskSecret } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import type { OAuthProviderCredentials } from './oauth.providers';

const CALLBACK_BASE_KEY = 'oauth_callback_base_url';
const providerSettingKey = (p: OAuthProvider) => `oauth_provider_${p}`;

interface StoredOAuthProviderRecord {
  enabled: boolean;
  client_id: string;
  client_secret_enc: string;
}

/** 按站点租户读取 OAuth 独立配置（ownerAgentId = 0 为主站，> 0 为对应分站，绝不跨站继承回退） */
export async function loadOAuthConfigsByOwnerRepo(env: Env, db: AppDatabase, ownerAgentId: number) {
  const keys = [CALLBACK_BASE_KEY, ...OAUTH_PROVIDERS.map(providerSettingKey)];
  const rows = await db
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(and(eq(tenantSettings.ownerAgentId, ownerAgentId), inArray(tenantSettings.key, keys)));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const callbackBaseUrl = (map.get(CALLBACK_BASE_KEY) || '').trim().replace(/\/+$/, '');

  const credentials = new Map<OAuthProvider, OAuthProviderCredentials>();
  const adminView = await Promise.all(
    OAUTH_PROVIDERS.map(async (provider) => {
      const raw = safeJsonParse<Partial<StoredOAuthProviderRecord>>(
        map.get(providerSettingKey(provider)) || '{}',
        {}
      );
      const clientId = String(raw.client_id || '').trim();
      const enc = String(raw.client_secret_enc || '').trim();
      const secret = enc ? await decryptSecret(env, enc).catch(() => '') : '';
      const enabled = Boolean(raw.enabled);
      credentials.set(provider, { provider, enabled, clientId, clientSecret: secret });
      return {
        provider,
        enabled,
        client_id: clientId,
        has_secret: Boolean(secret),
        secret_masked: maskSecret(secret),
        callback_path: `/api/auth/oauth/${provider}/callback`,
      };
    })
  );

  return { callbackBaseUrl, credentials, adminView };
}

/** 按站点租户保存 OAuth 独立配置（Client Secret 严格 AES-GCM 加密存库） */
export async function saveOAuthConfigsByOwnerRepo(
  env: Env,
  db: AppDatabase,
  ownerAgentId: number,
  input: {
    callback_base_url?: string;
    providers: Partial<
      Record<
        OAuthProvider,
        { enabled: boolean; client_id?: string; client_secret?: string; clear_secret?: boolean }
      >
    >;
  }
) {
  const prev = await loadOAuthConfigsByOwnerRepo(env, db, ownerAgentId);
  const cleanBase = (input.callback_base_url ?? prev.callbackBaseUrl).trim().replace(/\/+$/, '');
  await db
    .insert(tenantSettings)
    .values({ ownerAgentId, key: CALLBACK_BASE_KEY, value: cleanBase })
    .onConflictDoUpdate({
      target: [tenantSettings.ownerAgentId, tenantSettings.key],
      set: { value: cleanBase },
    });

  for (const provider of OAUTH_PROVIDERS) {
    const patch = input.providers[provider];
    if (!patch) continue;
    const oldCreds = prev.credentials.get(provider);
    let nextSecretEnc = '';
    if (patch.clear_secret) {
      nextSecretEnc = '';
    } else if (patch.client_secret?.trim()) {
      nextSecretEnc = await encryptSecret(env, patch.client_secret.trim());
    } else if (oldCreds?.clientSecret) {
      nextSecretEnc = await encryptSecret(env, oldCreds.clientSecret);
    }

    const stored: StoredOAuthProviderRecord = {
      enabled: Boolean(patch.enabled),
      client_id: (patch.client_id !== undefined ? patch.client_id : oldCreds?.clientId || '').trim(),
      client_secret_enc: nextSecretEnc,
    };
    const key = providerSettingKey(provider);
    const value = JSON.stringify(stored);
    await db
      .insert(tenantSettings)
      .values({ ownerAgentId, key, value })
      .onConflictDoUpdate({
        target: [tenantSettings.ownerAgentId, tenantSettings.key],
        set: { value },
      });
  }
}

export async function insertOAuthStateRepo(db: AppDatabase, row: typeof oauthAuthStates.$inferInsert) {
  await db.insert(oauthAuthStates).values(row);
}

/** CAS 原子消费 OAuth State（严格校验同租户 siteAgentId，防 CSRF、重放与跨站混用） */
export async function consumeOAuthStateAtomicRepo(
  db: AppDatabase,
  stateHash: string,
  provider: OAuthProvider,
  siteAgentId: number
) {
  const nowMs = Date.now();
  const rows = await db
    .update(oauthAuthStates)
    .set({ usedAt: nowMs })
    .where(
      and(
        eq(oauthAuthStates.stateHash, stateHash),
        eq(oauthAuthStates.provider, provider),
        eq(oauthAuthStates.siteAgentId, siteAgentId),
        isNull(oauthAuthStates.usedAt),
        gt(oauthAuthStates.expiresAt, nowMs)
      )
    )
    .returning();
  // 顺手清理 10 分钟前的过期 State
  await db
    .delete(oauthAuthStates)
    .where(lt(oauthAuthStates.expiresAt, nowMs - 600_000))
    .catch(() => undefined);
  return rows[0] ?? null;
}

export async function insertOAuthExchangeTicketRepo(
  db: AppDatabase,
  row: typeof oauthExchangeTickets.$inferInsert
) {
  await db.insert(oauthExchangeTickets).values(row);
}

/** CAS 原子消费 60 秒一次性 OAuth 登录交换票据（严格绑定当前站点） */
export async function consumeOAuthExchangeTicketAtomicRepo(
  db: AppDatabase,
  ticketHash: string,
  siteAgentId: number
) {
  const nowMs = Date.now();
  const rows = await db
    .update(oauthExchangeTickets)
    .set({ usedAt: nowMs })
    .where(
      and(
        eq(oauthExchangeTickets.ticketHash, ticketHash),
        eq(oauthExchangeTickets.siteAgentId, siteAgentId),
        isNull(oauthExchangeTickets.usedAt),
        gt(oauthExchangeTickets.expiresAt, nowMs)
      )
    )
    .returning();
  await db
    .delete(oauthExchangeTickets)
    .where(lt(oauthExchangeTickets.expiresAt, nowMs - 300_000))
    .catch(() => undefined);
  return rows[0] ?? null;
}

export async function findOAuthIdentityRepo(
  db: AppDatabase,
  siteAgentId: number,
  provider: OAuthProvider,
  providerUserId: string
) {
  const rows = await db
    .select()
    .from(userOauthIdentities)
    .where(
      and(
        eq(userOauthIdentities.siteAgentId, siteAgentId),
        eq(userOauthIdentities.provider, provider),
        eq(userOauthIdentities.providerUserId, providerUserId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** 微信双端（PC 扫码 + 微信内公众号）按 union_id 跨端识别同一会员 */
export async function findOAuthIdentityByUnionIdRepo(db: AppDatabase, siteAgentId: number, unionId: string) {
  if (!unionId) return null;
  const rows = await db
    .select()
    .from(userOauthIdentities)
    .where(and(eq(userOauthIdentities.siteAgentId, siteAgentId), eq(userOauthIdentities.unionId, unionId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listUserOAuthIdentitiesRepo(db: AppDatabase, userId: number) {
  return db.select().from(userOauthIdentities).where(eq(userOauthIdentities.userId, userId));
}

export async function upsertUserOAuthIdentityRepo(
  db: AppDatabase,
  input: typeof userOauthIdentities.$inferInsert
) {
  await db
    .insert(userOauthIdentities)
    .values(input)
    .onConflictDoUpdate({
      target: [
        userOauthIdentities.siteAgentId,
        userOauthIdentities.provider,
        userOauthIdentities.providerUserId,
      ],
      set: {
        unionId: input.unionId,
        email: input.email,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl,
      },
    });
}

export async function deleteUserOAuthIdentityRepo(db: AppDatabase, userId: number, provider: OAuthProvider) {
  return db
    .delete(userOauthIdentities)
    .where(and(eq(userOauthIdentities.userId, userId), eq(userOauthIdentities.provider, provider)))
    .returning({ id: userOauthIdentities.id });
}
