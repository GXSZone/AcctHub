import type { MiddlewareHandler } from 'hono';
import { type AppBindings, type Env, isPublicDemoMode } from '../env';
import { AppError } from '../infra/errors';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const DEMO_SEED_EMAIL_DOMAINS = ['@accthub.dev', '@example.test'];

/**
 * 公开演示站高危路径屏蔽清单（仅限制破坏全局演示状态或存在 SSRF/外发滥用风险的写操作）
 */
const DEMO_RESTRICTED_WRITE_PATTERNS: RegExp[] = [
  /^\/api\/admin\/2fa(\/|$)/,
  /^\/api\/admin\/risk\/(emergency|ip-blacklist|test-alert)(\/|$)/,
  /^\/api\/admin\/members\/\d+\/(password|status|revoke-sessions)$/,
  /^\/api\/admin\/members\/\d+$/,
  /^\/api\/admin\/mail-config(\/|$)/,
  /^\/api\/admin\/notify-config(\/|$)/,
  /^\/api\/admin\/webhooks(\/|$)/,
  /^\/api\/admin\/upstreams(\/|$)/,
  /^\/api\/admin\/domains(\/|$)/,
  /^\/api\/admin\/oauth(\/|$)/,
  /^\/api\/admin\/saas-(config|policy)$/,
  /^\/api\/agent\/domain$/,
];

function demoReadonlyError(message: string): AppError {
  return new AppError('DEMO_MODE_READONLY', message, { expose: true });
}

/** 校验目标邮箱是否为内置公开演示账号 */
export function isProtectedDemoEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return DEMO_SEED_EMAIL_DOMAINS.some((suffix) => normalized.endsWith(suffix));
}

/** 在公开演示模式下禁止修改内置预设账号密码，防止锁死其他访客 */
export function assertDemoAccountMutable(env: Env, email: string): void {
  if (isPublicDemoMode(env) && isProtectedDemoEmail(email)) {
    throw demoReadonlyError('公开演示环境禁止修改内置演示账号密码，请注册新账号测试改密功能');
  }
}

/** 公开演示护盾中间件：拦截会导致演示环境不可用或外发探测的高危写接口 */
export function createPublicDemoGuardMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (READ_METHODS.has(c.req.method) || !isPublicDemoMode(c.env)) {
      await next();
      return;
    }

    const path = new URL(c.req.url).pathname;
    if (DEMO_RESTRICTED_WRITE_PATTERNS.some((pattern) => pattern.test(path))) {
      return c.json(
        {
          ok: false,
          error: '公开演示环境已限制该高危修改，请注册独立测试账号或本地部署体验完整控制权限',
          code: 'DEMO_MODE_READONLY',
        },
        403
      );
    }

    await next();
  };
}
