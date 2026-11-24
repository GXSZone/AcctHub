import { dismissStoreWelcome, expect, test } from './browser-fixture';

test('[B30][B32] 游客查单的挑战脚本失败后同页重试，查单错误与无匹配独立显示', async ({ page }) => {
  await page.route('**/api/storefront/bootstrap*', async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({
      response,
      json: {
        ...payload,
        security: { ...payload.security, turnstile_enabled: true, turnstile_site_key: 'challenge-fixture' },
      },
    });
  });
  let scriptLoads = 0;
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', async (route) => {
    if (++scriptLoads === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = {
        render(container, options) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = '测试挑战';
          button.onclick = () => options.callback('browser-challenge-fixture');
          container.appendChild(button);
          return 'challenge-fixture';
        },
        reset() {},
        remove() {},
      };`,
    });
  });
  let lookups = 0;
  await page.route('**/api/orders/lookup', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toMatchObject({
      q: 'AHQ-TEST-FIXTURE',
      turnstile_token: 'browser-challenge-fixture',
    });
    if (++lookups === 1) {
      await route.fulfill({ status: 400, json: { error: '挑战校验未通过' } });
      return;
    }
    await route.fulfill({ status: 200, json: { orders: [], next_cursor: null } });
  });

  await page.goto('/orders');
  await dismissStoreWelcome(page);
  await page.getByPlaceholder('输入完整查单号（AHQ-…）').fill('AHQ-TEST-FIXTURE');
  const submit = page.getByRole('button', { name: '查询凭证' });
  await expect(submit).toBeDisabled();
  const originalUrl = page.url();
  await page.getByRole('button', { name: '验证加载失败，点击重试' }).click();
  await expect(page.getByRole('button', { name: '测试挑战' })).toBeVisible();
  await expect(page.locator('script#accthub-cf-turnstile-js')).toHaveCount(1);
  expect(page.url()).toBe(originalUrl);
  expect(scriptLoads).toBe(2);

  await page.getByRole('button', { name: '测试挑战' }).click();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('挑战校验未通过');
  await expect(page.getByText('暂无匹配的订单记录')).toHaveCount(0);
  await expect(submit).toBeDisabled();
  await page.getByRole('button', { name: '测试挑战' }).click();
  await submit.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('暂无匹配的订单记录')).toBeVisible();
  expect(lookups).toBe(2);
});
