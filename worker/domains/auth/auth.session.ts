import { and, eq, gt, lte } from 'drizzle-orm';
import { userSessions, users } from '../../db/schema/index';
import { type Env, getRequiredJwtSecret } from '../../env';
import { SESSION_TTL_SECONDS, signToken, verifyToken } from '../../infra/auth-crypto';
import { sha256Hex } from '../../infra/crypto';
import { type AppDatabase, createDb } from '../../infra/db';

const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

function getBearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token && token.length <= 2048 ? token : null;
}

export async function issueAuthSession(
  db: AppDatabase,
  env: Env,
  account: { id: number; role: string; siteAgentId: number; sessionVersion: number },
  loginSiteAgentId = account.siteAgentId
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + (account.role === 'admin' ? ADMIN_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS);
  const token = await signToken(
    {
      sub: account.id,
      role: account.role,
      site_agent_id: account.siteAgentId,
      login_site_agent_id: loginSiteAgentId,
      jti: crypto.randomUUID(),
    },
    getRequiredJwtSecret(env),
    expiresAt
  );
  const tokenHash = await sha256Hex(token);

  await db.batch([
    db.delete(userSessions).where(and(eq(userSessions.userId, account.id), lte(userSessions.expiresAt, now))),
    db.insert(userSessions).values({
      tokenHash,
      userId: account.id,
      sessionVersion: account.sessionVersion,
      expiresAt,
    }),
  ]);
  return token;
}

export async function readAuthSession(req: Request, env: Env) {
  const token = getBearerToken(req);
  if (!token) return null;
  const payload = await verifyToken(token, getRequiredJwtSecret(env));
  if (!payload || typeof payload.sub !== 'number' || typeof payload.jti !== 'string') return null;

  const [row] = await createDb(env.DB)
    .select({ user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.tokenHash, await sha256Hex(token)),
        eq(userSessions.userId, payload.sub),
        eq(userSessions.sessionVersion, users.sessionVersion),
        gt(userSessions.expiresAt, Math.floor(Date.now() / 1000))
      )
    )
    .limit(1);
  if (!row) return null;
  // 后台权限必须来自管理员重新登录签发的会话，会员令牌不可随账号提权。
  if (row.user.role === 'admin' && payload.role !== 'admin') return null;
  return row.user;
}

export async function revokeAuthSession(req: Request, env: Env) {
  const token = getBearerToken(req);
  if (token) {
    await createDb(env.DB)
      .delete(userSessions)
      .where(eq(userSessions.tokenHash, await sha256Hex(token)));
  }
  return { ok: true };
}
