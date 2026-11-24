import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { passwordResetCodes, userSessions, users } from '../../db/schema/index';
import type { Env, TenantContext } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { hashPassword, verifyPassword } from '../../infra/auth-crypto';
import { sha256Hex, timingSafeEqual } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { sendSiteEmail } from '../../infra/mail';
import { buildPasswordResetEmailTemplate } from '../../infra/mail.templates';
import { resolveSiteBrandName } from '../payment/payment.order.repo';
import { findUserById, findUserBySiteEmail, isEmailBlacklisted } from './auth.repo';
import { getAuthUser } from './auth.service';
import { issueAuthSession } from './auth.session';

function generateSixDigitCode(): string {
  const rand = new Uint32Array(1);
  crypto.getRandomValues(rand);
  return String(100000 + (rand[0] % 900000));
}

function formatSqlUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** 请求忘记密码 6 位一次性邮箱验证码（10 分钟有效，统一响应防账号枚举） */
export async function requestPasswordReset(env: Env, _req: Request, tenant: TenantContext, rawEmail: string) {
  const db = createDb(env.DB);
  const email = rawEmail.trim().toLowerCase();
  const siteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;

  if (await isEmailBlacklisted(db, email)) {
    throw Errors.forbidden('该邮箱已被列入平台黑名单，无法重置密码');
  }

  const user = await findUserBySiteEmail(db, siteAgentId, email);
  if (!user) {
    return {
      ok: true,
      message: '如果该邮箱已注册，我们已向其发送 6 位安全验证码，请查收邮件（10 分钟内有效）',
    };
  }

  // 防止 60 秒内重复刷发送验证码
  const recent = await db
    .select({ id: passwordResetCodes.id })
    .from(passwordResetCodes)
    .where(
      and(
        eq(passwordResetCodes.siteAgentId, siteAgentId),
        eq(passwordResetCodes.email, email),
        sql`${passwordResetCodes.createdAt} >= datetime('now', '-60 seconds')`
      )
    )
    .limit(1);
  if (recent.length > 0) {
    throw Errors.rateLimited('验证码发送过于频繁，请 60 秒后再试', 60);
  }

  const code = generateSixDigitCode();
  const codeHash = await sha256Hex(`pwd-reset:${siteAgentId}:${email}:${code}`);
  const expiresAt = formatSqlUtc(Date.now() + 10 * 60 * 1000);
  await db.insert(passwordResetCodes).values({
    siteAgentId,
    userId: user.id,
    email,
    codeHash,
    expiresAt,
  });

  const brandName = await resolveSiteBrandName(db, siteAgentId);
  const tpl = buildPasswordResetEmailTemplate({ brandName, code });
  let mailRes = await sendSiteEmail(env, siteAgentId, {
    to: email,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    scene: 'password_reset',
  });
  if (!mailRes.ok && siteAgentId > 0) {
    mailRes = await sendSiteEmail(env, 0, {
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      scene: 'password_reset',
    });
  }

  return {
    ok: true,
    mail_sent: mailRes.ok,
    message: '如果该邮箱已注册，我们已向其发送 6 位安全验证码，请查收邮件（10 分钟内有效）',
  };
}

