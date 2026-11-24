import { test as base, expect, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

export const test = base.extend({
  baseURL: async ({ browserName: _browserName }, use) => {
    const origin = process.env.ACCTHUB_E2E_ORIGIN;
    if (!origin) throw new Error('浏览器测试 Worker 未启动');
    await use(origin);
  },
});

export function seededSession(role: 'admin' | 'agent') {
  const token = process.env[role === 'admin' ? 'ACCTHUB_E2E_ADMIN_TOKEN' : 'ACCTHUB_E2E_AGENT_TOKEN'];
  if (!token) throw new Error(`浏览器测试缺少 ${role} 会话`);
  return token;
}

export function tenantOrigin(slug: string) {
  const base = process.env.ACCTHUB_E2E_ORIGIN;
  if (!base) throw new Error('浏览器测试 Worker 未启动');
  const url = new URL(base);
  return `${url.protocol}//${slug}.localhost${url.port ? `:${url.port}` : ''}`;
}

export async function dismissStoreWelcome(page: Page) {
  const dismiss = page.getByRole('button', { name: '我知道了，开始浏览', exact: true });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
}
