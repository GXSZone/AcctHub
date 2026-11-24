import { ERROR_HTTP_STATUS, type ErrorCode } from '@shared/index';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { status?: number; details?: unknown; expose?: boolean; cause?: unknown }
  ) {
    super(message, opts?.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = opts?.status ?? ERROR_HTTP_STATUS[code];
    this.details = opts?.details;
    this.expose = opts?.expose ?? this.status < 500;
  }
}

export const Errors = {
  validation: (message: string, details?: unknown) => new AppError('VALIDATION_ERROR', message, { details }),
  unauthorized: (message = '请先登录账号') => new AppError('UNAUTHORIZED', message),
  forbidden: (message = '无权限执行此操作') => new AppError('FORBIDDEN', message),
  notFound: (message = '目标资源不存在') => new AppError('NOT_FOUND', message),
  conflict: (message: string, details?: unknown) => new AppError('CONFLICT', message, { details }),
  insufficientBalance: (message: string) => new AppError('INSUFFICIENT_BALANCE', message),
  insufficientStock: (message: string) => new AppError('INSUFFICIENT_STOCK', message),
  rateLimited: (message: string, retryAfterSeconds: number) =>
    new AppError('RATE_LIMITED', message, { details: { retry_after_seconds: retryAfterSeconds } }),
  sandboxDisabled: (message = '当前生产环境已关闭沙盒演示模式') => new AppError('SANDBOX_DISABLED', message),
  upstream: (message: string, details?: unknown) => new AppError('UPSTREAM_ERROR', message, { details }),
};
