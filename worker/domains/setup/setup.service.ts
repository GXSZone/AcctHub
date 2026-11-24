import type { SetupInitializeInput } from '@shared/index';
import { type Env, getRequiredJwtSecret, isDevOrTestEnv, resolveAdminExpectedSecret } from '../../env';
import { hashPassword, verifyPassword } from '../../infra/auth-crypto';
import { timingSafeEqual } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { AppError, Errors } from '../../infra/errors';
import { getClientIp } from '../../infra/security';
import { findUserById } from '../auth/auth.repo';
import { issueAuthSession } from '../auth/auth.session';
import { commitSystemSetupRepo, getSetupAdminsRepo, getSetupCompletionRepo } from './setup.repo';

/** 查询当前系统冷启动初始化状态。旧安装部分完成时，可凭原管理员身份续办。 */
export async function getSetupStatus(env: Env) {
  const initialized = await getSetupCompletionRepo(createDb(env.DB));
  return {
    initialized,
    requires_setup: !initialized,
    is_production: !isDevOrTestEnv(env),
    has_admin_secret: Boolean((env.ADMIN_SECRET || '').trim()),
  };
}

/** 安装须校验环境口令。已有管理员时，还需验证现存管理员身份。 */
export async function initializeSystemSetup(env: Env, req: Request, input: SetupInitializeInput) {
  const db = createDb(env.DB);
  const locked = () => Errors.conflict('系统已完成初始化并永久锁定安装向导，请直接登录管理员账号');
  if (await getSetupCompletionRepo(db)) throw locked();

  const expectedSecret = resolveAdminExpectedSecret(env);
  if (!expectedSecret) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      '请先通过 wrangler secret put ADMIN_SECRET 配置安装口令后再执行初始化',
      {
        expose: true,
      }
    );
  }
  if (!timingSafeEqual(input.setup_secret.trim(), expectedSecret)) {
    throw Errors.forbidden('初始化口令验证失败（请核对环境变量 ADMIN_SECRET）');
  }

  getRequiredJwtSecret(env);
  const email = input.admin_email.trim().toLowerCase();
  const admins = await getSetupAdminsRepo(db);
  const priorAdmin = admins[0];
  if (priorAdmin && (await getSetupCompletionRepo(db))) throw locked();
  if (admins.length > 1) throw Errors.conflict('已有多个管理员，请由运维人员核验安装状态');
  if (
    priorAdmin &&
    (priorAdmin.email !== email || !(await verifyPassword(input.admin_password, priorAdmin.passwordHash)))
  ) {
    throw Errors.forbidden('请使用已存在的主站管理员邮箱和密码续办安装');
  }
  const passwordHash = priorAdmin?.passwordHash ?? (await hashPassword(input.admin_password));
  const admin = await commitSystemSetupRepo(db, {
    email,
    displayName: input.admin_display_name.trim(),
    passwordHash,
    resume: Boolean(priorAdmin),
    brandName: input.brand_name.trim(),
    brandTagline: input.brand_tagline.trim(),
    ip: getClientIp(req),
    userAgent: req.headers.get('User-Agent') || '',
  });
  if (!admin) throw locked();

  const account = await findUserById(db, admin.id);
  if (account?.role !== 'admin' || account.siteAgentId !== 0 || account.passwordHash !== passwordHash) {
    throw Errors.unauthorized('请使用当前管理员密码登录');
  }
  const token = await issueAuthSession(db, env, account);
  return {
    ok: true,
    initialized: true,
    token,
    user: { ...admin, site_agent_id: 0, role: 'admin' as const },
  };
}