/** 校验 6 位验证码并重置密码（防暴破 ≤ 5 次尝试 + 重置后立即吊销全部旧会话） */
export async function confirmPasswordReset(
  env: Env,
  tenant: TenantContext,
  input: { email: string; code: string; new_password: string }
) {
  const db = createDb(env.DB);
  const email = input.email.trim().toLowerCase();
  const siteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;

  const latestRows = await db
    .select()
    .from(passwordResetCodes)
    .where(
      and(
        eq(passwordResetCodes.siteAgentId, siteAgentId),
        eq(passwordResetCodes.email, email),
        isNull(passwordResetCodes.usedAt),
        sql`${passwordResetCodes.expiresAt} > datetime('now')`
      )
    )
    .orderBy(desc(passwordResetCodes.id))
    .limit(1);

  const rec = latestRows[0];
  if (!rec) throw Errors.validation('验证码不存在或已过期，请重新获取');
  if (Number(rec.attempts || 0) >= 5) {
    throw Errors.rateLimited('验证码错误次数过多已失效，请重新获取新的验证码', 60);
  }

  const expectedHash = await sha256Hex(`pwd-reset:${siteAgentId}:${email}:${input.code.trim()}`);
  if (!timingSafeEqual(expectedHash, rec.codeHash)) {
    await db
      .update(passwordResetCodes)
      .set({ attempts: sql`${passwordResetCodes.attempts} + 1` })
      .where(eq(passwordResetCodes.id, rec.id));
    throw Errors.validation('验证码不正确，请核对后重试');
  }

  const user = await findUserBySiteEmail(db, siteAgentId, email);
  if (!user) throw Errors.notFound('会员账号不存在');

  const consumed = await db
    .update(passwordResetCodes)
    .set({ usedAt: sql`datetime('now')` })
    .where(and(eq(passwordResetCodes.id, rec.id), isNull(passwordResetCodes.usedAt)))
    .returning({ id: passwordResetCodes.id });
  if (consumed.length !== 1) throw Errors.validation('该验证码已被使用，请重新获取');

  const newHash = await hashPassword(input.new_password);
  await db.batch([
    db
      .update(users)
      .set({ passwordHash: newHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id)),
    db.delete(userSessions).where(eq(userSessions.userId, user.id)),
  ]);

  return { ok: true, message: '密码重置成功，请使用新密码重新登录' };
}

/** 会员个人中心自主修改密码（校验旧密码 + 更新哈希 + 吊销旧会话并签发新会话） */
export async function changeOwnPassword(
  env: Env,
  req: Request,
  tenant: TenantContext,
  input: { current_password: string; new_password: string }
) {
  const authUser = await getAuthUser(req, env, tenant);
  if (!authUser) throw Errors.unauthorized('请先登录后再修改密码');

  const db = createDb(env.DB);
  const user = await findUserById(db, authUser.id);
  if (!user) throw Errors.unauthorized('账号不存在');

  const valid = await verifyPassword(input.current_password, user.passwordHash);
  if (!valid) throw Errors.validation('当前密码输入不正确');

  const newHash = await hashPassword(input.new_password);
  const nextSessionVersion = Number(user.sessionVersion || 1) + 1;
  await db.batch([
    db
      .update(users)
      .set({ passwordHash: newHash, sessionVersion: nextSessionVersion })
      .where(eq(users.id, user.id)),
    db.delete(userSessions).where(eq(userSessions.userId, user.id)),
  ]);

  const loginSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const token = await issueAuthSession(
    db,
    env,
    {
      id: user.id,
      role: user.role,
      siteAgentId: user.siteAgentId,
      sessionVersion: nextSessionVersion,
    },
    loginSiteAgentId
  );
  return { ok: true, token, message: '密码修改成功，旧设备已安全下线' };
}

/** 总控管理员代重置指定会员密码并立即吊销全部旧会话 */
export async function adminResetMemberPassword(
  env: Env,
  actor: AuditActorContext,
  userId: number,
  newPassword: string
) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');
  if (user.role === 'admin' && user.id !== actor.actorUserId) {
    throw Errors.forbidden('不可重置其他超级管理员的密码');
  }

  const newHash = await hashPassword(newPassword);
  await db.batch([
    db
      .update(users)
      .set({ passwordHash: newHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, user.id)),
    db.delete(userSessions).where(eq(userSessions.userId, user.id)),
  ]);

  await recordAdminAudit(db, actor, {
    action: 'member.reset_password',
    targetType: 'user',
    targetId: user.id,
    summary: `总控代重置会员 ${user.email} 登录密码并吊销全部旧会话`,
  });

  return { ok: true };
}
