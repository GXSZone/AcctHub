import { users } from '../../../worker/db/schema/index';
import type { Env } from '../../../worker/env';
import { app } from '../../../worker/index';
import { hashPassword } from '../../../worker/infra/auth-crypto';
import { type AppDatabase, createDb } from '../../../worker/infra/db';
import { createTestD1Database } from './test-d1';

export interface TestAppContext {
  d1: D1Database;
  db: AppDatabase;
  env: Env;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  jsonRequest: <T = Record<string, unknown>>(
    path: string,
    init?: RequestInit
  ) => Promise<{ status: number; ok: boolean; headers: Headers; data: T }>;
  close: () => void;
  adminHeaders: () => Promise<{ Authorization: string }>;
}

/**
 * 创建隔离的内存 D1 + 完整 Hono Worker 应用集成测试上下文：
 * 直接基于 migrations/*.sql 权威建表，不依赖任何运行时建表兜底。
 */
export function createTestApp(envOverrides?: Partial<Env>): TestAppContext {
  const { d1, close } = createTestD1Database({ applyMigrations: true });
  const db = createDb(d1);
  const env: Env = {
    DB: d1,
    APP_ENV: 'test',
    SANDBOX_MODE: 'true',
    JWT_SECRET: 'test-integration-jwt-secret-key-at-least-32-chars',
    ...envOverrides,
  };

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http://') || path.startsWith('https://') ? path : `http://localhost${path}`;
    const req = new Request(url, init);
    return app.fetch(req, env);
  }

  async function jsonRequest<T = Record<string, unknown>>(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await request(path, { ...init, headers });
    const text = await res.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = { raw: text } as unknown as T;
    }
    return { status: res.status, ok: res.ok, headers: res.headers, data };
  }

  let adminSession: Promise<{ Authorization: string }> | undefined;
  function adminHeaders() {
    adminSession ??= (async () => {
      const email = 'test-operator@example.test';
      const credentials = { email, password: 'FixtureAdminPassword123!' };
      await db.insert(users).values({
        email,
        displayName: '测试管理员',
        passwordHash: await hashPassword(credentials.password),
        role: 'admin',
      });
      const login = await jsonRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      if (!login.ok) throw new Error(`测试管理员登录失败 (${login.status})`);
      return { Authorization: `Bearer ${login.data.token}` };
    })();
    return adminSession;
  }

  return { d1, db, env, request, jsonRequest, close, adminHeaders };
}
