import { expect, test } from './browser-fixture';

test('[S11] 未登录与普通会员访问 /admin 显示 404，管理员登录进入后台并退出后退回首页', async ({ page }) => {
  const memberEmail = `admin-session-${Date.now()}@example.test`;
  const memberPassword = 'MemberFixture123!';
  const register = await page.request.post('/api/auth/register', {
    data: { email: memberEmail, password: memberPassword },
  });
  expect(register.ok()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem('accthub_lang', 'zh-CN'));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('accthub_admin_secret', 'legacy-browser-fixture'));
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '404 · 页面不存在' })).toBeVisible();
  await expect(page.getByRole('button', { name: '管理员登录', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('accthub_admin_secret'))).toBeNull();

  async function signInFromHeader(email: string, password: string) {
    await page.getByRole('button', { name: /登录 \/ 注册/ }).click();
    const modal = page.getByRole('dialog');
    await modal.locator('#auth-email').fill(email);
    await modal.locator('#auth-password').fill(password);
    await modal.getByRole('button', { name: '立即登录', exact: true }).click();
    await expect(modal).not.toBeVisible();
  }

  await page.getByRole('link', { name: '返回商品目录' }).click();
  await signInFromHeader('admin@accthub.dev', 'admin123456');
  await page.getByRole('link', { name: '运营管理' }).first().click();
  await expect(page.getByRole('navigation', { name: '运营总控侧边导航' })).toBeVisible();
  const oldToken = await page.evaluate(() => localStorage.getItem('accthub_token'));
  expect(oldToken).toBeTruthy();

  await page.getByRole('button', { name: /AcctHub 总控管理员/ }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('accthub_token'))).toBeNull();

  await signInFromHeader(memberEmail, memberPassword);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '404 · 页面不存在' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '运营总控侧边导航' })).toHaveCount(0);
  for (const path of ['/api/admin/overview', '/api/admin/upstreams']) {
    const oldSession = await page.request.get(path, { headers: { Authorization: `Bearer ${oldToken}` } });
    expect(oldSession.status()).toBe(403);
  }
});
