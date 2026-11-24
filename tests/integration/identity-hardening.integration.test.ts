import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { agents, users } from '../../worker/db/schema/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

const email = 'identity@example.test';
const password = 'FixturePassword123!';
const credentials = JSON.stringify({ email, password });
const adminSecret = 'setup-fixture-secret';

let ctx: TestAppContext;

beforeEach(() => {
  resetRateLimitBucketsForTest();
  ctx = createTestApp({ ADMIN_SECRET: adminSecret });
});

afterEach(() => ctx.close());

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function register() {
  const res = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
    method: 'POST',
    body: credentials,
  });
  expect(res.status).toBe(200);
  return res.data;
}

async function login(input = credentials) {
  const res = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: input,
  });
  expect(res.status).toBe(200);
  return res.data.token;
}

it('[S03] B2B 仅接受有效密钥，响应不展示凭据摘要', async () => {
  const member = await register();
  const [row] = await ctx.db
    .insert(agents)
    .values({
      userId: member.user.id,
      slug: 'key-test',
      brandName: 'Fixture',
      apiKey: 'fixture-display-label',
    })
    .returning();
  const rejected = await ctx.request('/api/v1/reseller/balance', {
    headers: { 'X-API-Key': 'fixture-display-label' },
  });
  expect(rejected.status).toBe(401);

  const rotated = await ctx.jsonRequest<{ api_key: string }>(
    'http://key-test.localhost/api/agent/rotate-key',
    {
      method: 'POST',
      headers: bearer(member.token),
    }
  );
  expect(rotated.status).toBe(200);
  const [stored] = await ctx.db.select().from(agents).where(eq(agents.id, row.id));
  expect(stored.apiKeyHash).toBeTruthy();
  expect(stored.apiKey).not.toContain(stored.apiKeyHash.slice(0, 8));
  const overview = await ctx.jsonRequest<{ agents: Array<{ id: number; api_key: string }> }>(
    '/api/admin/overview',
    { headers: await ctx.adminHeaders() }
  );
  expect(overview.status).toBe(200);
  expect(overview.data.agents.find((agent) => agent.id === row.id)?.api_key).toBe('');
  expect(
    (await ctx.request('/api/v1/reseller/balance', { headers: { 'X-API-Key': rotated.data.api_key } })).status
  ).toBe(200);
});

it('[S11] 安装口令无后台权限，后台登录凭据在退出后立即失效', async () => {
  const member = await register();
  expect((await ctx.request('/api/admin/overview', { headers: bearer(member.token) })).status).toBe(403);
  expect(
    (await ctx.request('/api/admin/overview', { headers: { 'X-Admin-Secret': adminSecret } })).status
  ).toBe(403);
  expect(
    (await ctx.request('/api/admin/upstreams', { headers: { 'X-Admin-Secret': adminSecret } })).status
  ).toBe(403);
  await ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, member.user.id));
  expect((await ctx.request('/api/admin/overview', { headers: bearer(member.token) })).status).toBe(403);
  const admin = await login();
  const otherAdminSession = await login();
  expect(otherAdminSession).not.toBe(admin);
  expect((await ctx.request('/api/admin/overview', { headers: bearer(admin) })).status).toBe(200);
  expect((await ctx.request('/api/admin/upstreams', { headers: bearer(admin) })).status).toBe(200);
  expect((await ctx.request('/api/admin/ai/config', { headers: bearer(admin) })).status).toBe(200);
  expect((await ctx.request('/api/auth/logout', { method: 'POST', headers: bearer(admin) })).status).toBe(
    200
  );
  expect((await ctx.request('/api/admin/overview', { headers: bearer(admin) })).status).toBe(403);
  expect((await ctx.request('/api/admin/upstreams', { headers: bearer(admin) })).status).toBe(403);
  expect((await ctx.request('/api/admin/ai/config', { headers: bearer(admin) })).status).toBe(403);
  expect((await ctx.request('/api/admin/overview', { headers: bearer(otherAdminSession) })).status).toBe(200);
});

it('[S23] 改密撤销所有旧会话，重新登录可以访问 TOTP 和代理工作台', async () => {
  const member = await register();
  const second = await login();
  const totp = await ctx.jsonRequest('/api/account/totp-vault', {
    method: 'POST',
    headers: bearer(second),
    body: JSON.stringify({ issuer: 'fixture', account_name: email, secret: 'JBSWY3DPEHPK3PXP' }),
  });
  expect(totp.status).toBe(200);
  await ctx.db.insert(agents).values({
    userId: member.user.id,
    slug: 'password-test',
    brandName: 'Fixture',
    apiKey: 'password-fixture-label',
  });
  const changed = await ctx.jsonRequest('/api/account/password', {
    method: 'PUT',
    headers: bearer(member.token),
    body: JSON.stringify({ current_password: password, new_password: 'ChangedPassword123!' }),
  });
  expect(changed.status).toBe(200);
  for (const token of [member.token, second]) {
    expect((await ctx.request('/api/account/totp-vault', { headers: bearer(token) })).status).toBe(401);
    expect((await ctx.request('/api/agent/me', { headers: bearer(token) })).status).toBe(401);
  }
  const fresh = await login(JSON.stringify({ email, password: 'ChangedPassword123!' }));
  const vault = await ctx.jsonRequest<{ items: unknown[] }>('/api/account/totp-vault', {
    headers: bearer(fresh),
  });
  expect(vault.status).toBe(200);
  expect(vault.data.items).toHaveLength(1);
  expect((await ctx.request('/api/agent/me', { headers: bearer(fresh) })).status).toBe(200);
});

it('[S28] 暂停代理立即失去商家读取权限，个人会员会话仍可用', async () => {
  const member = await register();
  const [row] = await ctx.db
    .insert(agents)
    .values({
      userId: member.user.id,
      slug: 'suspended-test',
      brandName: 'Fixture',
      apiKey: 'suspended-fixture-label',
    })
    .returning();
  const headers = bearer(member.token);
  expect((await ctx.request('/api/agent/me', { headers })).status).toBe(200);
  await ctx.db.update(agents).set({ status: 'suspended' }).where(eq(agents.id, row.id));
  expect((await ctx.request('/api/agent/me', { headers })).status).toBe(403);
  const me = await ctx.jsonRequest<{ user: { id: number; agent: unknown } }>('/api/auth/me', { headers });
  expect(me.status).toBe(200);
  expect(me.data.user).toMatchObject({ id: member.user.id, agent: null });
});
