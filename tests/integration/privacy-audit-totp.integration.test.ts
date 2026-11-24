import { expect, it } from 'vitest';
import { adminAuditLogs } from '../../worker/db/schema/core';
import { orders } from '../../worker/db/schema/orders';
import { createTestApp } from './helpers/test-app';

it('[S02] 支付配置审计只记录密钥更新状态，历史凭据不返回给列表与 CSV', async () => {
  const app = createTestApp();
  try {
    const headers = await app.adminHeaders();
    const result = await app.jsonRequest('/api/admin/payment-plugins/epay', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        enabled: true,
        config: {
          key: 'fixture-signing-value',
          pid: 'fixture-merchant',
        },
      }),
    });
    expect(result.status).toBe(200);
    const [written] = await app.db.select().from(adminAuditLogs);
    expect(JSON.parse(written.afterJson)).toMatchObject({
      enabled: true,
      credentials_updated: true,
    });
    expect(written.afterJson).not.toContain('fixture-signing-value');
    await app.db.insert(adminAuditLogs).values({
      action: 'payment-plugins.update',
      targetType: 'payment-plugins',
      targetId: 'epay',
      summary: '测试历史支付配置',
      afterJson: '{"enabled":true,"config":{"key":"fixture-historical-signing-value"}}',
    });
    await app.db.insert(adminAuditLogs).values({
      action: 'upstreams.create_or_exec.AH-1',
      targetType: 'upstreams',
      targetId: 'local-orders',
      summary: '测试历史补发',
      afterJson: '{"cards_text":"fixture-historical-card","upstream_order_no":"A1"}',
    });
    await app.db.insert(adminAuditLogs).values({
      action: 'setup.initialize',
      targetType: 'system',
      targetId: '1',
      summary: '测试历史冷启动',
      afterJson: '{"brand_name":"Fixture Audit Store","admin_secret":"fixture-historical-admin-secret"}',
    });
    for (const path of ['/api/admin/audit-logs', '/api/admin/audit-logs/csv']) {
      const response = await app.request(path, { headers });
      expect(response.status).toBe(200);
      const content = await response.text();
      expect(content).not.toContain('fixture-historical-card');
      expect(content).not.toContain('fixture-historical-signing-value');
      expect(content).not.toContain('fixture-historical-admin-secret');
      expect(content).toContain('Fixture Audit Store');
    }
  } finally {
    app.close();
  }
});

it('[S02] 人工补发审计保留订单标识和数量', async () => {
  const app = createTestApp();
  const orderNo = 'AH-AUDIT-PRIVACY';
  try {
    const headers = await app.adminHeaders();
    await app.db.insert(orders).values({
      orderNo,
      productId: 1,
      productTitle: '审计测试商品',
      contactEmail: 'audit-fixture@example.com',
      quantity: 2,
      unitPrice: 1,
      totalAmount: 2,
      status: 'fulfillment_failed',
    });
    const delivered = await app.jsonRequest(`/api/admin/upstreams/local-orders/${orderNo}/manual-fulfill`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ cards_text: 'fixture-delivery-1\nfixture-delivery-2' }),
    });
    expect(delivered.status).toBe(200);
    const [written] = await app.db.select().from(adminAuditLogs);
    expect(written.targetId).toBe(orderNo);
    expect(JSON.parse(written.afterJson)).toEqual({ count: 2 });
  } finally {
    app.close();
  }
});

it('[B12] CSV 实际导出的每行都符合目标类型筛选', async () => {
  const app = createTestApp();
  try {
    const headers = await app.adminHeaders();
    await app.db.insert(adminAuditLogs).values([
      {
        action: 'orders.update',
        targetType: 'orders',
        targetId: 'AH-FILTER-FIXTURE',
        summary: '订单测试日志',
      },
      {
        action: 'payment-plugins.update',
        targetType: 'payment-plugins',
        targetId: 'payment-filter-fixture',
        summary: '支付测试日志',
      },
    ]);
    const response = await app.request('/api/admin/audit-logs/csv?target_type=orders', { headers });
    expect(response.status).toBe(200);
    const [header, row, ...extraRows] = (await response.text()).split('\r\n');
    expect(header).toContain('目标类型');
    expect(row).toContain('"orders","AH-FILTER-FIXTURE"');
    expect(extraRows).toEqual([]);
  } finally {
    app.close();
  }
});

it('[B35] 云端批量导入后读取的条目保留 8 位与 60 秒参数', async () => {
  const app = createTestApp();
  try {
    const registered = await app.jsonRequest<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'vault-test@example.com',
        password: 'FixturePassword#2026',
        display_name: 'Vault Test',
      }),
    });
    expect(registered.status).toBe(200);
    const headers = { Authorization: `Bearer ${registered.data.token}` };
    const batch = await app.jsonRequest('/api/account/totp-vault/batch', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [
          { issuer: 'Test', account_name: 'member', secret: 'JBSWY3DPEHPK3PXP', digits: 8, period: 60 },
        ],
      }),
    });
    expect(batch.data.imported).toBe(1);
    const vault = await app.jsonRequest('/api/account/totp-vault', { headers });
    expect(vault.data.items).toMatchObject([{ digits: 8, period: 60 }]);
  } finally {
    app.close();
  }
});
