import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  adminAuditLogs,
  categories,
  categoryGroups,
  orders,
  paymentPlugins,
  products,
} from '../../worker/db/schema/index';
import { createTestApp } from './helpers/test-app';

it('[S20] 沙盒支付单号只写入文本节点且所有合法请求共用静态脚本', async () => {
  const app = createTestApp();
  try {
    const first = 'PAY12345678901234';
    const second = 'PAY12345678901235';
    const page = async (intent: string, provider: string) => {
      const response = await app.request(
        `/api/payments/sandbox/mock-gateway?intent=${intent}&provider=${provider}`
      );
      expect(response.ok).toBe(true);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      return response.text();
    };
    const firstPage = await page(first, 'epay');
    const secondPage = await page(second, 'stripe');
    expect(firstPage).toContain(`<code id="intentNo">${first}</code>`);
    expect(secondPage).toContain(`<code id="intentNo">${second}</code>`);
    const script = (html: string) => html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script(firstPage)).toContain("document.getElementById('intentNo').textContent");
    expect(script(firstPage)).toBe(script(secondPage));
    expect(script(firstPage)).not.toContain(first);
    expect(script(secondPage)).not.toContain(second);
  } finally {
    app.close();
  }
});

it('[S02] 人工补发在后台和 CSV 只记订单关联和凭证件数', async () => {
  const app = createTestApp();
  try {
    const headers = await app.adminHeaders();
    const [group] = await app.db
      .insert(categoryGroups)
      .values({ slug: 'manual-audit', name: '补发' })
      .returning();
    const [category] = await app.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'manual-cards', name: '卡密' })
      .returning();
    const [product] = await app.db
      .insert(products)
      .values({ categoryId: category.id, slug: 'manual-product', title: '人工交付测试', basePrice: 20 })
      .returning();
    const orderNo = 'AUDIT-MANUAL-FIXTURE';
    await app.db.insert(orders).values({
      orderNo,
      contactEmail: 'manual-buyer@example.test',
      productId: product.id,
      productTitle: product.title,
      status: 'upstream_pending',
      quantity: 2,
      unitPrice: 20,
      totalAmount: 40,
    });
    const markers = ['TEST-CARD-AUDIT-A', 'TEST-CARD-AUDIT-B'];
    const fulfilled = await app.jsonRequest(`/api/admin/upstreams/local-orders/${orderNo}/manual-fulfill`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cards_text: markers.join('\n'), upstream_order_no: 'SUPPLIER-AUDIT-MARKER' }),
    });
    expect(fulfilled.status).toBe(200);
    const [audit] = await app.db
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.action, 'upstreams.create_or_exec.manual-fulfill'));
    expect(audit.targetId).toBe(orderNo);
    expect(JSON.parse(audit.afterJson)).toEqual({ count: 2 });
    for (const path of ['/api/admin/audit-logs', '/api/admin/audit-logs/csv']) {
      const result = await app.request(path, { headers });
      expect(result.ok).toBe(true);
      const body = await result.text();
      expect(body).toContain(orderNo);
      for (const marker of [...markers, 'SUPPLIER-AUDIT-MARKER']) expect(body).not.toContain(marker);
    }
  } finally {
    app.close();
  }
});

it('[S35] 后台概览仅返回支付密钥配置状态，保存留空和替换均不回吐密钥', async () => {
  const app = createTestApp();
  try {
    const headers = await app.adminHeaders();
    const markers = ['OVERVIEW-KEY-PREVIOUS', 'OVERVIEW-KEY-REPLACED'];
    await app.db
      .insert(paymentPlugins)
      .values({ id: 'epay', name: '测试易支付', description: '试验', enabled: 0 });
    const update = async (key: string, pid: string) => {
      const result = await app.jsonRequest('/api/admin/payment-plugins/epay', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: true, config: { key, pid } }),
      });
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ ok: true });
    };
    const storedConfig = async () => {
      const [row] = await app.db.select().from(paymentPlugins).where(eq(paymentPlugins.id, 'epay'));
      expect(row).toBeDefined();
      return row.configJson;
    };
    const expectSafeOverview = async (pid: string) => {
      const result = await app.jsonRequest<{
        payment_plugins: {
          id: string;
          config_json: string;
          enabled: number;
          secrets_configured: Record<string, boolean>;
        }[];
      }>('/api/admin/overview', { headers });
      expect(result.status).toBe(200);
      expect(result.data.payment_plugins).toEqual(expect.any(Array));
      const epay = result.data.payment_plugins.find((entry) => entry.id === 'epay');
      expect(epay).toMatchObject({ enabled: 1, secrets_configured: { key: true } });
      const publicConfig = JSON.parse(epay?.config_json ?? '{}');
      expect(publicConfig).toMatchObject({ pid });
      expect(publicConfig).not.toHaveProperty('key');
      for (const marker of markers) expect(JSON.stringify(result.data)).not.toContain(marker);
    };

    await update(markers[0], 'merchant-original');
    const previousKey = JSON.parse(await storedConfig()).key;
    expect(previousKey).toBeTruthy();
    await expectSafeOverview('merchant-original');

    await update('', 'merchant-changed');
    expect(JSON.parse(await storedConfig()).key).toEqual(previousKey);
    await expectSafeOverview('merchant-changed');

    await update(markers[1], 'merchant-changed');
    const replacedKey = JSON.parse(await storedConfig()).key;
    expect(replacedKey).toBeTruthy();
    expect(replacedKey).not.toEqual(previousKey);
    await expectSafeOverview('merchant-changed');
  } finally {
    app.close();
  }
});
