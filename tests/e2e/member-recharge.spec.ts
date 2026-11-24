import { expect, test } from './browser-fixture';

test('[B18] 关闭沙盒时通过网关创建充值单，确认钱包入账后刷新余额', async ({ page }) => {
  let credited = false;
  let directRechargeCalls = 0;
  let pollCount = 0;
  const intent = {
    intent_no: 'B18-PAY',
    biz_type: 'wallet_recharge',
    provider: 'stripe',
    currency: 'CNY',
    status: 'pending',
    amount_cny: 100,
    pay_amount: 100,
    pay_url: 'https://example.test/pay',
    qr_content: '',
    expires_at: '2099-01-01 00:00:00',
    sandbox_simulated: false,
    view_token: 'b18-test-token',
  };

  await page.addInitScript(() => {
    localStorage.setItem('accthub_token', 'member-b18');
    localStorage.setItem('accthub_lang', 'zh-CN');
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 1,
          email: 'recharge@example.test',
          display_name: '充值回归',
          balance: credited ? 150 : 50,
          role: 'user',
        },
      },
    })
  );
  await page.route('**/api/storefront/bootstrap*', async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    await route.fulfill({
      response,
      json: {
        ...bootstrap,
        settings: { ...bootstrap.settings, popup_enabled: 'false' },
        payment_methods: [
          { id: 'balance', name: '站内余额', enabled: 1 },
          { id: 'stripe', name: 'Stripe', enabled: 1 },
        ],
      },
    });
  });
  await page.route('**/api/account/recharge', (route) => {
    directRechargeCalls++;
    return route.fulfill({ status: 403, json: { message: '关闭沙盒直充' } });
  });
  await page.route('**/api/account/recharge/intent', (route) =>
    route.fulfill({ json: { ok: true, requires_payment: true, payment_intent: intent } })
  );
  await page.route('**/api/payments/intents/B18-PAY', (route) => {
    pollCount++;
    if (pollCount >= 2) credited = true;
    return route.fulfill({
      json: {
        intent: {
          ...intent,
          status: 'paid',
          fulfill_status: credited ? 'done' : 'processing',
        },
        ...(credited ? { balance: 150 } : {}),
      },
    });
  });

  await page.goto('/account/recharge');
  await expect(page.getByRole('heading', { name: '充值中心' })).toBeVisible();
  const screen = page.locator('main');
  const created = page.waitForRequest('**/api/account/recharge/intent', { timeout: 5000 });
  await page.getByRole('button', { name: '立即充值 ¥100' }).click();
  expect((await created).postDataJSON()).toEqual({ amount: 100, payment_method: 'stripe' });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('款项已收到，等待入账')).toBeVisible();
  await expect(screen.getByText('¥50.00', { exact: true })).toBeVisible();
  await expect(page.getByText('充值成功！已到账 ¥100.00，当前余额 ¥150.00')).toBeVisible({
    timeout: 12000,
  });
  await expect(screen.getByText('¥150.00', { exact: true })).toBeVisible();
  expect(pollCount).toBeGreaterThanOrEqual(2);
  expect(directRechargeCalls).toBe(0);
});
