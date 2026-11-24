import type { Page } from '@playwright/test';
import { expect, test } from './browser-fixture';

const knownSeed = 'JBSWY3DPEHPK3PXP';
const vaultInput = 'Paste Base32 secret or otpauth:// URI';
const account = {
  id: 71,
  site_agent_id: 0,
  role: 'user',
  email: 'account-fixture@example.test',
  display_name: 'Privacy fixture',
  balance: 0,
};

async function preparePage(page: Page, signedIn = false) {
  await page.addInitScript(
    ({ token }) => {
      localStorage.setItem('accthub_lang', 'en');
      sessionStorage.setItem('accthub_popup_seen_1', '1');
      if (token) localStorage.setItem('accthub_token', token);
    },
    { token: signedIn ? 'privacy-fixture' : '' }
  );
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      json: { user: route.request().headers().authorization === 'Bearer privacy-fixture' ? account : null },
    });
  });
  await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { ok: true } }));
}

test('[S25][S37] 同标签页退出时，清除上一账号的云端列表、输入和二维码', async ({ page }) => {
  await preparePage(page, true);
  await page.route('**/api/account/totp-vault', async (route) => {
    await route.fulfill({
      json: {
        items:
          route.request().headers().authorization === 'Bearer privacy-fixture'
            ? [
                {
                  id: '1',
                  issuer: 'Private fixture',
                  account_name: 'member',
                  secret: knownSeed,
                  digits: 8,
                  period: 60,
                },
              ]
            : [],
      },
    });
  });
  await page.goto('/2fa');
  await page.getByText('Private fixture', { exact: true }).click();
  await expect(page.getByPlaceholder(vaultInput)).toHaveValue(knownSeed);
  await expect(page.getByAltText('2FA QR Code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Privacy fixture' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByPlaceholder(vaultInput)).toHaveValue('');
  await expect(page.getByText('Private fixture', { exact: true })).toHaveCount(0);
  await expect(page.getByAltText('2FA QR Code', { exact: true })).toHaveCount(0);
});

test('[B35][B37][B38] 游客保险箱恢复验证码参数，并准确说明存储和时钟来源', async ({ page }) => {
  await preparePage(page);
  await page.addInitScript(
    ({ secret }) => {
      localStorage.setItem(
        'accthub_saved_2fa_v2',
        JSON.stringify([
          { id: '1', issuer: 'Local fixture', account_name: 'member', secret, digits: 8, period: 60 },
        ])
      );
    },
    { secret: knownSeed }
  );
  await page.goto('/2fa');
  await page.getByText('Local fixture', { exact: true }).click();
  await expect(page.getByPlaceholder(vaultInput)).toHaveValue(knownSeed);
  await page.getByRole('button', { name: 'Options', exact: true }).click();
  const options = page.locator('select').filter({ has: page.getByRole('option', { name: '60s' }) });
  const digits = page.locator('select').filter({ has: page.getByRole('option', { name: '8', exact: true }) });
  await expect(digits).toHaveValue('8');
  await expect(options).toHaveValue('60');
  await expect(page.getByText('Codes use your device clock')).toBeVisible();
  await expect(page.getByAltText('2FA QR Code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Saved in this browser. Local entries stay here when you sign in.')
  ).toBeVisible();
});

test('[B36] 批量持久化失败时保留原保险箱和待导入内容', async ({ page }) => {
  await preparePage(page);
  await page.addInitScript(() => {
    const storageKey = 'accthub_saved_2fa_v2';
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: '1',
          issuer: 'Existing fixture',
          account_name: '',
          secret: 'JBSWY3DPEHPK',
          digits: 6,
          period: 30,
        },
      ])
    );
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === storageKey) throw new DOMException('Fixture quota exceeded', 'QuotaExceededError');
      write.call(this, key, value);
    };
  });
  await page.goto('/2fa');
  await page.getByRole('button', { name: 'Batch Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Batch Import 2FA Secrets' });
  await dialog.locator('textarea').fill(knownSeed);
  await dialog.getByRole('button', { name: 'Parse & Import' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Save failed');
  await expect(dialog.locator('textarea')).toHaveValue(knownSeed);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Existing fixture', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('accthub_saved_2fa_v2'));
  expect(stored).toContain('Existing fixture');
  expect(stored).not.toContain(knownSeed);
});

test('[B49] 开发者文档说明会员先开通代理等级，品牌接口要求活跃代理', async ({ page }) => {
  await preparePage(page);
  await page.goto('/docs');
  await expect(page.getByText('Update an Active Partner Store', { exact: true })).toBeVisible();
  await expect(page.getByText(/POST \/api\/agent\/recharge/)).toContainText('active partner');
});

test('[S33] 订单凭证只经页面内存交给验证码生成器', async ({ page }) => {
  await preparePage(page, true);
  await page.route('**/api/orders/lookup**', async (route) => {
    await route.fulfill({
      json: {
        orders: [
          {
            order_no: 'AH-PRIVACY-FIXTURE',
            status: 'delivered',
            product_title: 'Privacy fixture product',
            product_id: 1,
            spec_name: 'Fixture',
            quantity: 1,
            contact_email: account.email,
            created_at: '2026-11-21',
            total_amount: 1,
            payment_method: 'balance',
            delivered_payload: `email: ${account.email}\n2FA: ${knownSeed}`,
          },
        ],
      },
    });
  });
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Get 2FA Code' }).click();
  await expect(page.getByPlaceholder(vaultInput)).toHaveValue(knownSeed);
  expect(new URL(page.url()).search).toBe('');
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(knownSeed);
  await page.reload();
  await expect(page.getByPlaceholder(vaultInput)).toHaveValue('');
});
