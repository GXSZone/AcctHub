import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  categoryGroups,
  groupBuySessions,
  orders,
  productCards,
  products,
  users,
} from '../../worker/db/schema/index';
import { runScheduledFinanceSentinel } from '../../worker/domains/risk/risk.service';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('高转化商品形态：隐藏口令、限时秒杀、组合套餐原子发卡、拼团合租与到期续费提醒集成测试', () => {
  let ctx: TestAppContext;
  let adminHeaders: { Authorization: string };
  let categoryId: number;
  let sentEmails: Array<{ to?: string; subject?: string; text?: string }>;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    sentEmails = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('mail-commerce.example.com')) {
          const payload = JSON.parse(String(init?.body || '{}')) as {
            to?: string;
            subject?: string;
            text?: string;
          };
          sentEmails.push(payload);
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      })
    );

    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();

    const [group] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'g-commerce-modes', name: '营销商品大类', sortOrder: 1, isActive: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({
        groupId: group.id,
        slug: 'c-commerce-modes',
        name: '营销商品分类',
        sortOrder: 1,
        isActive: 1,
      })
      .returning();
    categoryId = cat.id;

    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHubShop',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-commerce.example.com/send',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  async function registerAndFundUser(email: string, amount: number) {
    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'Password123!', display_name: email.split('@')[0] }),
    });
    const adj = await ctx.jsonRequest(`/api/admin/members/${reg.data.user.id}/adjust-balance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ amount, reason: '集成测试注资' }),
    });
    expect(adj.status).toBe(200);
    return {
      userId: reg.data.user.id,
      headers: { Authorization: `Bearer ${reg.data.token}` },
    };
  }

  it('1. 隐藏商品列表屏蔽 + 口令解锁保护 + 限时秒杀算价与限量防超卖', async () => {
    const buyer = await registerAndFundUser('flash-buyer@example.com', 500);
    const futureIso = new Date(Date.now() + 3_600_000).toISOString();

    const createRes = await ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: 'VIP 隐藏口令秒杀号',
        base_price: 100,
        stock_mode: 'cards',
        specs: [{ id: 'std', name: '标准版', price: 100 }],
        is_hidden: true,
        access_password: 'SECRET888',
        flash_sale_price: 39.9,
        flash_sale_end_at: futureIso,
        flash_sale_limit: 2,
      }),
    });
    expect(createRes.status).toBe(200);
    const pid = createRes.data.id;

    await ctx.db.insert(productCards).values([
      { productId: pid, specId: 'std', cardContent: 'FLASH-CARD-1', status: 'available' },
      { productId: pid, specId: 'std', cardContent: 'FLASH-CARD-2', status: 'available' },
      { productId: pid, specId: 'std', cardContent: 'FLASH-CARD-3', status: 'available' },
    ]);

    // 隐藏商品绝不出现在前台商品列表
    const listRes = await ctx.jsonRequest<{ items: Array<{ id: number }> }>(
      '/api/storefront/products?category=all'
    );
    expect(listRes.data.items.some((p) => p.id === pid)).toBe(false);

    // 直达详情页未传口令：返回 access_locked: true 且屏蔽详情文本
    const lockedRes = await ctx.jsonRequest<{
      access_locked: boolean;
      product: { detail_markdown: string; has_access_password: boolean };
    }>(`/api/storefront/products/${pid}`);
    expect(lockedRes.status).toBe(200);
    expect(lockedRes.data.access_locked).toBe(true);
    expect(lockedRes.data.product.has_access_password).toBe(true);
    expect(lockedRes.data.product.detail_markdown).toBe('');

    // 传正确口令：成功解锁且价格为限时秒杀价 ¥39.9
    const unlockedRes = await ctx.jsonRequest<{
      access_locked: boolean;
      product: { price: number; flash_sale: { status: string; remaining: number } };
    }>(`/api/storefront/products/${pid}?access_code=SECRET888`);
    expect(unlockedRes.data.access_locked).toBe(false);
    expect(unlockedRes.data.product.price).toBe(39.9);
    expect(unlockedRes.data.product.flash_sale.status).toBe('active');
    expect(unlockedRes.data.product.flash_sale.remaining).toBe(2);

    // 不带口令直接下单必须被 403 拦截
    const deniedOrder = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: buyer.headers,
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'flash-buyer@example.com',
        payment_method: 'balance',
      }),
    });
    expect(deniedOrder.status).toBe(403);

    // 带正确口令买 2 件（耗尽全部秒杀名额）：按 ¥39.9 × 2 = ¥79.8 结算
    const okOrder = await ctx.jsonRequest<{
      order: { unit_price: number; total_amount: number; status: string };
    }>('/api/orders', {
      method: 'POST',
      headers: buyer.headers,
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'std',
        quantity: 2,
        contact_email: 'flash-buyer@example.com',
        payment_method: 'balance',
        access_code: 'SECRET888',
      }),
    });
    expect(okOrder.status).toBe(200);
    expect(okOrder.data.order.status).toBe('delivered');
    expect(okOrder.data.order.unit_price).toBe(39.9);
    expect(okOrder.data.order.total_amount).toBe(79.8);

    // 秒杀限量已抢空后，第 3 件自动恢复原价 ¥100
    const thirdOrder = await ctx.jsonRequest<{
      order: { unit_price: number; total_amount: number };
    }>('/api/orders', {
      method: 'POST',
      headers: buyer.headers,
      body: JSON.stringify({
        product_id: pid,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'flash-buyer@example.com',
        payment_method: 'balance',
        access_code: 'SECRET888',
      }),
    });
    expect(thirdOrder.status).toBe(200);
    expect(thirdOrder.data.order.unit_price).toBe(100);
  });

  it('2. 组合套餐 / 捆绑包：实时套数库存计算、单次原子发放多商品卡密、任一子项缺货零半发', async () => {
    const buyer = await registerAndFundUser('bundle-buyer@example.com', 500);

    const [subA] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId,
        slug: 'sub-a',
        title: 'AI 会员子商品A',
        basePrice: 40,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 's1', name: '月卡', price: 40 }]),
        isActive: 1,
      })
      .returning();
    const [subB] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId,
        slug: 'sub-b',
        title: '流媒体子商品B',
        basePrice: 30,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 's2', name: '月卡', price: 30 }]),
        isActive: 1,
      })
      .returning();

    // A 有 2 张卡密，B 仅有 1 张卡密 -> 套餐整体最多只能卖 1 套
    await ctx.db.insert(productCards).values([
      { productId: subA.id, specId: 's1', cardContent: 'CARD-A-1', status: 'available' },
      { productId: subA.id, specId: 's1', cardContent: 'CARD-A-2', status: 'available' },
      { productId: subB.id, specId: 's2', cardContent: 'CARD-B-1', status: 'available' },
    ]);

    const bundleRes = await ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: 'AI + 流媒体超值组合包',
        base_price: 59,
        stock_mode: 'cards',
        specs: [{ id: 'pack', name: '双享套餐', price: 59 }],
        bundle_items: [
          { product_id: subA.id, spec_id: 's1', quantity: 1 },
          { product_id: subB.id, spec_id: 's2', quantity: 1 },
        ],
      }),
    });
    expect(bundleRes.status).toBe(200);
    const bundleId = bundleRes.data.id;

    // 详情页实时计算套餐可用库存 = 1
    const detail = await ctx.jsonRequest<{
      product: { available_stock: number; bundle_items: Array<{ title: string }> };
    }>(`/api/storefront/products/${bundleId}`);
    expect(detail.data.product.available_stock).toBe(1);
    expect(detail.data.product.bundle_items).toHaveLength(2);

    // 买 2 套时直接被拦截（409），且子商品 A 卡密保持未消耗
    const fail2 = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: buyer.headers,
      body: JSON.stringify({
        product_id: bundleId,
        spec_id: 'pack',
        quantity: 2,
        contact_email: 'bundle-buyer@example.com',
        payment_method: 'balance',
      }),
    });
    expect(fail2.status).toBe(409);

    // 买 1 套：原子发放 A 和 B 两张卡密并带子商品名称前缀
    const ok1 = await ctx.jsonRequest<{
      order: { status: string; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      headers: buyer.headers,
      body: JSON.stringify({
        product_id: bundleId,
        spec_id: 'pack',
        quantity: 1,
        contact_email: 'bundle-buyer@example.com',
        payment_method: 'balance',
      }),
    });
    expect(ok1.status).toBe(200);
    expect(ok1.data.order.status).toBe('delivered');
    expect(ok1.data.order.delivered_payload).toContain('【AI 会员子商品A】CARD-A-1');
    expect(ok1.data.order.delivered_payload).toContain('【流媒体子商品B】CARD-B-1');
  });

  it('3. 拼团合租成团发卡 + 超时自动退余额财务守恒 + 订阅到期前 3 天自动续费提醒防重', async () => {
    const u1 = await registerAndFundUser('gb-user1@example.com', 200);
    const u2 = await registerAndFundUser('gb-user2@example.com', 200);
    const u3 = await registerAndFundUser('gb-user3@example.com', 200);

    const gbProdRes = await ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        category_id: categoryId,
        title: '2人拼团合租车位',
        base_price: 60,
        stock_mode: 'cards',
        warranty_type: 'full_period',
        warranty_days: 30,
        specs: [{ id: 'std', name: '月卡席位', price: 60 }],
        group_buy_enabled: true,
        group_buy_size: 2,
        group_buy_price: 29.9,
        group_buy_hours: 12,
      }),
    });
    const gbProdId = gbProdRes.data.id;
    await ctx.db.insert(productCards).values([
      { productId: gbProdId, specId: 'std', cardContent: 'GB-SEAT-1', status: 'available' },
      { productId: gbProdId, specId: 'std', cardContent: 'GB-SEAT-2', status: 'available' },
      { productId: gbProdId, specId: 'std', cardContent: 'GB-SEAT-3', status: 'available' },
    ]);

    // 用户1 开团（2人团）-> 订单进入 grouping，尚未发卡
    const startGb = await ctx.jsonRequest<{
      order: {
        order_no: string;
        status: string;
        total_amount: number;
        delivered_payload: string;
        group_buy_session: { code: string; current_size: number; remaining_slots: number };
      };
    }>('/api/orders', {
      method: 'POST',
      headers: u1.headers,
      body: JSON.stringify({
        product_id: gbProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'gb-user1@example.com',
        payment_method: 'balance',
        group_buy_mode: 'start',
      }),
    });
    expect(startGb.status).toBe(200);
    expect(startGb.data.order.status).toBe('grouping');
    expect(startGb.data.order.total_amount).toBe(29.9);
    expect(startGb.data.order.delivered_payload).toBe('');
    const gbCode = startGb.data.order.group_buy_session.code;

    // 公开拼团列表可见该团
    const openList = await ctx.jsonRequest<{ sessions: Array<{ code: string; remaining_slots: number }> }>(
      `/api/storefront/products/${gbProdId}/group-buys`
    );
    expect(openList.data.sessions.some((s) => s.code === gbCode && s.remaining_slots === 1)).toBe(true);

    // 用户2 参团 -> 满 2 人瞬间原子成团，用户1与用户2订单双双 delivered 且各得 1 张卡密！
    const joinGb = await ctx.jsonRequest<{
      order: { order_no: string; status: string; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      headers: u2.headers,
      body: JSON.stringify({
        product_id: gbProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'gb-user2@example.com',
        payment_method: 'balance',
        group_buy_mode: 'join',
        group_buy_code: gbCode,
      }),
    });
    expect(joinGb.status).toBe(200);
    expect(joinGb.data.order.status).toBe('delivered');
    expect(joinGb.data.order.delivered_payload).toContain('GB-SEAT-');

    const [u1OrderAfter] = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, startGb.data.order.order_no))
      .limit(1);
    expect(u1OrderAfter?.status).toBe('delivered');

    const [u3Before] = await ctx.db.select().from(users).where(eq(users.id, u3.userId)).limit(1);
    const u3InitialBal = Number(u3Before?.balance ?? 0);
    // 用户3 新开一团并模拟超时未成团 -> 触发维护 Cron -> 自动全额退回 ¥29.9 到钱包余额（精确回到开团前余额）
    const expGb = await ctx.jsonRequest<{
      order: { order_no: string; group_buy_session: { id: number } };
    }>('/api/orders', {
      method: 'POST',
      headers: u3.headers,
      body: JSON.stringify({
        product_id: gbProdId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'gb-user3@example.com',
        payment_method: 'balance',
        group_buy_mode: 'start',
      }),
    });
    expect(expGb.status).toBe(200);
    await ctx.db
      .update(groupBuySessions)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(groupBuySessions.id, expGb.data.order.group_buy_session.id));

    // 同时把用户1的已交付订单 deliveredAt 设为 28 天前（30天质保，距到期仅剩 2 天 -> 命中 3 天内续费提醒！）
    const delivered28DaysAgo = new Date(Date.now() - 28 * 86_400_000).toISOString();
    await ctx.db
      .update(orders)
      .set({ deliveredAt: delivered28DaysAgo })
      .where(eq(orders.orderNo, startGb.data.order.order_no));

    const maint = await ctx.jsonRequest<{
      ok: boolean;
      group_buy: { expiredSessions: number; refundedMembers: number };
      renewal: { reminded: number };
    }>('/api/admin/commerce/run-maintenance', {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(maint.status).toBe(200);
    expect(maint.data.group_buy.expiredSessions).toBe(1);
    expect(maint.data.group_buy.refundedMembers).toBe(1);
    expect(maint.data.renewal.reminded).toBe(1);

    // 验证用户3钱包余额已精确全额退回开团前余额，且 7×24 财务守恒哨兵 100% 通过！
    const [u3Row] = await ctx.db.select().from(users).where(eq(users.id, u3.userId)).limit(1);
    expect(Number(u3Row?.balance)).toBe(u3InitialBal);
    const sentinel = await runScheduledFinanceSentinel(ctx.env);
    expect(sentinel.healthy).toBe(true);

    // 验证续费提醒邮件与拼团超时退款邮件均已真实送出，且再次跑巡检不会重复发续费邮件
    expect(sentEmails.some((m) => m.to === 'gb-user1@example.com' && m.subject?.includes('到期'))).toBe(true);
    expect(sentEmails.some((m) => m.to === 'gb-user3@example.com' && m.subject?.includes('超时未成团'))).toBe(
      true
    );
    const maint2 = await ctx.jsonRequest<{ renewal: { reminded: number } }>(
      '/api/admin/commerce/run-maintenance',
      { method: 'POST', headers: adminHeaders }
    );
    expect(maint2.data.renewal.reminded).toBe(0);
  });
});
