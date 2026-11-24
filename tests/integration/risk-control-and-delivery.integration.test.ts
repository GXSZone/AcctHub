import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categories,
  categoryGroups,
  orders,
  passwordResetCodes,
  paymentPlugins,
  productCards,
  products,
} from '../../worker/db/schema/index';
import { runScheduledFinanceSentinel } from '../../worker/domains/risk/risk.service';
import { sha256Hex } from '../../worker/infra/crypto';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('第一期：5维反盗刷风控、发卡增强与商用闭环集成测试', () => {
  let ctx: TestAppContext;
  let adminHeaders: { Authorization: string };
  let productId: number;
  let buyerHeaders: { Authorization: string };
  let buyerUserId: number;
  let sentEmails: Array<{ to?: string; subject?: string; text?: string }>;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    sentEmails = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('mail-relay.example.com')) {
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
      .values({ slug: 'g-risk', name: '风控大类', sortOrder: 1, isActive: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'c-risk', name: '风控分类', sortOrder: 1, isActive: 1 })
      .returning();
    const [prod] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId: cat.id,
        slug: 'p-risk',
        title: 'AI 高级会员号',
        basePrice: 100,
        costPrice: 50,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'std', name: '标准月卡', price: 100 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHubSec',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-relay.example.com/send',
      order_email_subject_tpl: '【自定义】{{order_no}} - {{product_title}}',
      order_email_body_tpl: '卡密明细:\n{{cards}}',
    });

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'buyer-risk@example.com',
        password: 'Password123!',
        display_name: 'BuyerRisk',
      }),
    });
    expect(reg.status).toBe(200);
    buyerUserId = reg.data.user.id;
    buyerHeaders = { Authorization: `Bearer ${reg.data.token}` };
    const topup = await ctx.jsonRequest(`/api/admin/members/${buyerUserId}/adjust-balance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ amount: 5000, reason: '测试初始充值' }),
    });
    expect(topup.status).toBe(200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('IP/CIDR 黑名单拦单 + 一键紧急模式切 hold_delivery 拦截不吐卡密并连发 3 封告警邮件 + 管理员放行后自动发卡', async () => {
    // 导入 2 张普通卡密
    const imp = await ctx.jsonRequest<{ imported: number }>(`/api/admin/products/${productId}/cards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ spec_id: 'std', lines: 'SECRET-CARD-001\nSECRET-CARD-002' }),
    });
    expect(imp.status).toBe(200);
    expect(imp.data.imported).toBe(2);

    // 1. 拉黑 CIDR 网段 203.0.113.0/24 并验证拦截该网段 IP 下单
    const addIp = await ctx.jsonRequest<{ ok: boolean }>('/api/admin/risk/ip-blacklist', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ ip_pattern: '203.0.113.0/24', reason: '盗刷脚本网段' }),
    });
    expect(addIp.status).toBe(201);

    const blockedOrder = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: { ...buyerHeaders, 'CF-Connecting-IP': '203.0.113.42' },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'buyer-risk@example.com',
        payment_method: 'balance',
      }),
    });
    expect(blockedOrder.status).toBe(403);

    // 2. 切换一键紧急暂停自动发卡（hold_delivery），验证触发 3 封独立主题紧急邮件
    sentEmails = [];
    const sw = await ctx.jsonRequest<{ ok: boolean }>('/api/admin/risk/emergency', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ emergency_mode: 'hold_delivery', reason: '排查可疑交易' }),
    });
    expect(sw.status).toBe(200);
    const alertSubjects = sentEmails.map((m) => m.subject || '');
    expect(alertSubjects.filter((s) => s.includes('1/3')).length).toBe(1);
    expect(alertSubjects.filter((s) => s.includes('2/3')).length).toBe(1);
    expect(alertSubjects.filter((s) => s.includes('3/3')).length).toBe(1);

    // 3. 正常 IP 下单在 hold_delivery 模式下应转入 risk_review 且绝不吐出卡密
    const heldRes = await ctx.jsonRequest<{
      order: { order_no: string; status: string; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { ...buyerHeaders, 'CF-Connecting-IP': '198.51.100.7' },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'buyer-risk@example.com',
        payment_method: 'balance',
      }),
    });
    expect(heldRes.status).toBe(200);
    expect(heldRes.data.order.status).toBe('risk_review');
    expect(heldRes.data.order.delivered_payload).toBe('');

    // 确认卡密仍保持 2 张未售
    const cardsBefore = await ctx.db.select().from(productCards).where(eq(productCards.productId, productId));
    expect(cardsBefore.every((c) => c.status === 'available')).toBe(true);

    // 4. 管理员在订单检索与详情中看到买家 IP 与风控原因，并一键放行发卡
    const searchRes = await ctx.jsonRequest<{ items: Array<{ order_no: string; buyer_ip: string }> }>(
      '/api/admin/orders/search?status=risk_review',
      { headers: adminHeaders }
    );
    expect(searchRes.status).toBe(200);
    expect(searchRes.data.items.length).toBe(1);
    expect(searchRes.data.items[0].buyer_ip).toBe('198.51.100.7');

    const approveRes = await ctx.jsonRequest<{ ok: boolean; status: string; delivered_payload: string }>(
      `/api/admin/orders/${encodeURIComponent(heldRes.data.order.order_no)}/approve-risk`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ note: '人工核验正常放行' }),
      }
    );
    expect(approveRes.status).toBe(200);
    expect(approveRes.data.status).toBe('delivered');
    expect(approveRes.data.delivered_payload).toBe('SECRET-CARD-001');

    // 5. 卡密反查归属订单 & 导出未售 TXT
    const lookupRes = await ctx.jsonRequest<{
      matches: Array<{ order_no: string | null; contact_email?: string; buyer_ip?: string }>;
    }>('/api/admin/cards/lookup?q=SECRET-CARD-001', { headers: adminHeaders });
    expect(lookupRes.status).toBe(200);
    expect(lookupRes.data.matches.length).toBe(1);
    expect(lookupRes.data.matches[0].order_no).toBe(heldRes.data.order.order_no);
    expect(lookupRes.data.matches[0].buyer_ip).toBe('198.51.100.7');

    const exportRes = await ctx.request(`/api/admin/products/${productId}/cards/export?spec_id=std`, {
      headers: adminHeaders,
    });
    expect(exportRes.status).toBe(200);
    expect(await exportRes.text()).toBe('SECRET-CARD-002');

    // 6. 7×24 财务守恒哨兵执行通过
    const sentinel = await runScheduledFinanceSentinel(ctx.env);
    expect(sentinel.healthy).toBe(true);
  });

  it('循环卡密重复发卡不置已售 + 单商品起购/限购/强制登录 + 支付通道买家附加费率与分润隔离', async () => {
    // 1. 导入循环卡密并自动去重
    const imp = await ctx.jsonRequest<{ imported: number; duplicates: number }>(
      `/api/admin/products/${productId}/cards`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          spec_id: 'std',
          lines: 'LOOP-VIP-TOKEN-999\nLOOP-VIP-TOKEN-999',
          is_loop: true,
          dedupe: true,
        }),
      }
    );
    expect(imp.status).toBe(200);
    expect(imp.data.imported).toBe(1);
    expect(imp.data.duplicates).toBe(1);

    // 设置单商品风控规则：最低起购 2 件、单笔限购 3 件、仅限登录购买
    const upd = await ctx.jsonRequest(`/api/admin/products/${productId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ min_quantity: 2, max_quantity: 3, require_login: true }),
    });
    expect(upd.status).toBe(200);

    // 先启用 epay 并配置 3% 买家附加手续费率（upsert 确保测试库中存在该通道记录）
    await ctx.db
      .insert(paymentPlugins)
      .values({
        id: 'epay',
        name: '易支付',
        description: '测试易支付',
        enabled: 1,
        configJson: JSON.stringify({
          api_url: 'https://pay.example.com',
          pid: '1001',
          key: 'k',
          fee_rate_pct: '3',
        }),
      })
      .onConflictDoUpdate({
        target: paymentPlugins.id,
        set: {
          enabled: 1,
          configJson: JSON.stringify({
            api_url: 'https://pay.example.com',
            pid: '1001',
            key: 'k',
            fee_rate_pct: '3',
          }),
        },
      });

    // 游客下单应被强制登录拦截
    const guestFail = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 2,
        contact_email: 'guest@example.com',
        payment_method: 'epay',
      }),
    });
    expect(guestFail.status).toBe(401);

    // 数量低于起购数 2 应被拦截
    const minFail = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: buyerHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 1,
        contact_email: 'buyer-risk@example.com',
        payment_method: 'balance',
      }),
    });
    expect(minFail.status).toBe(400);

    // 数量超过限购数 3 应被拦截
    const maxFail = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      headers: buyerHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 4,
        contact_email: 'buyer-risk@example.com',
        payment_method: 'balance',
      }),
    });
    expect(maxFail.status).toBe(400);

    // 连续买 2 单（每单 2 件），验证循环卡密可反复发卡且库中仍为 available
    for (let i = 0; i < 2; i++) {
      const okOrder = await ctx.jsonRequest<{
        order: { status: string; delivered_payload: string };
      }>('/api/orders', {
        method: 'POST',
        headers: buyerHeaders,
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 2,
          contact_email: 'buyer-risk@example.com',
          payment_method: 'balance',
        }),
      });
      expect(okOrder.status).toBe(200);
      expect(okOrder.data.order.status).toBe('delivered');
      expect(okOrder.data.order.delivered_payload).toBe('LOOP-VIP-TOKEN-999\nLOOP-VIP-TOKEN-999');
    }
    const loopCards = await ctx.db.select().from(productCards).where(eq(productCards.productId, productId));
    expect(loopCards.length).toBe(1);
    expect(loopCards[0].status).toBe('available');
    expect(loopCards[0].isLoop).toBe(1);

    // 2. 配置 epay 买家附加手续费率 3%，验证 bootstrap 暴露与异步收单金额
    await ctx.db
      .update(paymentPlugins)
      .set({
        enabled: 1,
        configJson: JSON.stringify({
          api_url: 'https://pay.example.com',
          pid: '1001',
          key: 'k',
          fee_rate_pct: '3',
        }),
      })
      .where(eq(paymentPlugins.id, 'epay'));

    const boot = await ctx.jsonRequest<{ payment_methods: Array<{ id: string; fee_rate_pct?: number }> }>(
      '/api/storefront/bootstrap'
    );
    expect(boot.status).toBe(200);
    const epayMeta = boot.data.payment_methods.find((m) => m.id === 'epay');
    expect(epayMeta?.fee_rate_pct).toBe(3);

    const asyncOrder = await ctx.jsonRequest<{
      order: { order_no: string; total_amount: number; payment_fee_amount: number };
      payment_intent: { amount_cny: number };
    }>('/api/orders', {
      method: 'POST',
      headers: buyerHeaders,
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 2,
        contact_email: 'buyer-risk@example.com',
        payment_method: 'epay',
      }),
    });
    expect(asyncOrder.status).toBe(200);
    // 商品折后实付 200，通道附加费 3% = 6，网关收单 206（绝不污染商品实付与分润基数）
    expect(asyncOrder.data.order.total_amount).toBe(200);
    expect(asyncOrder.data.order.payment_fee_amount).toBe(6);
    expect(asyncOrder.data.payment_intent.amount_cny).toBe(206);

    // 3. 人工发货/掉单补单（pending_payment 订单人工核账补发）
    const manualRes = await ctx.jsonRequest<{ ok: boolean; status: string; delivered_payload: string }>(
      `/api/admin/orders/${encodeURIComponent(asyncOrder.data.order.order_no)}/manual-confirm`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          manual_payload: 'MANUAL-RECOVERY-CARD-888',
          note: '支付宝掉单人工核账补单',
        }),
      }
    );
    expect(manualRes.status).toBe(200);
    expect(manualRes.data.status).toBe('delivered');
    expect(manualRes.data.delivered_payload).toBe('MANUAL-RECOVERY-CARD-888');
    const [orderRow] = await ctx.db
      .select()
      .from(orders)
      .where(eq(orders.orderNo, asyncOrder.data.order.order_no));
    expect(orderRow.status).toBe('delivered');
  });

  it('忘记密码 6 位验证码重置 + 吊销旧会话 + 会员改密 + 管理员代重置会员密码闭环', async () => {
    // 1. 请求忘记密码验证码
    const reqReset = await ctx.jsonRequest<{ ok: boolean }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'buyer-risk@example.com' }),
    });
    expect(reqReset.status).toBe(200);
    expect(sentEmails.some((m) => (m.subject || '').includes('密码重置验证码'))).toBe(true);

    // 写入已知验证码校验并重置密码
    const knownCode = '654321';
    const knownHash = await sha256Hex(`pwd-reset:0:buyer-risk@example.com:${knownCode}`);
    await ctx.db
      .update(passwordResetCodes)
      .set({ codeHash: knownHash })
      .where(eq(passwordResetCodes.userId, buyerUserId));

    const confirmRes = await ctx.jsonRequest<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: 'buyer-risk@example.com',
        code: knownCode,
        new_password: 'NewPassword2026!',
      }),
    });
    expect(confirmRes.status).toBe(200);

    // 旧会话必须已失效
    const oldMe = await ctx.jsonRequest<{ user: unknown }>('/api/auth/me', { headers: buyerHeaders });
    expect(oldMe.data.user).toBeNull();

    // 使用新密码登录
    const loginNew = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'buyer-risk@example.com', password: 'NewPassword2026!' }),
    });
    expect(loginNew.status).toBe(200);

    // 2. 会员自行改密
    const chg = await ctx.jsonRequest<{ ok: boolean; token: string }>('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${loginNew.data.token}` },
      body: JSON.stringify({ current_password: 'NewPassword2026!', new_password: 'SelfChanged2026!' }),
    });
    expect(chg.status).toBe(200);
    expect(chg.data.token).toBeTruthy();

    // 3. 总控管理员代重置会员密码并立即吊销该会员活跃会话
    const adminReset = await ctx.jsonRequest<{ ok: boolean }>(`/api/admin/members/${buyerUserId}/password`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ new_password: 'AdminReset2026!' }),
    });
    expect(adminReset.status).toBe(200);

    const revokedMe = await ctx.jsonRequest<{ user: unknown }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${chg.data.token}` },
    });
    expect(revokedMe.data.user).toBeNull();
  });
});
