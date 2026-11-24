import {
  ERROR_CODE_I18N,
  resolveRequestLocale,
  translateApiErrorMessage,
} from '@shared/constants/error-codes';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type AppBindings, isDevOrTestEnv } from '../env';
import { AppError } from '../infra/errors';
import { logger } from '../infra/logger';

export function handleGlobalError(err: Error, c: Context<AppBindings>) {
  const requestId = c.get('requestId') || crypto.randomUUID();
  const local = isDevOrTestEnv(c.env);
  const locale = resolveRequestLocale(c.req.raw.headers);

  if (err instanceof AppError) {
    if (err.status >= 500) {
      logger.error('app_error', {
        request_id: requestId,
        code: err.code,
        path: c.req.path,
      });
    }
    const visible = err.expose || local;
    const rawMsg = visible ? err.message : ERROR_CODE_I18N[err.code][locale];
    const localizedMsg = translateApiErrorMessage(rawMsg, err.code, locale, err.status);
    return c.json(
      {
        ok: false,
        error: localizedMsg,
        code: err.code,
        ...(visible && err.details !== undefined ? { details: err.details } : {}),
        request_id: requestId,
      },
      err.status as ContentfulStatusCode
    );
  }

  logger.error('unhandled_error', {
    request_id: requestId,
    path: c.req.path,
    method: c.req.method,
    name: err.name,
  });

  const fallbackMsg = local
    ? translateApiErrorMessage(err.message || 'Internal Server Error', 'INTERNAL_ERROR', locale, 500)
    : ERROR_CODE_I18N.INTERNAL_ERROR[locale];

  return c.json(
    {
      ok: false,
      error: fallbackMsg,
      code: 'INTERNAL_ERROR',
      request_id: requestId,
    },
    500
  );
}
