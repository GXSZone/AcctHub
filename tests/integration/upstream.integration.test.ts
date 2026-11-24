import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  agentTiers,
  categories,
  categoryGroups,
  commissionLedger,
  orders,
  productCards,
  products,
  productUpstreamBindings,
  supportTickets,
  upstreamOrders,
  users,
} from '../../worker/db/schema/index';
import {
  executeUpstreamProcurement,
  finalizeOrderDeliveryWithCards,
} from '../../worker/domains/upstream/upstream.fulfillment.service';
import { signUpstreamParams } from '../../worker/domains/upstream/upstream.signer';
import { readDeliveryPayload } from '../../worker/infra/credential-storage';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B6 垂直领域集成测试：Upstream 货源对接、同步、履约故障转移与异常恢复（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let categoryId: number;
  let productId: number;
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
      .values({ groupId: grp.id, slug: 'claude', name: 'Claude', sortOrder: 1 })
      .returning();
    categoryId = cat.id;

    const [prod] = await ctx.db
      .insert(products)
      .values({
        categoryId: cat.id,
        slug: 'claude-direct',
        title: 'Claude Pro 直采版',
        basePrice: 180,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: '1m', name: '单月独享', price: 180 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await ctx.db.insert(agentTiers).values({
      ownerAgentId: 0,
      code: 'v4_partner',
      name: 'V4 战略合伙人',
      levelRank: 4,
      minRecharge: 5000,
      discountRate: 0.72,
    });
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 上游源创建密钥脱敏、目录同步关键词过滤与多规格采集落库（含防亏底价兜底）', async () => {
    // 非管理员访问被拒 403
    const unauth = await ctx.jsonRequest('/api/admin/upstreams');
    expect(unauth.status).toBe(403);

    // 创建沙盒上游源（含排除关键词「内部禁用」）
    const createRes = await ctx.jsonRequest<{ id: number; ok: boolean }>('/api/admin/upstreams', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: '沙盒测试上游',
        adapter_type: 'mock_sandbox',
        webhook_secret: 'wh_secret_very_sensitive_12345',
        default_category_id: categoryId,
        filter_rules: { exclude_keywords: ['内部禁用'] },
        pricing_rules: { markup_percent: 10, rounding: 'none' },
      }),
    });
    expect(createRes.status).toBe(200);
    const sourceId = createRes.data.id;

    // 列表返回必须严格脱敏，绝不泄露明文 webhook_secret
    const overview = await ctx.jsonRequest<{
      sources: Array<Record<string, unknown>>;
    }>('/api/admin/upstreams', { headers: adminHeaders });
    expect(overview.status).toBe(200);
    const src = overview.data.sources[0];
    expect(src.has_webhook_secret).toBe(true);
    expect(src.webhook_secret_enc).toBeUndefined();
    expect(JSON.stringify(src)).not.toContain('wh_secret_very_sensitive_12345');

    // 执行立即同步：6 条沙盒商品中「内部禁用」自动标记 ignored，其余 pending
    const syncRes = await ctx.jsonRequest<{ ok: boolean; fetched_count: number; skipped_count: number }>(
      `/api/admin/upstreams/${sourceId}/sync`,
      { method: 'POST', headers: adminHeaders }
    );
    expect(syncRes.status).toBe(200);
    expect(syncRes.data.fetched_count).toBe(6);
    expect(syncRes.data.skipped_count).toBe(1);

    // 查看商品列表并采集多规格商品 UP-CLAUDE-PRO-MULTI
    const itemsRes = await ctx.jsonRequest<{
      items: Array<{ id: number; upstream_item_id: string; collect_status: string }>;
    }>(`/api/admin/upstreams/${sourceId}/items`, { headers: adminHeaders });
    const multiItem = itemsRes.data.items.find((i) => i.upstream_item_id === 'UP-CLAUDE-PRO-MULTI');
    const bannedItem = itemsRes.data.items.find((i) => i.upstream_item_id === 'UP-INTERNAL-TEST-99');
    expect(multiItem?.collect_status).toBe('pending');
    expect(bannedItem?.collect_status).toBe('ignored');

    const collectRes = await ctx.jsonRequest<{ ok: boolean; local_product_id: number }>(
      `/api/admin/upstreams/items/${multiItem?.id}`,
      {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ action: 'collect', fulfillment_mode: 'upstream_only' }),
      }
    );
    expect(collectRes.status).toBe(200);
    const localProdId = collectRes.data.local_product_id;

    // 校验防亏底价兜底：上游成本 112，即便加价率仅 10%（123.2），但 V4 最低代理 0.72 折，
    // 所以本地售价必须 >= ceil(112 / 0.72 * 100) / 100 = 155.56！
    const localProd = (await ctx.db.select().from(products).where(eq(products.id, localProdId)))[0];
    expect(localProd.basePrice).toBeGreaterThanOrEqual(155.56);

    // 校验自动生成 2 条多规格 SKU 路由绑定
    const bindings = await ctx.db
      .select()
      .from(productUpstreamBindings)
      .where(eq(productUpstreamBindings.productId, localProdId));
    expect(bindings).toHaveLength(2);
  });

  it('2. 多源故障转移、异步锁单防双采、Webhook 强制验签与主动查单交付闭环', async () => {
    // 源 A（priority=1, always_fail） + 源 B（priority=2, normal）
    const sA = await ctx.jsonRequest<{ id: number }>('/api/admin/upstreams', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: '故障主源A', adapter_type: 'mock_sandbox', sandbox_mode: 'always_fail' }),
    });
    const sB = await ctx.jsonRequest<{ id: number }>('/api/admin/upstreams', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: '正常备源B', adapter_type: 'mock_sandbox', sandbox_mode: 'normal' }),
    });

    await ctx.jsonRequest('/api/admin/upstreams/bindings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: '1m',
        source_id: sA.data.id,
        upstream_item_id: 'SKU-A',
        priority: 1,
        cached_cost: 90,
        cached_stock: 10,
      }),
    });
    await ctx.jsonRequest('/api/admin/upstreams/bindings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: '1m',
        source_id: sB.data.id,
        upstream_item_id: 'SKU-B',
        priority: 2,
        cached_cost: 95,
        cached_stock: 10,
      }),
    });

    // 明确失败时自动切源到源 B 出卡
    await ctx.db.insert(orders).values({
      orderNo: 'ORD-FAILOVER-1',
      contactEmail: 'buyer@example.com',
      productId,
      productTitle: 'Claude Pro 直采版',
      specId: '1m',
      quantity: 1,
      unitPrice: 180,
      totalAmount: 180,
      paymentMethod: 'balance',
      status: 'processing',
    });
    const failOver = await executeUpstreamProcurement(ctx.env, {
      localOrderNo: 'ORD-FAILOVER-1',
      productId,
      specId: '1m',
      quantity: 1,
      contactEmail: 'buyer@example.com',
      originUrl: 'https://test.local',
    });
    expect(failOver.status).toBe('delivered');
    expect(failOver.upstreamSourceId).toBe(sB.data.id);
    expect(failOver.cards).toHaveLength(1);

    // 异步源 C（always_async，priority=0）测试 Webhook 验签与交付
    const whSecret = 'up_wh_key_2026';
    const sC = await ctx.jsonRequest<{ id: number }>('/api/admin/upstreams', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: '异步源C',
        adapter_type: 'mock_sandbox',
        sandbox_mode: 'always_async',
        webhook_secret: whSecret,
      }),
    });
    await ctx.jsonRequest('/api/admin/upstreams/bindings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: '1m',
        source_id: sC.data.id,
        upstream_item_id: 'SKU-C',
        priority: 0,
        cached_cost: 88,
        cached_stock: 10,
      }),
    });

    await ctx.db.insert(orders).values({
      orderNo: 'ORD-ASYNC-1',
      contactEmail: 'async@example.com',
      productId,
      productTitle: 'Claude Pro 直采版',
      specId: '1m',
      specName: '单月独享',
      quantity: 1,
      unitPrice: 180,
      totalAmount: 180,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'upstream_pending',
    });

    const asyncOutcome = await executeUpstreamProcurement(ctx.env, {
      localOrderNo: 'ORD-ASYNC-1',
      productId,
      specId: '1m',
      quantity: 1,
      contactEmail: 'async@example.com',
      originUrl: 'https://test.local',
    });
    // 异步态严禁切源，直接锁定 upstream_pending
    expect(asyncOutcome.status).toBe('upstream_pending');
    expect(asyncOutcome.upstreamSourceId).toBe(sC.data.id);

    // 错误签名 Webhook 必须返回 401
    const badWh = await ctx.jsonRequest(`/api/webhooks/upstream/${sC.data.id}`, {
      method: 'POST',
      body: JSON.stringify({
        out_trade_no: 'ORD-ASYNC-1-A1',
        status: 'succeeded',
        cards: ['FAKE-CARD'],
        sign: 'deadbeef',
      }),
    });
    expect(badWh.status).toBe(401);

    // 合法签名 Webhook 自动完结交付
    const whPayload: Record<string, unknown> = {
      out_trade_no: 'ORD-ASYNC-1-A1',
      trade_no: asyncOutcome.upstreamOrderNo,
      status: 'succeeded',
      cards: ['REAL-WEBHOOK-CARD-001'],
      cost: 88,
    };
    whPayload.sign = await signUpstreamParams('hmac_sha256', whPayload, whSecret);
    const okWh = await ctx.jsonRequest<{ ok: boolean; status: string }>(
      `/api/webhooks/upstream/${sC.data.id}`,
      { method: 'POST', body: JSON.stringify(whPayload) }
    );
    expect(okWh.status).toBe(200);
    expect(okWh.data.status).toBe('delivered');

    const deliveredOrder = (await ctx.db.select().from(orders).where(eq(orders.orderNo, 'ORD-ASYNC-1')))[0];
    expect(deliveredOrder.status).toBe('delivered');
    expect(
      await readDeliveryPayload(ctx.env, deliveredOrder.orderNo, deliveredOrder.deliveredPayload)
    ).toContain('REAL-WEBHOOK-CARD-001');
  });

  it('3. 预拉囤货入库、异常订单 CAS 退款冲正多级分润与售后工单换新及删源清理', async () => {
    const srcRes = await ctx.jsonRequest<{ id: number }>('/api/admin/upstreams', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: '囤货与换新源', adapter_type: 'mock_sandbox', sandbox_mode: 'normal' }),
    });
    const sourceId = srcRes.data.id;

    const bindRes = await ctx.jsonRequest<{ id: number }>('/api/admin/upstreams/bindings', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: '1m',
        source_id: sourceId,
        upstream_item_id: 'SKU-PULL',
        cached_cost: 80,
        cached_stock: 20,
      }),
    });

    // 1) 模拟货源不能把演示卡密写入真实库存。
    const pullRes = await ctx.jsonRequest(`/api/admin/upstreams/bindings/${bindRes.data.id}/pull-cards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ quantity: 3 }),
    });
    expect(pullRes.status).toBe(400);
    const localCards = await ctx.db.select().from(productCards).where(eq(productCards.productId, productId));
    expect(localCards).toHaveLength(0);

    // 2) 异常失败订单 CAS 退款至买家余额 + 完整冲正代理分润 + 严防迟到 Webhook 覆盖已退款订单
    const [buyer] = await ctx.db
      .insert(users)
      .values({ email: 'refund-buyer@example.com', displayName: '买家测试', passwordHash: 'x', balance: 10 })
      .returning();
    const [agentUser] = await ctx.db
      .insert(users)
      .values({
        email: 'refund-agent@example.com',
        displayName: '代理测试',
        passwordHash: 'x',
        role: 'agent',
        balance: 50,
      })
      .returning();
    const [agent] = await ctx.db
      .insert(agents)
      .values({
        userId: agentUser.id,
        slug: 'refund-shop',
        brandName: '冲正分站',
        apiKey: 'ah_agent_ref_1',
        totalRevenue: 180,
        totalCommission: 30,
        status: 'active',
      })
      .returning();

    await ctx.db.insert(orders).values({
      orderNo: 'ORD-FAIL-REFUND',
      userId: buyer.id,
      agentId: agent.id,
      tenantSlug: agent.slug,
      contactEmail: buyer.email,
      productId,
      productTitle: 'Claude Pro 直采版',
      specId: '1m',
      specName: '单月独享',
      quantity: 1,
      unitPrice: 180,
      totalAmount: 180,
      commissionAmount: 30,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'fulfillment_failed',
    });
    await ctx.db.insert(commissionLedger).values({
      orderNo: 'ORD-FAIL-REFUND',
      beneficiaryAgentId: agent.id,
      sourceAgentId: agent.id,
      hopDistance: 0,
      rewardType: 'direct_sale',
      amount: 30,
      note: '测试分润',
    });

    const ref1 = await ctx.jsonRequest<{ ok: boolean; refundedToWallet: boolean; amount: number }>(
      '/api/admin/upstreams/local-orders/ORD-FAIL-REFUND/refund-balance',
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({ note: '上游缺货退款' }) }
    );
    expect(ref1.status).toBe(200);
    expect(ref1.data.refundedToWallet).toBe(true);
    expect(ref1.data.amount).toBe(180);

    // 二次退款必须被拒 400
    const ref2 = await ctx.jsonRequest('/api/admin/upstreams/local-orders/ORD-FAIL-REFUND/refund-balance', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({}),
    });
    expect(ref2.status).toBe(400);

    // 验证买家余额 10+180=190，代理余额 50-30=20，代理总佣金归 0
    const buyerAfter = (await ctx.db.select().from(users).where(eq(users.id, buyer.id)))[0];
    const agentUserAfter = (await ctx.db.select().from(users).where(eq(users.id, agentUser.id)))[0];
    expect(buyerAfter.balance).toBe(190);
    expect(agentUserAfter.balance).toBe(20);

    // 迟到回调绝对禁止覆盖已退款订单
    const lateFinalize = await finalizeOrderDeliveryWithCards(ctx.env, {
      localOrderNo: 'ORD-FAIL-REFUND',
      cards: ['LATE-CARD'],
    });
    expect(lateFinalize.ok).toBe(false);

    // 3) 售后工单向上游一键补采换新
    await ctx.db.insert(orders).values({
      orderNo: 'ORD-REPLACE-1',
      contactEmail: 'vip@example.com',
      productId,
      productTitle: 'Claude Pro 直采版',
      specId: '1m',
      specName: '单月独享',
      quantity: 1,
      unitPrice: 180,
      totalAmount: 180,
      paymentMethod: 'balance',
      channel: 'web',
      status: 'delivered',
      deliveredPayload: 'OLD-BROKEN-CARD',
    });
    const [tk] = await ctx.db
      .insert(supportTickets)
      .values({
        ticketNo: 'TK-UP-001',
        siteAgentId: 0,
        contactEmail: 'vip@example.com',
        orderNo: 'ORD-REPLACE-1',
        subject: '账号掉订阅求换新',
        status: 'open',
      })
      .returning();

    const repRes = await ctx.jsonRequest<{ ok: boolean; cards: string[] }>(
      `/api/admin/upstreams/tickets/${tk.id}/replace-via-upstream`,
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({ quantity: 1 }) }
    );
    expect(repRes.status).toBe(200);
    expect(repRes.data.cards).toHaveLength(1);

    const tkAfter = (await ctx.db.select().from(supportTickets).where(eq(supportTickets.id, tk.id)))[0];
    expect(tkAfter.status).toBe('resolved');

    // 4) 删除上游源时，自动终止残留的 pending 上游采购单防阻塞 Cron 队头
    await ctx.db.insert(upstreamOrders).values({
      localOrderNo: 'ORD-ORPHAN',
      attemptNo: 1,
      idempotencyOutTradeNo: 'ORD-ORPHAN-A1',
      sourceId,
      sourceName: '囤货与换新源',
      status: 'pending',
    });
    const delRes = await ctx.jsonRequest(`/api/admin/upstreams/${sourceId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(delRes.status).toBe(200);
    const orphanAfter = (
      await ctx.db
        .select()
        .from(upstreamOrders)
        .where(eq(upstreamOrders.idempotencyOutTradeNo, 'ORD-ORPHAN-A1'))
    )[0];
    expect(orphanAfter.status).toBe('failed');
  });
});
