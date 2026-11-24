import { randomUUID } from 'node:crypto';
import { storefrontEn } from '../../src/i18n/namespaces/storefront/en';
import { storefrontJa } from '../../src/i18n/namespaces/storefront/ja';
import { storefrontKo } from '../../src/i18n/namespaces/storefront/ko';
import { storefrontZhCN } from '../../src/i18n/namespaces/storefront/zh-CN';
import { storefrontZhTW } from '../../src/i18n/namespaces/storefront/zh-TW';
import { dismissStoreWelcome, expect, seededSession, test } from './browser-fixture';

const storefrontLocales = [
  ['zh-CN', storefrontZhCN],
  ['zh-TW', storefrontZhTW],
  ['en', storefrontEn],
  ['ja', storefrontJa],
  ['ko', storefrontKo],
] as const;

test('[B24][B27] 五语结账选择最大批发件数后，界面、订单和支付单金额一致', async ({ page, request }) => {
  const nonce = randomUUID();
  await expect(
    await request.put('/api/admin/mail-config', {
      headers: { Authorization: `Bearer ${seededSession('admin')}` },
      data: {
        enabled: true,
        auto_send_order: true,
        provider: 'custom_webhook',
        from_name: '阶梯定价测试商店',
        from_email: 'store@example.test',
        api_endpoint: process.env.ACCTHUB_E2E_MAIL_ENDPOINT,
      },
    })
  ).toBeOK();
  const catalog = await request.get('/api/storefront/products?category=all');
  await expect(catalog).toBeOK();
  const { items } = (await catalog.json()) as { items: Array<{ category_id: number }> };
  const created = await request.post('/api/admin/products', {
    headers: { Authorization: `Bearer ${seededSession('admin')}` },
    data: {
      category_id: items[0].category_id,
      slug: `pricing-${nonce}`,
      title: '浏览器阶梯价测试',
      base_price: 100,
      stock_mode: 'manual_stock',
      manual_stock: 25,
      specs: [{ id: 'fixture', name: '测试规格', price: 100, cost_price: 80 }],
      tier_pricing: [{ min_qty: 20, discount_rate: 0.6 }],
      allow_below_cost: true,
    },
  });
  await expect(created).toBeOK();
  const { id } = (await created.json()) as { id: number };

  await page.goto(`/item/${id}`);
  await dismissStoreWelcome(page);
  await page.getByText(`¥80.00${storefrontZhCN.bulkUpsellUnit}`, { exact: true }).waitFor();
  await page.getByRole('button', { name: '满 20 件 8 折', exact: true }).click();

  const lang = page.getByTestId('header-locale-select');
  for (const [locale, messages] of storefrontLocales) {
    await lang.selectOption(locale);
    await expect(page.getByRole('button', { name: messages.incQtyAria, exact: true })).toBeDisabled();
    await expect(
      page.getByRole('button', { name: `${messages.checkoutBtnPrefix} · ¥1600.00`, exact: true })
    ).toBeVisible();
  }

  const checkout = {
    product_id: id,
    spec_id: 'fixture',
    quantity: 21,
    contact_email: `buyer-${nonce}@example.test`,
    payment_method: 'epay',
  };
  expect((await request.post('/api/orders', { data: checkout })).status()).toBe(400);

  await lang.selectOption('zh-CN');
  await page.getByLabel(/收货.*邮箱/).fill(checkout.contact_email);
  await page.getByRole('button', { name: /易支付/ }).click();
  const orderResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: `${storefrontZhCN.checkoutBtnPrefix} · ¥1600.00` }).click();
  const result = await orderResponse;
  expect(result.ok()).toBe(true);
  expect(await result.json()).toMatchObject({
    order: { quantity: 20, unit_price: 80, total_amount: 1600, status: 'pending_payment' },
    payment_intent: { amount_cny: 1600, pay_amount: 1600, provider: 'epay' },
  });
});
