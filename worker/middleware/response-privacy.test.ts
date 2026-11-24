import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppBindings, Env } from '../env';
import { AppError } from '../infra/errors';
import { createCorsMiddleware } from './cors.middleware';
import { handleGlobalError } from './error.middleware';

describe('预发和生产的响应及日志', () => {
  afterEach(() => vi.restoreAllMocks());

  it('内部错误的参数不进入响应和日志，保留可查证的请求编号', async () => {
    const marker = 'synthetic-private-field';
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = new Hono<AppBindings>();
    app.onError(handleGlobalError);
    app.get('/read', () => {
      throw new Error(`数据库读取失败 ${marker}`);
    });
    app.get('/write', () => {
      throw new AppError('INTERNAL_ERROR', marker, { details: { value: marker } });
    });
    for (const APP_ENV of ['staging', 'production', undefined]) {
      for (const path of ['/read', '/write']) {
        const response = await app.request(path, undefined, { APP_ENV } as Env);
        expect(response.status).toBe(500);
        const body = (await response.json()) as { request_id: string };
        expect(JSON.stringify(body)).not.toContain(marker);
        expect(body.request_id).toMatch(/^[\da-f-]{36}$/i);
        expect(log).toHaveBeenLastCalledWith(expect.stringContaining(body.request_id));
      }
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(marker);
  });

  it('预发使用指定的浏览器来源，保留收银台轮询和语言请求头', async () => {
    const app = new Hono<AppBindings>();
    app.use('*', createCorsMiddleware());
    app.get('/status', (c) => c.json({ ok: true }));
    for (const APP_ENV of ['staging', 'production', undefined]) {
      const env = { APP_ENV, ALLOWED_ORIGINS: 'https://shop.example.test' } as Env;
      const originHeader = 'Access-Control-Allow-Origin';
      const allowed = await app.request(
        '/status',
        {
          method: 'OPTIONS',
          headers: { Origin: 'https://shop.example.test', 'Access-Control-Request-Method': 'GET' },
        },
        env
      );
      expect(allowed.headers.get(originHeader)).toBe(env.ALLOWED_ORIGINS);
      const headers = allowed.headers.get('Access-Control-Allow-Headers')?.toLowerCase();
      expect(headers).toContain('x-intent-token');
      expect(headers).toContain('x-lang');
      const other = await app.request('/status', { headers: { Origin: 'https://other.example.test' } }, env);
      expect(other.headers.has(originHeader)).toBe(false);
    }
  });
});
