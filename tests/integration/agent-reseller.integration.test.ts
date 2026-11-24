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
  supportTickets,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { settleRecursiveOrderProfits } from '../../worker/domains/agent/settlement.service';
import { sha256Hex } from '../../worker/infra/crypto';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B5 垂直领域集成测试：Agent / Reseller B2B API / Settlement（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let productId: number;
  let l1TierId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();

    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'ai', name: 'AI 专区', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'claude', name: 'Claude', sortOrder: 1 })
      .returning();

    const [prod] = await ctx.db
      .insert(products)
      .values({
        categoryId: cat.id,
        slug: 'claude-pro',
        title: 'Claude Pro 独享号',
        basePrice: 100,
        stockMode: 'cards',
        specsJson: JSON.stringify([
          { id: 'month', name: '单月版', price: 100 },
          { id: 'quarter', name: '季卡版', price: 280 },
        ]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await ctx.db.insert(productCards).values([
      { productId: prod.id, specId: 'month', cardContent: 'CLAUDE-M-001', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'CLAUDE-M-002', status: 'available' },
      { productId: prod.id, specId: 'quarter', cardContent: 'CLAUDE-Q-001', status: 'available' },
    ]);

    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'gold_l1',
        name: '总代 L1',
        levelRank: 2,
        minRecharge: 200,
        discountRate: 0.7,
      })
      .returning();
    l1TierId = tier.id;
  });

  afterEach(() => {
    ctx.close();
  });

  async function registerUser(email: string, balance = 0, tenantSlug?: string) {
    const path = tenantSlug ? `http://${tenantSlug}.localhost/api/auth/register` : '/api/auth/register';
    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>(path, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password123!' }),
    });
    if (balance > 0) {
      await ctx.db.update(users).set({ balance }).where(eq(users.id, reg.data.user.id));
    }
    return { token: reg.data.token, userId: reg.data.user.id };
  }

  it('1. 代理开通校验余额不足，充值后开通 L1 并招募 L2 时直属上级实时获得开户费', async () => {
    const u1 = await registerUser('l1@example.com', 50);

    // 余额 ¥50 < ¥200 -> 402
    const failOpen = await ctx.jsonRequest('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ target_tier_id: l1TierId, payment_method: 'balance' }),
    });
    expect(failOpen.status).toBe(402);

    // 加款至 ¥300 后开通 L1 代理
    await ctx.db.update(users).set({ balance: 300 }).where(eq(users.id, u1.userId));
    const okOpen = await ctx.jsonRequest<{
      ok: boolean;
      balance: number;
      auto_created_agent: boolean;
      agent: { id: number; slug: string; api_key: string };
    }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ target_tier_id: l1TierId, payment_method: 'balance' }),
    });
    expect(okOpen.status).toBe(200);
    expect(okOpen.headers.get('Cache-Control')).toBe('no-store');
    expect(okOpen.data.ok).toBe(true);
    expect(okOpen.data.auto_created_agent).toBe(true);
    expect(okOpen.data.balance).toBe(100);
    const l1Agent = okOpen.data.agent;

    const workbench = await ctx.jsonRequest('/api/agent/me', {
      headers: { Authorization: `Bearer ${u1.token}` },
    });
    expect(workbench.status).toBe(200);
    expect(workbench.headers.get('Cache-Control')).toBe('no-store');

    // L1 在自己分站域名下自定义一个 ¥120、0.80 折的下级等级
    const createSubTier = await ctx.jsonRequest<{ ok: boolean; id: number }>(
      `http://${l1Agent.slug}.localhost/api/agent/my-tiers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({
          code: 'sub_l2',
          name: '二级合伙人',
          min_recharge: 120,
          discount_rate: 0.8,
        }),
      }
    );
    expect(createSubTier.status).toBe(201);

    // 用户 B 在 L1 分站域名下注册并开通 L2 代理
    const u2 = await registerUser('l2@example.com', 200, l1Agent.slug);
    const openL2 = await ctx.jsonRequest<{
      ok: boolean;
      agent: { id: number; parent_agent_id: number };
      parent_settlement: { parentIncome: number; platformCut: number; platformFeePct: number };
    }>(`http://${l1Agent.slug}.localhost/api/agent/recharge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u2.token}` },
      body: JSON.stringify({ target_tier_id: createSubTier.data.id, payment_method: 'balance' }),
    });
    expect(openL2.status).toBe(200);
    expect(openL2.data.agent.parent_agent_id).toBe(l1Agent.id);
    expect(openL2.data.parent_settlement.parentIncome).toBe(120);

    // 验证 L1 钱包从 ¥100 实时入账至 ¥220，且写入 tier_upgrade 流水
    const l1User = (await ctx.db.select().from(users).where(eq(users.id, u1.userId)))[0];
    expect(l1User.balance).toBe(220);
    const txs = await ctx.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, u1.userId));
    expect(txs.some((t) => t.type === 'commission' && t.amount === 120)).toBe(true);
  });

  it('2. 防亏底价拦截、多规格定制价底价校验、提现 CAS 原子冻结与分站工单转交总控', async () => {
    const u1 = await registerUser('boss@example.com', 500);
    const openRes = await ctx.jsonRequest<{ agent: { id: number; slug: string } }>('/api/agent/recharge', {
      method: 'POST',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ target_tier_id: l1TierId, payment_method: 'balance' }),
    });
    expect(openRes.status).toBe(200);
    const agentId = openRes.data.agent.id;
    const bossOrigin = `http://${openRes.data.agent.slug}.localhost`;

    // 防亏拦截：L1 拿货 0.70 折，尝试设 0.65 折下级等级 -> 400
    const badTier = await ctx.jsonRequest(`${bossOrigin}/api/agent/my-tiers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ name: '倒贴等级', min_recharge: 100, discount_rate: 0.65 }),
    });
    expect(badTier.status).toBe(400);

    // 多规格禁止 default 定价 -> 400
    const badSpecDefault = await ctx.jsonRequest(`${bossOrigin}/api/agent/pricing`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ product_id: productId, spec_id: 'default', custom_price: 90 }),
    });
    expect(badSpecDefault.status).toBe(400);

    // 低于拿货底价（¥100 * 0.70 = ¥70） -> 400
    const belowFloor = await ctx.jsonRequest(`${bossOrigin}/api/agent/pricing`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ product_id: productId, spec_id: 'month', custom_price: 65 }),
    });
    expect(belowFloor.status).toBe(400);

    // 合法定制价 ¥115 成功
    const okPrice = await ctx.jsonRequest<{ ok: boolean; custom_price: number }>(
      `${bossOrigin}/api/agent/pricing`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({ product_id: productId, spec_id: 'month', custom_price: 115 }),
      }
    );
    expect(okPrice.status).toBe(200);
    expect(okPrice.data.custom_price).toBe(115);

    // 单品分站下架覆写成功
    const hideProd = await ctx.jsonRequest<{ ok: boolean; is_listed: boolean }>(
      `${bossOrigin}/api/agent/products/${productId}/override`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({ is_listed: false, custom_title: '定制版 Claude' }),
      }
    );
    expect(hideProd.status).toBe(200);
    expect(hideProd.data.is_listed).toBe(false);

    // 提现 CAS 原子冻结：余额 ¥300，申请 ¥500 被拒，申请 ¥150 成功并扣至 ¥150
    const badWd = await ctx.jsonRequest(`${bossOrigin}/api/agent/withdrawals`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${u1.token}` },
      body: JSON.stringify({ amount: 500, channel: 'alipay', account_info: 'boss@alipay.com' }),
    });
    expect(badWd.status).toBe(400);

    const okWd = await ctx.jsonRequest<{ ok: boolean; balance: number }>(
      `${bossOrigin}/api/agent/withdrawals`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({ amount: 150, channel: 'alipay', account_info: 'boss@alipay.com' }),
      }
    );
    expect(okWd.status).toBe(201);
    expect(okWd.data.balance).toBe(150);

    // 分站工单回复与一键转交平台总控
    const [tk] = await ctx.db
      .insert(supportTickets)
      .values({
        ticketNo: 'TK-B5-001',
        siteAgentId: agentId,
        contactEmail: 'cust@example.com',
        category: 'delivery',
        subject: '收不到卡密',
        status: 'open',
      })
      .returning();

    const replyRes = await ctx.jsonRequest<{ ok: boolean; status: string }>(
      `${bossOrigin}/api/agent/tickets/${tk.id}/reply`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({ content: '您好，请检查垃圾邮件箱' }),
      }
    );
    expect(replyRes.status).toBe(200);
    expect(replyRes.data.status).toBe('agent_replied');

    const escRes = await ctx.jsonRequest<{ ok: boolean; status: string }>(
      `${bossOrigin}/api/agent/tickets/${tk.id}/escalate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${u1.token}` },
        body: JSON.stringify({ note: '需平台核验卡密状态' }),
      }
    );
    expect(escRes.status).toBe(200);
    expect(escRes.data.status).toBe('escalated');
  });

  it('3. 三级供应链递归分润与封禁中间节点防越级吞并（资金守恒红线）', async () => {
    const u1 = await registerUser('chain1@example.com', 0);
    const u2 = await registerUser('chain2@example.com', 0);
    const u3 = await registerUser('chain3@example.com', 0);

    const [a1] = await ctx.db
      .insert(agents)
      .values({
        userId: u1.userId,
        parentAgentId: null,
        slug: 'chain-l1',
        brandName: 'L1 总代',
        apiKey: 'ah_agent_chain_l1',
        tierId: l1TierId,
        status: 'active',
      })
      .returning();

    const [t2] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: a1.id,
        code: 'c_l2',
        name: 'L2',
        levelRank: 1,
        minRecharge: 100,
        discountRate: 0.8,
      })
      .returning();

    const [a2] = await ctx.db
      .insert(agents)
      .values({
        userId: u2.userId,
        parentAgentId: a1.id,
        slug: 'chain-l2',
        brandName: 'L2 代理',
        apiKey: 'ah_agent_chain_l2',
        tierId: t2.id,
        status: 'active',
      })
      .returning();

    const [t3] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: a2.id,
        code: 'c_l3',
        name: 'L3',
        levelRank: 1,
        minRecharge: 50,
        discountRate: 0.9,
      })
      .returning();

    const [a3] = await ctx.db
      .insert(agents)
      .values({
        userId: u3.userId,
        parentAgentId: a2.id,
        slug: 'chain-l3',
        brandName: 'L3 代理',
        apiKey: 'ah_agent_chain_l3',
        tierId: t3.id,
        status: 'active',
      })
      .returning();

    await ctx.db.insert(orders).values(
      ['ORD-CHAIN-1', 'ORD-CHAIN-2'].map((orderNo) => ({
        orderNo,
        agentId: a3.id,
        contactEmail: 'chain-buyer@example.test',
        productId,
        productTitle: '分润测试商品',
        unitPrice: 100,
        totalAmount: 120,
        status: 'processing',
      }))
    );

    // 场景 A：全链活跃，L3 按 ¥120 售出原价 ¥100 商品 -> L3=30, L2=10, L1=10
    const s1 = await settleRecursiveOrderProfits({
      env: ctx.env,
      orderNo: 'ORD-CHAIN-1',
      sellingAgentId: a3.id,
      baseMainTotal: 100,
      totalAmount: 120,
      mode: 'retail',
    });
    expect(s1.sellerProfit).toBe(30);
    expect(s1.totalSettledToChain).toBe(50);
    const ledgers1 = await ctx.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.orderNo, 'ORD-CHAIN-1'));
    expect(ledgers1.map((e) => [e.beneficiaryAgentId, e.amount])).toEqual([
      [a3.id, 30],
      [a2.id, 10],
      [a1.id, 10],
    ]);

    // 场景 B：封禁中间节点 L2，L3 再次以 ¥120 出单 -> L3=30, L2 被冻结=0, L1 仅得自己合法的 10（绝不可越级吞并 L2 的 10）
    await ctx.db.update(agents).set({ status: 'suspended' }).where(eq(agents.id, a2.id));
    const s2 = await settleRecursiveOrderProfits({
      env: ctx.env,
      orderNo: 'ORD-CHAIN-2',
      sellingAgentId: a3.id,
      baseMainTotal: 100,
      totalAmount: 120,
      mode: 'retail',
    });
    expect(s2.sellerProfit).toBe(30);
    expect(s2.totalSettledToChain).toBe(40);

    const ledgers2 = await ctx.db
      .select()
      .from(commissionLedger)
      .where(eq(commissionLedger.orderNo, 'ORD-CHAIN-2'));
    expect(ledgers2.map((e) => [e.beneficiaryAgentId, e.amount])).toEqual([
      [a3.id, 30],
      [a1.id, 10],
    ]);
  });

  it('4. B2B Open API（IP 白名单拦截、商品/兼容目录、批采出卡幂等与缺货自动退款）', async () => {
    const u1 = await registerUser('b2b-parent@example.com', 500);
    const [parentAgent] = await ctx.db
      .insert(agents)
      .values({
        userId: u1.userId,
        slug: 'b2b-parent',
        brandName: '批发总代',
        apiKey: 'ah_agent_parent_key',
        apiKeyHash: await sha256Hex('ah_agent_parent_key'),
        tierId: l1TierId,
        status: 'active',
      })
      .returning();

    const [childTier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: parentAgent.id,
        code: 'b2b_child',
        name: 'API 分销',
        levelRank: 1,
        minRecharge: 50,
        discountRate: 0.85,
      })
      .returning();

    const u2 = await registerUser('b2b-child@example.com', 200);
    await ctx.db.insert(agents).values({
      userId: u2.userId,
      parentAgentId: parentAgent.id,
      slug: 'b2b-child',
      brandName: '下游发卡站',
      apiKey: 'child-agent-label',
      apiKeyHash: await sha256Hex('ah_agent_child_key_999'),
      apiIpWhitelist: '1.2.3.4',
      tierId: childTier.id,
      status: 'active',
    });

    // 1) 无 Key -> 401
    const noKey = await ctx.jsonRequest('/api/v1/reseller/balance');
    expect(noKey.status).toBe(401);

    // 2) 非白名单 IP -> 403
    const blockedIp = await ctx.jsonRequest('/api/v1/reseller/balance', {
      headers: {
        Authorization: 'Bearer ah_agent_child_key_999',
        'CF-Connecting-IP': '9.9.9.9',
      },
    });
    expect(blockedIp.status).toBe(403);

    // 3) 白名单 IP 放行：查询余额、目录与异次元兼容目录
    const headers = {
      'X-API-Key': 'ah_agent_child_key_999',
      'CF-Connecting-IP': '1.2.3.4',
    };
    const bal = await ctx.jsonRequest<{ balance: number; tier_discount_rate: number }>(
      '/api/v1/reseller/balance',
      { headers }
    );
    expect(bal.status).toBe(200);
    expect(bal.headers.get('Cache-Control')).toBe('no-store');
    expect(bal.data.balance).toBe(200);
    expect(bal.data.tier_discount_rate).toBe(0.85);

    const productList = await ctx.jsonRequest('/api/v1/reseller/products', { headers });
    expect(productList.status).toBe(200);
    expect(productList.headers.get('Cache-Control')).toBe('no-store');

    const compat = await ctx.jsonRequest<{ code: number; data: { goods: Array<{ price: number }> } }>(
      '/api/v1/reseller/compat/catalog',
      { headers }
    );
    expect(compat.status).toBe(200);
    expect(compat.headers.get('Cache-Control')).toBe('no-store');
    expect(compat.data.code).toBe(200);
    expect(compat.data.data.goods[0].price).toBe(85);

    // 4) B2B 批采出卡 + 幂等重放 + 上级获得批发差价（0.85 - 0.70 = 0.15 * 100 = 15）
    const order1 = await ctx.jsonRequest<{
      ok: boolean;
      order_no: string;
      total_deducted: number;
      remaining_balance: number;
      cards: string[];
    }>('/api/v1/reseller/order', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        idempotency_key: 'b2b-idem-001',
      }),
    });
    expect(order1.status).toBe(200);
    expect(order1.headers.get('Cache-Control')).toBe('no-store');
    expect(order1.data.total_deducted).toBe(85);
    expect(order1.data.remaining_balance).toBe(115);
    expect(order1.data.cards).toHaveLength(1);

    // 上级批发总代收到 ¥15 批发极差
    const parentAfter = (await ctx.db.select().from(users).where(eq(users.id, u1.userId)))[0];
    expect(parentAfter.balance).toBe(515);

    // 幂等重放：返回同一订单，余额保持 ¥115 不重复扣款
    const replay = await ctx.jsonRequest<{ ok: boolean; idempotent: boolean; order_no: string }>(
      '/api/v1/reseller/order',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'month',
          quantity: 1,
          idempotency_key: 'b2b-idem-001',
        }),
      }
    );
    expect(replay.status).toBe(200);
    expect(replay.data.idempotent).toBe(true);
    expect(replay.data.order_no).toBe(order1.data.order_no);

    // [B48] 查单始终按调用方代理隔离，仅交付完成才返回凭证。
    const lookupUrl = `/api/v1/reseller/order?order_no=${order1.data.order_no}`;
    const delivered = await ctx.jsonRequest(lookupUrl, { headers });
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get('Cache-Control')).toBe('no-store');
    expect(delivered.data).toMatchObject({ status: 'delivered', cards: order1.data.cards });
    const otherAgentLookup = await ctx.jsonRequest(lookupUrl, {
      headers: { 'X-API-Key': 'ah_agent_parent_key' },
    });
    expect(otherAgentLookup.status).toBe(404);
    await ctx.db
      .update(orders)
      .set({ status: 'upstream_pending' })
      .where(eq(orders.orderNo, order1.data.order_no));
    const pending = await ctx.jsonRequest('/api/v1/reseller/order?idempotency_key=b2b-idem-001', { headers });
    expect(pending.status).toBe(200);
    expect(pending.data).toMatchObject({ status: 'upstream_pending', total_deducted: 85, cards: [] });
    await ctx.db.update(orders).set({ status: 'processing' }).where(eq(orders.orderNo, order1.data.order_no));
    const processing = await ctx.jsonRequest(lookupUrl, { headers });
    expect(processing.data).toMatchObject({ status: 'processing', total_deducted: null, cards: [] });
    await ctx.db.update(orders).set({ status: 'delivered' }).where(eq(orders.orderNo, order1.data.order_no));

    // 5) 采购超出剩余库存（quarter 仅剩 1 张，请求买 2 张，先扣款再检测库存不足 -> 余额不足或自动退回）
    await ctx.db.update(users).set({ balance: 1000 }).where(eq(users.id, u2.userId));
    const outOfStock = await ctx.jsonRequest('/api/v1/reseller/order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ product_id: productId, spec_id: 'quarter', quantity: 2 }),
    });
    expect(outOfStock.status).toBe(409);
    const childAfterRefund = (await ctx.db.select().from(users).where(eq(users.id, u2.userId)))[0];
    expect(childAfterRefund.balance).toBe(1000);
  });
});
