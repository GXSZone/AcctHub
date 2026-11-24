import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  agentTiers,
  agentWithdrawals,
  categories,
  categoryGroups,
  commissionLedger,
  orders,
  productCards,
  products,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B8 垂直领域终局集成测试：Admin / Finance 对账与资金守恒（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let categoryId: number;
  let tierId: number;
  let adminHeaders: { Authorization: string };

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();

    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'ai', name: 'AI 专区', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'gpt', name: 'ChatGPT', sortOrder: 1 })
      .returning();
    categoryId = cat.id;

    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'partner_v4',
        name: 'V4 合伙人',
        levelRank: 4,
        minRecharge: 2000,
        discountRate: 0.7,
      })
      .returning();
    tierId = tier.id;
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 后台鉴权隔离、商品/等级防亏双向拦截、删品固化历史订单质保与级联抬升防倒挂', async () => {
    // 非管理员访问 /overview -> 403
    const unauth = await ctx.jsonRequest('/api/admin/overview');
    expect(unauth.status).toBe(403);

    // 1) 防亏拦截：最低代理 0.70 折，商品售价 ¥100、成本 ¥80 -> 折后 ¥70 < ¥80 被拒 400
    const badProd = await ctx.jsonRequest<{ code: string }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: '亏损测试商品',
        base_price: 100,
        cost_price: 80,
      }),
    });
    expect(badProd.status).toBe(400);
    expect(badProd.data.code).toBe('BELOW_COST_MARGIN');

    // 合法定价（售价 ¥150、成本 ¥80，0.70 折 = ¥105 >= ¥80）创建成功
    const okProd = await ctx.jsonRequest<{ id: number; ok: boolean }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: '正常毛利商品',
        base_price: 150,
        cost_price: 80,
        warranty_type: 'none',
        warranty_days: 0,
      }),
    });
    expect(okProd.status).toBe(200);
    const prodId = okProd.data.id;

    // 2) 等级防亏拦截：尝试把 V4 折率降到 0.50（¥150 * 0.5 = ¥75 < ¥80）-> 被拒 400
    const badTier = await ctx.jsonRequest<{ code: string }>(`/api/admin/agent-tiers/${tierId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ discount_rate: 0.5 }),
    });
    expect(badTier.status).toBe(400);
    expect(badTier.data.code).toBe('TIER_DISCOUNT_CAUSES_LOSS');

    // 3) 级联抬升防倒挂：一级代理名下有 0.75 折下级等级，主站将 V4 折率抬高到 0.80 后，下级等级自动同步抬升至 0.80
    const [agUser] = await ctx.db
      .insert(users)
      .values({ email: 'a1@example.com', displayName: 'A1', passwordHash: 'x', role: 'agent' })
      .returning();
    const [ag] = await ctx.db
      .insert(agents)
      .values({
        userId: agUser.id,
        slug: 'a1-shop',
        brandName: 'A1',
        apiKey: 'ah_agent_a1_cascade',
        tierId,
        status: 'active',
      })
      .returning();
    const [subTier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: ag.id,
        code: 'sub_75',
        name: '下级75折',
        levelRank: 1,
        minRecharge: 100,
        discountRate: 0.75,
      })
      .returning();

    const upTier = await ctx.jsonRequest(`/api/admin/agent-tiers/${tierId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ discount_rate: 0.8 }),
    });
    expect(upTier.status).toBe(200);
    const subAfter = (await ctx.db.select().from(agentTiers).where(eq(agentTiers.id, subTier.id)))[0];
    expect(subAfter.discountRate).toBe(0.8);

    // 4) 删品前固化历史订单质保快照（防止无质保商品删除后订单复活默认 30 天质保）
    await ctx.db.insert(orders).values({
      orderNo: 'ORD-WARRANTY-SNAP',
      contactEmail: 'w@example.com',
      productId: prodId,
      productTitle: '正常毛利商品',
      specId: 'default',
      specName: '标准月卡',
      quantity: 1,
      unitPrice: 150,
      totalAmount: 150,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'delivered',
      warrantyType: '',
      warrantyDays: 0,
      warrantySummary: '',
    });
    const delRes = await ctx.jsonRequest(`/api/admin/products/${prodId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(delRes.status).toBe(200);
    const ordSnap = (await ctx.db.select().from(orders).where(eq(orders.orderNo, 'ORD-WARRANTY-SNAP')))[0];
    expect(ordSnap.warrantyType).toBe('none');
    expect(ordSnap.warrantyDays).toBe(0);
  });

  it('2. [S01][B01] 标准退款隔离原卡、按实际资金冲正分润并单列应收', async () => {
    const [prod] = await ctx.db
      .insert(products)
      .values({
        categoryId,
        slug: 'csv-prod',
        title: '=CMD|calc',
        basePrice: 100,
        stockMode: 'cards',
        salesCount: 2,
        isActive: 1,
      })
      .returning();

    const [buyer] = await ctx.db
      .insert(users)
      .values({ email: 'buyer-fin@example.com', displayName: 'Buyer', passwordHash: 'x', balance: 20 })
      .returning();
    const [agentUser] = await ctx.db
      .insert(users)
      .values({
        email: 'agent-fin@example.com',
        displayName: 'Agent',
        passwordHash: 'x',
        role: 'agent',
        balance: 8,
      })
      .returning();
    await ctx.db.insert(walletTransactions).values([
      {
        userId: buyer.id,
        type: 'recharge',
        amount: 20,
        balanceAfter: 20,
        refNo: 'TEST-INIT-BUYER',
        note: '测试夹具初始余额',
      },
      {
        userId: agentUser.id,
        type: 'recharge',
        amount: 8,
        balanceAfter: 8,
        refNo: 'TEST-INIT-AGENT',
        note: '测试夹具初始余额',
      },
    ]);
    const [ag] = await ctx.db
      .insert(agents)
      .values({
        userId: agentUser.id,
        slug: 'fin-shop',
        brandName: '对账分站',
        apiKey: 'ah_agent_fin_01',
        tierId,
        totalRevenue: 200,
        totalCommission: 40,
        status: 'active',
      })
      .returning();

    // 订单 1（正常已交付，含卡密）
    await ctx.db.insert(orders).values([
      {
        orderNo: 'ORD-FIN-KEEP',
        userId: buyer.id,
        agentId: ag.id,
        tenantSlug: ag.slug,
        contactEmail: buyer.email,
        productId: prod.id,
        productTitle: '=CMD|calc',
        specId: 'default',
        specName: '标准版',
        quantity: 1,
        unitPrice: 100,
        totalAmount: 100,
        upstreamCostTotal: 50,
        commissionAmount: 20,
        paymentMethod: 'balance',
        channel: 'web',
        status: 'delivered',
      },
      {
        orderNo: 'ORD-FIN-REFUND',
        userId: buyer.id,
        agentId: ag.id,
        tenantSlug: ag.slug,
        contactEmail: buyer.email,
        productId: prod.id,
        productTitle: '=CMD|calc',
        specId: 'default',
        specName: '标准版',
        quantity: 1,
        unitPrice: 100,
        totalAmount: 100,
        commissionAmount: 20,
        paymentMethod: 'balance',
        channel: 'web',
        status: 'delivered',
      },
    ]);
    await ctx.db.insert(productCards).values({
      productId: prod.id,
      specId: 'default',
      cardContent: 'RESTOCK-CARD-001',
      status: 'sold',
      orderNo: 'ORD-FIN-REFUND',
    });
    await ctx.db.insert(commissionLedger).values({
      orderNo: 'ORD-FIN-REFUND',
      beneficiaryAgentId: ag.id,
      sourceAgentId: ag.id,
      hopDistance: 0,
      rewardType: 'direct_sale',
      amount: 20,
      note: '分润',
    });

    // 过去的回库请求也必须隔离原卡。
    const refRes = await ctx.jsonRequest<{ ok: boolean; restocked: boolean }>(
      '/api/admin/orders/ORD-FIN-REFUND/refund',
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({ restock: true }) }
    );
    expect(refRes.status).toBe(200);
    expect(refRes.data.restocked).toBe(false);

    // 重复退款必须被 CAS 拦截返回 409
    const dupRef = await ctx.jsonRequest('/api/admin/orders/ORD-FIN-REFUND/refund', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ restock: true }),
    });
    expect(dupRef.status).toBe(409);

    // 实际扣回 8，差额 12 为应收，原卡继续绑定原订单。
    const buyerAfter = (await ctx.db.select().from(users).where(eq(users.id, buyer.id)))[0];
    const agentAfter = (await ctx.db.select().from(users).where(eq(users.id, agentUser.id)))[0];
    const cardAfter = (
      await ctx.db.select().from(productCards).where(eq(productCards.productId, prod.id))
    )[0];
    expect(buyerAfter.balance).toBe(120);
    expect(agentAfter.balance).toBe(0);
    expect(cardAfter.status).toBe('quarantined');
    expect(cardAfter.orderNo).toBe('ORD-FIN-REFUND');
    expect(
      await ctx.d1
        .prepare(
          'SELECT recovered_amount, receivable_amount FROM refund_commission_recoveries WHERE order_no = ?'
        )
        .bind('ORD-FIN-REFUND')
        .first()
    ).toEqual({ recovered_amount: 8, receivable_amount: 12 });
    expect(
      await ctx.d1
        .prepare('SELECT amount FROM wallet_transactions WHERE user_id = ? AND ref_no = ?')
        .bind(agentUser.id, 'ORD-FIN-REFUND')
        .first<number>('amount')
    ).toBe(-8);

    // 提现审核驳回自动退回已冻结金额。
    const [wd] = await ctx.db
      .insert(agentWithdrawals)
      .values({
        agentId: ag.id,
        userId: agentUser.id,
        amount: 50,
        channel: 'alipay',
        accountInfo: 'ag@alipay.com',
        status: 'pending',
      })
      .returning();
    const rejWd = await ctx.jsonRequest<{ ok: boolean; status: string }>(`/api/admin/withdrawals/${wd.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ action: 'rejected', admin_note: '账号有误' }),
    });
    expect(rejWd.status).toBe(200);
    const agentAfterWd = (await ctx.db.select().from(users).where(eq(users.id, agentUser.id)))[0];
    expect(agentAfterWd.balance).toBe(50);

    // 财务对账总览：1 笔有效订单 GMV=100, 上游成本=50, 分润=20 -> 净利=30，且 4 项资金守恒巡检全通过
    const recon = await ctx.jsonRequest<{
      summary: { gross_gmv: number; platform_net_profit: number; refunded_orders: number };
      integrity_checks: Array<{ key: string; passed: boolean }>;
    }>('/api/admin/finance/reconciliation?days=30', { headers: adminHeaders });
    expect(recon.status).toBe(200);
    expect(recon.data.summary.gross_gmv).toBe(100);
    expect(recon.data.summary.platform_net_profit).toBe(30);
    expect(recon.data.summary.refunded_orders).toBe(1);
    expect(recon.data.integrity_checks.filter((c) => !c.passed).map((c) => c.key)).toEqual([]);

    // CSV 导出：含 UTF-8 BOM 且对 "=CMD|calc" 自动前置单引号防 Excel 公式注入
    const csvResp = await ctx.request('/api/admin/finance/reconciliation/csv?days=30', {
      headers: adminHeaders,
    });
    expect(csvResp.status).toBe(200);
    // Response.prototype.text() 会按 Fetch 标准自动剥离 UTF-8 BOM，因此通过原始字节校验前导 BOM
    const csvBytes = new Uint8Array(await csvResp.arrayBuffer());
    expect(Array.from(csvBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder('utf-8').decode(csvBytes);
    expect(csvText).toContain(`"'=CMD|calc"`);

    // 总控概览接口正常返回完整结构
    const ov = await ctx.jsonRequest<{ stats: { total_orders: number } }>('/api/admin/overview', {
      headers: adminHeaders,
    });
    expect(ov.status).toBe(200);
    expect(ov.data.stats.total_orders).toBe(2);
  });
});
