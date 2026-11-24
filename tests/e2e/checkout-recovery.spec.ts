import { randomUUID } from 'node:crypto';
import { dismissStoreWelcome, expect, seededSession, test } from './browser-fixture';

test('[B07][S43] 结账响应丢失后刷新仍能恢复原收银台，确认新结账才生成新订单', async ({ page, request }) => {
  const nonce = randomUUID();
  const email = `buyer-${nonce}@example.test`;
  const headers = { Authorization: `Bearer ${seededSession('admin')}` };
  await expect(
    await request.put('/api/admin/mail-config', {
      headers,
      data: {
        enabled: true,
        auto_send_order: true,
        provider: 'custom_webhook',
        from_name: '结账恢复测试商店',
        from_email: 'store@example.test',
        api_endpoint: process.env.ACCTHUB_E2E_MAIL_ENDPOINT,
      },
    })
  ).toBeOK();
  const catalog = await request.get('/api/storefront/products?category=all');
  await expect(catalog).toBeOK();
  const { items } = (await catalog.json()) as { items: Array<{ category_id: number }> };
  const product = await request.post('/api/admin/products', {
    headers,
    data: {
      category_id: items[0].category_id,
      slug: `checkout-recovery-${nonce}`,
      title: '重复结账验证商品',
      base_price: 36,
      stock_mode: 'cards',
      delivery_type: 'auto',
      specs: [{ id: 'fixture', name: '测试规格', price: 36 }],
    },
  });
  await expect(product).toBeOK();
  const { id } = (await product.json()) as { id: number };
  await expect(
    await request.post(`/api/admin/products/${id}/cards`, {
      headers,
      data: { spec_id: 'fixture', lines: `FIRST-${nonce}\nSECOND-${nonce}` },
    })
  ).toBeOK();

  const created: Array<{ key: string; orderNo: string; intentNo: string }> = [];
  await page.route('**/api/orders', async (route) => {
    const { idempotency_key: key } = route.request().postDataJSON() as { idempotency_key: string };
    const response = await route.fetch();
    await expect(response).toBeOK();
    const data = (await response.json()) as {
      order: { order_no: string };
      payment_intent: { intent_no: string };
    };
    created.push({ key, orderNo: data.order.order_no, intentNo: data.payment_intent.intent_no });
    if (created.length === 1) await route.abort();
    else await route.fulfill({ response });
  });

  const submit = async () => {
    await page.getByLabel(/收货.*邮箱/).fill(email);
    await page.getByRole('button', { name: /易支付/ }).click();
    await page.getByRole('button', { name: /确认结算/ }).click();
  };
  await page.goto(`/item/${id}`);
  await dismissStoreWelcome(page);
  await submit();
  const restore = page.getByRole('button', { name: '恢复上次结账' });
  await expect(restore).toBeEnabled();
  expect(created).toHaveLength(1);
  const original = created[0];

  await page.reload();
  await restore.click();
  const cashier = page.getByRole('dialog', { name: '在线收银台' });
  await expect(cashier).toContainText(original.intentNo);
  await expect(cashier.getByRole('heading', { name: '请完成在线付款' })).toBeVisible();
  expect(created).toHaveLength(1);
  const checked = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/payments/intents/${original.intentNo}/check`
  );
  await cashier.getByRole('button', { name: '我已付款 · 立即核单' }).click();
  const checkResponse = await checked;
  expect(checkResponse.ok()).toBe(true);
  expect(await checkResponse.json()).toMatchObject({ ok: true, status: 'pending' });
  await cashier.getByRole('button', { name: /关闭/ }).click();

  await page.getByRole('button', { name: '开始新结账' }).click();
  const confirmation = page.getByRole('dialog', { name: '开始新结账' });
  await confirmation.getByRole('button', { name: '开始新结账' }).click();
  await expect(restore).toHaveCount(0);
  await submit();
  await expect(cashier).toBeVisible();
  expect(created).toHaveLength(2);
  const next = created[1];
  expect(next.key).not.toBe(original.key);
  expect(next.orderNo).not.toBe(original.orderNo);
  expect(next.intentNo).not.toBe(original.intentNo);
  await expect(cashier).toContainText(next.intentNo);
});
