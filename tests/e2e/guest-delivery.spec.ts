import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import { dismissStoreWelcome, expect, seededSession, test } from './browser-fixture';

type Message = { to: string; scene: string; text: string };

async function waitForMail(request: APIRequestContext, email: string, scene: string) {
  const inbox = new URL('/inbox', process.env.ACCTHUB_E2E_INBOX);
  inbox.searchParams.set('to', email);
  let message: Message | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(inbox.href);
        expect(response.ok()).toBe(true);
        message = ((await response.json()) as Message[]).find((entry) => entry.scene === scene);
        return Boolean(message);
      },
      { timeout: 15_000 }
    )
    .toBe(true);
  if (!message) throw new Error(`未收到 ${scene} 邮件`);
  return message;
}

async function lookup(page: Page, orderNo: string, password: string) {
  await page.getByPlaceholder(/输入完整查单号/).fill(orderNo);
  await page.getByPlaceholder(/查单口令/).fill(password);
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/orders/lookup');
  await page.getByRole('button', { name: '查询凭证' }).click();
  return response;
}

for (const { name, password } of [
  { name: '有选填口令', password: '729461' },
  { name: '无查单口令', password: '' },
]) {
  test(`游客${name}，从收件箱恢复订单并见到指定的交付卡密`, async ({ browser, page, request, baseURL }) => {
    const nonce = randomUUID();
    const email = `buyer-${nonce}@example.test`;
    const card = `E2E-CARD-${nonce}`;
    const title = `浏览器交付专用商品 ${nonce}`;
    const headers = { Authorization: `Bearer ${seededSession('admin')}` };
    await expect(
      await request.put('/api/admin/mail-config', {
        headers,
        data: {
          enabled: true,
          auto_send_order: true,
          provider: 'custom_webhook',
          from_name: '浏览器测试商店',
          from_email: 'store@example.test',
          api_endpoint: process.env.ACCTHUB_E2E_MAIL_ENDPOINT,
        },
      })
    ).toBeOK();
    const catalog = await request.get('/api/storefront/products?category=all');
    await expect(catalog).toBeOK();
    const { items } = (await catalog.json()) as { items: Array<{ category_id: number }> };
    expect(items[0]?.category_id).toBeGreaterThan(0);
    const product = await request.post('/api/admin/products', {
      headers,
      data: {
        category_id: items[0].category_id,
        slug: `e2e-${nonce}`,
        title,
        base_price: 36,
        stock_mode: 'cards',
        delivery_type: 'auto',
        specs: [{ id: 'fixture', name: '本地测试卡', price: 36 }],
      },
    });
    await expect(product).toBeOK();
    const { id } = (await product.json()) as { id: number };
    await expect(
      await request.post(`/api/admin/products/${id}/cards`, {
        headers,
        data: { spec_id: 'fixture', lines: card },
      })
    ).toBeOK();

    await page.goto(`/item/${id}`);
    await dismissStoreWelcome(page);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.getByLabel(/收货.*邮箱/).fill(email);
    if (password) await page.getByLabel(/查单保护口令/).fill(password);
    await page.getByRole('button', { name: /易支付/ }).click();
    await page.getByRole('button', { name: /确认结算/ }).click();
    const cashier = page.getByRole('dialog', { name: '在线收银台' });
    await expect(cashier.getByRole('heading', { name: '请完成在线付款' })).toBeVisible();
    await expect(page.getByText(card, { exact: true })).toHaveCount(0);

    const receipt = await waitForMail(request, email, 'order_created');
    const orderNo = receipt.text.match(/订单号：([^\s]+)/)?.[1];
    const lookupUrl = receipt.text.match(/在线查单：([^\s]+)/)?.[1];
    expect(orderNo).toMatch(/^AHQ-[a-f0-9]{32}$/);
    expect(receipt.text).not.toContain(card);
    if (!orderNo || !lookupUrl) throw new Error('订单邮件缺少公开查单号或查单地址');
    expect(new URL(lookupUrl).origin).toBe(baseURL);

    const fresh = await browser.newContext({ baseURL, locale: 'zh-CN' });
    try {
      const guest = await fresh.newPage();
      await guest.goto(lookupUrl);
      await dismissStoreWelcome(guest);
      await lookup(guest, orderNo, password);
      await expect(guest.getByRole('heading', { name: title })).toBeVisible();
      await expect(guest.getByText('待付款', { exact: true })).toBeVisible();
      await expect(guest.getByText(card, { exact: true })).toHaveCount(0);

      await cashier.getByRole('button', { name: '沙盒模拟付款回调' }).click();
      await expect(cashier).toBeHidden();
      const delivery = await waitForMail(request, email, 'order_delivery');
      expect(delivery.text).toContain(orderNo);
      expect(delivery.text).toContain(card);

      if (password) {
        const denied = await lookup(guest, orderNo, '111111');
        expect(new URL(denied.url()).search).toBe('');
        expect(denied.request().method()).toBe('POST');
        expect(await denied.text()).not.toContain(card);
        await expect(guest.getByText(card, { exact: true })).toHaveCount(0);
      }
      await lookup(guest, orderNo, password);
      await expect(guest.getByRole('heading', { name: title })).toBeVisible();
      await expect(guest.getByText('已自动交付', { exact: true })).toBeVisible();
      await expect(guest.getByText(card, { exact: true })).toBeVisible();
    } finally {
      await fresh.close();
    }
  });
}
