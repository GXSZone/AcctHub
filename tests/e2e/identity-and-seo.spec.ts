import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { dismissStoreWelcome, expect, tenantOrigin, test } from './browser-fixture';

const memberPassword = 'BrowserFixture#2026';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function seedMember(request: APIRequestContext, name: string, secret: string) {
  const email = `${randomUUID()}@example.test`;
  const signup = await request.post('/api/auth/register', {
    data: { email, password: memberPassword, display_name: name },
  });
  await expect(signup).toBeOK();
  const { token } = (await signup.json()) as { token: string };
  await expect(
    await request.post('/api/account/totp-vault', {
      headers: { Authorization: `Bearer ${token}` },
      data: { issuer: name, account_name: email, secret },
    })
  ).toBeOK();
  return { email, name };
}

async function login(page: Page, member: { email: string; name: string }) {
  const header = page.locator('header');
  await header.getByRole('button', { name: '登录 / 注册', exact: true }).click();
  await page.getByRole('textbox', { name: '电子邮箱', exact: true }).fill(member.email);
  await page.getByLabel('密码', { exact: true }).fill(memberPassword);
  await page.getByRole('button', { name: '立即登录' }).click();
  await expect(header.getByRole('button', { name: new RegExp(member.name) })).toBeVisible();
}

test('同一标签页切换会员，旧密钥、表单与迟到的云同步响应不会回流', async ({ page, request }) => {
  const secretA = 'JBSWY3DPEHPK3PXP';
  const memberA = await seedMember(request, '浏览器会员甲', secretA);
  const memberB = await seedMember(request, '浏览器会员乙', 'KRSXG5DSNFXGOIDB');
  await page.goto('/2fa');
  await dismissStoreWelcome(page);
  await login(page, memberA);
  const aVault = page.getByRole('button', { name: new RegExp(memberA.email) });
  const bVault = page.getByRole('button', { name: new RegExp(memberB.email) });
  await expect(aVault).toBeVisible();
  await aVault.click();
  const secret = page.getByPlaceholder(/粘贴密钥或 otpauth/);
  await expect(secret).toHaveValue(secretA);

  let fetched = false;
  let fetchError: unknown;
  const release = deferred();
  const finished = deferred();
  await page.route('**/api/account/totp-vault', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    if (route.request().headers().authorization !== tokenA) {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect(await response.text()).toContain(memberA.email);
      fetched = true;
      await release.promise;
      await route.fulfill({ response }).catch(() => {
        // 身份切换后浏览器可能已经取消了旧请求。
      });
      finished.resolve();
    } catch (error) {
      fetchError = error;
      finished.resolve();
    }
  });
  const tokenA = await page.evaluate(() => `Bearer ${localStorage.getItem('accthub_token')}`);
  try {
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect
      .poll(() => {
        if (fetchError) throw fetchError;
        return fetched;
      })
      .toBe(true);
    await page
      .locator('header')
      .getByRole('button', { name: new RegExp(memberA.name) })
      .click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(aVault).toHaveCount(0);
    await expect(secret).toHaveValue('');

    await login(page, memberB);
    await expect(bVault).toBeVisible();
    await expect(aVault).toHaveCount(0);
    release.resolve();
    await finished.promise;
    await expect(aVault).toHaveCount(0);
    await expect(secret).toHaveValue('');
    await expect(page).toHaveURL(/\/2fa$/);
  } finally {
    release.resolve();
  }
});

test('[B55] 独立构建的 Worker 为真实分站子域商品详情路径输出分站原始 HTML SEO', async ({ page }) => {
  const studio = '星尘 AI 研选社';
  const studioUrl = tenantOrigin('studio');
  await page.goto(`${studioUrl}/`);
  const productLink = page.locator('a[href^="/item/"]').first();
  await expect(productLink).toBeVisible();
  const title = (await productLink.getByRole('heading', { level: 3 }).textContent())?.trim() ?? '';
  expect(title).not.toBe('');
  const url = new URL((await productLink.getAttribute('href')) ?? '', page.url());
  expect(url.pathname).toMatch(/^\/item\/\d+$/);
  expect(url.searchParams.get('tenant')).toBeNull();
  const tenant = await page.goto(url.href);
  expect(tenant?.ok()).toBe(true);
  const rawTenantHtml = await tenant?.text();
  expect(rawTenantHtml).toMatch(/<title>[^<]*星尘 AI 研选社[^<]*<\/title>/);
  expect(rawTenantHtml).toMatch(/<meta[^>]+property="og:title"[^>]+content="[^"]*星尘 AI 研选社[^"]*"/);
  await expect(page.locator('header')).toContainText(studio);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

  const main = await page.goto(url.pathname);
  expect(main?.ok()).toBe(true);
  expect(await main?.text()).not.toMatch(/<title>[^<]*星尘 AI 研选社[^<]*<\/title>/);
  await expect(page.locator('header')).not.toContainText(studio);
});
