import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { affiliateLedgers, orders, paymentPlugins, users } from '../../worker/db/schema/index';
import { signEpayParams } from '../../worker/domains/payment/payment.gateway';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('会员与财务口径', () => {
  let ctx: TestAppContext;
  let userId: number;
  let headers: Record<string, string>;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    const email = 'member-finance@example.com';
    const result = await ctx.jsonRequest<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'member-finance-password' }),
    });
    expect(result.ok).toBe(true);
    headers = { Authorization: `Bearer ${result.data.token}` };
    const [member] = await ctx.db.select({ id: users.id }).from(users);
    userId = member.id;
  });

  afterEach(() => ctx?.close());

  async function seedOrders() {
    const statuses = [
      'paid',
      'delivered',
      'upstream_pending',
      'fulfillment_failed',
      'pending_payment',
      'expired',
      'processing',
      'refunded',
    ];
    const today = new Date().toISOString().slice(0, 10);
    await ctx.db.insert(orders).values(
      statuses.map((status, index) => ({
        orderNo: `FIN${index}`,
        userId,
        contactEmail: 'member-finance@example.com',
        productId: 1,
        productTitle: '对账测试商品',
        unitPrice: 50,
        totalAmount: 50,
        upstreamCostTotal: 10,
        commissionAmount: 5,
        status,
        createdAt: `${today} 00:00:00`,
      }))
    );
  }

  it('[B10] 会员月消费仅包含成功实收订单', async () => {
    await seedOrders();
    const result = await ctx.jsonRequest<{ monthly_spend: number; total_orders: number }>(
      '/api/account/summary',
      { headers }
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ monthly_spend: 200, total_orders: 8 });
  });

  it('[B11] 同期财务 CSV 实付与净利合计和总览一致', async () => {
    await seedOrders();
    const admin = { headers: await ctx.adminHeaders() };
    const summary = await ctx.jsonRequest<{
      summary: { gross_gmv: number; platform_net_profit: number };
    }>('/api/admin/finance/reconciliation?days=7', admin);
    const csv = await ctx.request('/api/admin/finance/reconciliation/csv?days=7', admin);
    expect(summary.ok).toBe(true);
    expect(csv.ok).toBe(true);
    const rows = (await csv.text())
      .trim()
      .split('\r\n')
      .slice(1)
      .map((line) => line.replaceAll('"', '').split(','));
    expect(rows.reduce((sum, row) => sum + Number(row[12]), 0)).toBe(
      summary.data.summary.platform_net_profit
    );
    expect(rows.reduce((sum, row) => sum + Number(row[8]), 0)).toBe(summary.data.summary.gross_gmv);
    expect(rows).toHaveLength(8);
  });

  it('[B11] 超过旧导出上限时仍包含同期完整明细', async () => {
    for (let offset = 0; offset < 2001; offset += 10) {
      await ctx.db.insert(orders).values(
        Array.from({ length: Math.min(10, 2001 - offset) }, (_, index) => ({
          orderNo: `EXPORT${offset + index}`,
          userId,
          contactEmail: 'member-finance@example.com',
          productId: 1,
          productTitle: '=公式样例',
          unitPrice: 1,
          totalAmount: 1,
          status: 'paid',
        }))
      );
    }
    const csv = await ctx.request('/api/admin/finance/reconciliation/csv?days=7', {
      headers: await ctx.adminHeaders(),
    });
    expect(csv.ok).toBe(true);
    const lines = (await csv.text()).split('\r\n');
    expect(lines).toHaveLength(2002);
    expect(lines.at(-1)).toContain('"EXPORT0"');
    expect(lines.at(-1)).toContain('"\'=公式样例"');
  });

  it('[B23] 累计返佣跨过 50 条明细分页并排除已冲正返佣', async () => {
    const records = Array.from({ length: 61 }, (_, index) => ({
      referrerUserId: userId,
      buyerUserId: userId + 1,
      orderNo: `AFF${index}`,
      orderAmount: 100,
      commissionRate: 0.1,
      rewardAmount: 10,
      status: index === 59 ? 'clawed_back' : 'settled',
    }));
    for (let i = 0; i < records.length; i += 10) {
      await ctx.db.insert(affiliateLedgers).values(records.slice(i, i + 10));
    }
    type AffiliatePage = {
      settled_reward_total: number;
      ledgers: Array<{ id: number }>;
      ledger_next_before_id: number | null;
    };
    const first = await ctx.jsonRequest<AffiliatePage>('/api/account/affiliate', { headers });
    expect(first.ok).toBe(true);
    expect(first.data.settled_reward_total).toBe(600);
    expect(first.data.ledgers).toHaveLength(50);
    expect(first.data.ledger_next_before_id).toBe(first.data.ledgers.at(-1)?.id);
    const second = await ctx.jsonRequest<AffiliatePage>(
      `/api/account/affiliate?ledger_before_id=${first.data.ledger_next_before_id}`,
      { headers }
    );
    expect(second.ok).toBe(true);
    expect(second.data.settled_reward_total).toBe(600);
    expect(second.data.ledger_next_before_id).toBeNull();
    expect(second.data.ledgers).toHaveLength(11);
    expect(new Set([...first.data.ledgers, ...second.data.ledgers].map(({ id }) => id)).size).toBe(61);
  });

  it('[B31] 巡检区分 ¥50/¥50 平账和 ¥60/¥50 的真实账实偏差', async () => {
    const adminHeaders = await ctx.adminHeaders();
    const readCheck = async () => {
      const response = await ctx.jsonRequest<{
        integrity_checks: Array<{ key: string; passed: boolean; count: number; detail: string }>;
      }>('/api/admin/finance/reconciliation?days=7', { headers: adminHeaders });
      expect(response.ok).toBe(true);
      return response.data.integrity_checks.find((check) => check.key === 'wallet_ledger_conservation');
    };

    const balanced = await readCheck();
    expect(balanced).toMatchObject({
      passed: true,
      count: 0,
      detail: expect.stringMatching(/¥50\.00.*¥50\.00/),
    });

    await ctx.db.update(users).set({ balance: 60 }).where(eq(users.id, userId));
    const drifted = await readCheck();
    expect(drifted).toMatchObject({
      passed: false,
      count: 1,
      detail: expect.stringMatching(/¥60\.00.*¥50\.00.*¥10\.00/),
    });
  });

  it('[B18] 非沙盒会员通过签名的网关回执入账并查到最新余额', async () => {
    ctx.env.APP_ENV = 'staging';
    ctx.env.SANDBOX_MODE = 'false';
    const merchantKey = 'test-gateway-signing-key';
    const configJson = JSON.stringify({
      api_url: 'https://checkout.example.com',
      pid: 'local-test',
      key: merchantKey,
    });
    await ctx.db
      .insert(paymentPlugins)
      .values({ id: 'epay', name: '易支付', description: '回归测试', enabled: 1, configJson })
      .onConflictDoUpdate({ target: paymentPlugins.id, set: { enabled: 1, configJson } });

    const createInit = {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount: 100, payment_method: 'epay' }),
    };
    const sandbox = await ctx.jsonRequest('/api/account/recharge', createInit);
    expect(sandbox.status).toBe(404);

    const created = await ctx.jsonRequest<{
      payment_intent: { intent_no: string; status: string; pay_url: string; sandbox_simulated: boolean };
    }>('/api/account/recharge/intent', createInit);
    expect(created.ok).toBe(true);
    const intent = created.data.payment_intent;
    expect(intent).toMatchObject({ status: 'pending', sandbox_simulated: false });
    expect(new URL(intent.pay_url).hostname).toBe('checkout.example.com');

    const pollPath = `/api/payments/intents/${intent.intent_no}`;
    const pending = await ctx.jsonRequest(pollPath, { headers });
    expect(pending.data.balance).toBeUndefined();
    expect(pending.data.intent).toMatchObject({ status: 'pending', fulfill_status: 'pending' });

    const params: Record<string, string> = {
      pid: 'local-test',
      out_trade_no: intent.intent_no,
      trade_no: 'recharge-b18-fixture-receipt',
      trade_status: 'TRADE_SUCCESS',
      money: '100.00',
      sign_type: 'MD5',
    };
    params.sign = signEpayParams(params, merchantKey);
    const callback = await ctx.request(`/api/payments/webhook/epay?${new URLSearchParams(params)}`);
    expect(await callback.text()).toBe('success');

    const received = await ctx.jsonRequest(pollPath, { headers });
    expect(received.data).toMatchObject({
      balance: 150,
      intent: { status: 'paid', fulfill_status: 'done' },
    });
    const account = await ctx.jsonRequest('/api/account/summary', { headers });
    expect(account.data.balance).toBe(150);
  });
});
