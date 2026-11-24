import { eq } from 'drizzle-orm';
import { users } from '../../db/schema/index';
import type { Env } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { decryptSecret, encryptSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { AppError, Errors } from '../../infra/errors';
import { buildTotpOtpAuthUri, generateTotpSecretBase32, verifyTotpCode } from '../../infra/totp';

/** 查询当前管理员 2FA 开启状态 */
export async function getAdmin2FaStatus(env: Env, userId: number) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ id: users.id, email: users.email, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw Errors.notFound('管理员账号不存在');
  return { enabled: Number(row.totpEnabled || 0) === 1, email: row.email };
}

/** 生成新的 TOTP 密钥与 otpauth:// 绑定链接（尚未入库启用，需验证 6 位动态码后才生效） */
export async function setupAdmin2Fa(env: Env, userId: number) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ id: users.id, email: users.email, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw Errors.notFound('管理员账号不存在');
  const secret = generateTotpSecretBase32();
  const otpauthUrl = buildTotpOtpAuthUri({
    issuer: 'AcctHub Admin',
    accountEmail: row.email,
    secretBase32: secret,
  });
  return {
    secret,
    otpauth_url: otpauthUrl,
    already_enabled: Number(row.totpEnabled || 0) === 1,
  };
}

/** 验证 6 位动态验证码无误后正式加密保存密钥并开启管理员 2FA */
export async function enableAdmin2Fa(
  env: Env,
  userId: number,
  actor: AuditActorContext,
  input: { secret: string; code: string }
) {
  const valid = await verifyTotpCode(input.secret, input.code);
  if (!valid) {
    throw Errors.validation('动态验证码不正确，请核对验证器时间与 6 位数字后重试');
  }
  const db = createDb(env.DB);
  const enc = await encryptSecret(env, input.secret.trim().toUpperCase(), `admin-totp:${userId}`);
  await db.update(users).set({ totpSecretEnc: enc, totpEnabled: 1 }).where(eq(users.id, userId));
  await recordAdminAudit(db, actor, {
    action: 'admin.2fa.enable',
    targetType: 'user',
    targetId: userId,
    summary: '开启管理员登录 2FA 两步验证保护',
  });
  return { ok: true, enabled: true };
}

/** 验证当前 6 位动态码后关闭管理员 2FA */
export async function disableAdmin2Fa(
  env: Env,
  userId: number,
  actor: AuditActorContext,
  input: { code: string }
) {
  const db = createDb(env.DB);
  const [row] = await db
    .select({ totpSecretEnc: users.totpSecretEnc, totpEnabled: users.totpEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || Number(row.totpEnabled || 0) !== 1 || !row.totpSecretEnc) {
    throw Errors.validation('当前管理员账号尚未开启 2FA 两步验证');
  }
  const secret = await decryptSecret(env, row.totpSecretEnc, `admin-totp:${userId}`);
  const valid = await verifyTotpCode(secret, input.code);
  if (!valid) {
    throw Errors.validation('当前动态验证码不正确，无法关闭 2FA');
  }
  await db.update(users).set({ totpSecretEnc: '', totpEnabled: 0 }).where(eq(users.id, userId));
  await recordAdminAudit(db, actor, {
    action: 'admin.2fa.disable',
    targetType: 'user',
    targetId: userId,
    summary: '关闭管理员登录 2FA 两步验证保护',
  });
  return { ok: true, enabled: false };
}

/** 登录时校验管理员 2FA（若已开启但未传码抛 TOTP_REQUIRED，传码错误抛 401） */
export async function assertAdminLogin2FaIfEnabled(
  env: Env,
  userRow: { id: number; role: string; totpEnabled: number; totpSecretEnc: string },
  totpCode?: string
): Promise<void> {
  if (userRow.role !== 'admin' || Number(userRow.totpEnabled || 0) !== 1 || !userRow.totpSecretEnc) {
    return;
  }
  const clean = (totpCode || '').trim();
  if (!clean) {
    throw new AppError('TOTP_REQUIRED', '该管理员账号已开启两步验证，请输入 6 位动态验证码', {
      status: 401,
      details: { requires_2fa: true },
    });
  }
  const secret = await decryptSecret(env, userRow.totpSecretEnc, `admin-totp:${userRow.id}`);
  const valid = await verifyTotpCode(secret, clean);
  if (!valid) {
    throw Errors.unauthorized('两步动态验证码不正确，请重新输入');
  }
}
