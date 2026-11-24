import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { type AppBindings, isDevOrTestEnv } from '../env';

export function createCorsMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const allowedRaw = String(c.env.ALLOWED_ORIGINS || '').trim();
    const allowList = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const handler = cors({
      origin: (origin) => {
        if (!origin) return '*';
        if (isDevOrTestEnv(c.env)) return origin;
        if (allowList.length === 0) {
          // Same-origin or registered custom domain
          const reqOrigin = new URL(c.req.url).origin;
          return origin === reqOrigin ? origin : '';
        }
        return allowList.includes(origin) ? origin : '';
      },
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Intent-Token', 'X-Lang'],
      maxAge: 86400,
    });

    return handler(c, next);
  };
}
