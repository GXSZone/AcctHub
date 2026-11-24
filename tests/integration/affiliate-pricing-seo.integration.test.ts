import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  affiliateLedgers,
  agents,
  agentTiers,
  categories,
  categoryGroups,
  paymentIntents,
  paymentPlugins,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { createTestApp } from './helpers/test-app';

describe('分销定价与 SEO：阶梯批发价、Affiliate 永久推广消费金与退单追缴、资金守恒与分站主题', () => {
  it('覆盖阶梯批发价择优防亏、永久推荐返佣、消费金下单抵扣与退款追缴、5项守恒巡检全绿', async () => {
    const app = createTestApp({ ADMIN_SECRET: 'm3-test-admin' });
    try {
      const initRes = await app.jsonRequest<{ token: string }>('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'm3-test-admin',
          admin_email: 'admin@m3.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'M3Store',
        }),
      });
      expect(initRes.ok).toBe(true);
      const adminToken = initRes.data.token;

      // 准备分类、代理等级与带阶梯批发价测试商品（标价100，成本75，阶梯：满5件9折=90，满10件7折=70但受成本75保护）
      const [grp] = await app.db
        .insert(categoryGroups)
        .values({ slug: 'ai', name: 'AI 服务', nameEn: 'AI', sortOrder: 1 })
        .returning({ id: categoryGroups.id });
      const [cat] = await app.db
        .insert(categories)
        .values({ groupId: grp.id, slug: 'chat', name: '对话', nameEn: 'Chat', sortOrder: 1 })
        .returning({ id: categories.id });
      await app.db
        .insert(agentTiers)
        .values({
          ownerAgentId: 0,
          code: 'silver',
          name: '白银代理',
          levelRank: 1,
          minRecharge: 100,
          discountRate: 0.85,
          commissionRate: 0.1,
        })
        .onConflictDoNothing();

      const createProdRes = await app.jsonRequest<{ ok: boolean; id: number }>('/api/admin/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          category_id: cat.id,
          slug: 'tier-bulk-pro',
          title: '阶梯批发会员席位',
          base_price: 100,
          cost_price: 75,
          allow_below_cost: true,
          stock_mode: 'manual_stock',
          manual_stock: 200,
          specs: [{ id: 'std', name: '标准月席位', price: 100, cost_price: 75 }],
          tier_pricing: [
            { min_qty: 5, discount_rate: 0.9 },
            { min_qty: 10, discount_rate: 0.7 },
          ],
        }),
      });
      expect(createProdRes.ok).toBe(true);
      const productId = createProdRes.data.id;

      // 1. 注册推荐人 A，获取邀请码
      const regARes = await app.jsonRequest<{ token: string; user: { id: number; referral_code: string } }>(
        '/api/auth/register',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'refa@m3.dev', password: 'Password123', display_name: '推荐人A' }),
        }
      );
      expect(regARes.ok).toBe(true);
      expect(regARes.data.user.referral_code).toMatch(/^AH[A-Z0-9]+$/);
      const tokenA = regARes.data.token;
      const refCodeA = regARes.data.user.referral_code;

      // 2. 受邀用户 B 使用推荐码永久绑定注册
      const regBRes = await app.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'buyerb@m3.dev',
          password: 'Password123',
          display_name: '买家B',
          referral_code: refCodeA,
        }),
      });
      expect(regBRes.ok).toBe(true);
      const tokenB = regBRes.data.token;
      const userBId = regBRes.data.user.id;

      const [bRow] = await app.db.select().from(users).where(eq(users.id, userBId));
      expect(bRow.referredByUserId).toBe(regARes.data.user.id);

      // 给 B 充值余额用于测试下单（注册已含 50 沙盒体验金流水，补足至 5000）
      await app.db.update(users).set({ balance: 5000 }).where(eq(users.id, userBId));
      await app.db.insert(walletTransactions).values({
        userId: userBId,
        type: 'recharge',
        amount: 4950,
        balanceAfter: 5000,
        refNo: 'M3-SEED-B',
        note: 'M3测试加款',
      });

      // 3. B 下单买 5 件，验证命中 9 折阶梯单价 ¥90，共 ¥450
      const orderB5Res = await app.jsonRequest<{
        order: { order_no: string; unit_price: number; total_amount: number };
      }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 5,
          contact_email: 'buyerb@m3.dev',
          payment_method: 'balance',
        }),
      });
      expect(orderB5Res.ok).toBe(true);
      expect(orderB5Res.data.order.unit_price).toBe(90);
      expect(orderB5Res.data.order.total_amount).toBe(450);

      // 4. 验证 A 获得 5% 不可提现推广消费金：450 * 0.05 = 22.50
      const affARes = await app.jsonRequest<{
        promo_balance: number;
        referred_count: number;
        settled_reward_total: number;
      }>('/api/account/affiliate', { headers: { Authorization: `Bearer ${tokenA}` } });
      expect(affARes.ok).toBe(true);
      expect(affARes.data.promo_balance).toBe(22.5);
      expect(affARes.data.referred_count).toBe(1);
      expect(affARes.data.settled_reward_total).toBe(22.5);

      // 验证推广金无法提现（提现仅面对有提现账户余额与代理佣金渠道，A 为普通会员调用提现将被拒绝）
      const wdFail = await app.jsonRequest('/api/agent/withdrawals', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ amount: 20, channel: 'alipay', account_info: 'a@alipay.com' }),
      });
      expect(wdFail.ok).toBe(false);

      // 5. B 买 10 件时，7 折=70 受 cost_price=75 保护，单价钳位至 ¥75
      const orderB10Res = await app.jsonRequest<{
        order: { order_no: string; unit_price: number; total_amount: number };
      }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 10,
          contact_email: 'buyerb@m3.dev',
          payment_method: 'balance',
        }),
      });
      expect(orderB10Res.ok).toBe(true);
      expect(orderB10Res.data.order.unit_price).toBe(75);
      expect(orderB10Res.data.order.total_amount).toBe(750);

      // 至此 A 共有 22.50 + 37.50 = 60.00 推广消费金
      // 6. 给 A 充 200 主余额，A 下单 1 件 ¥100 并使用全部 ¥60 推广消费金抵扣 => 实付余额 ¥40
      await app.db.update(users).set({ balance: 200 }).where(eq(users.id, regARes.data.user.id));
      await app.db.insert(walletTransactions).values({
        userId: regARes.data.user.id,
        type: 'recharge',
        amount: 150,
        balanceAfter: 200,
        refNo: 'M3-SEED-A',
        note: 'M3测试加款',
      });
      const orderARes = await app.jsonRequest<{
        order: { order_no: string; total_amount: number; promo_used_amount: number };
        balance: number;
      }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'refa@m3.dev',
          payment_method: 'balance',
          use_promo_balance: true,
        }),
      });
      expect(orderARes.ok).toBe(true);
      expect(orderARes.data.order.promo_used_amount).toBe(60);
      expect(orderARes.data.order.total_amount).toBe(40);
      expect(orderARes.data.balance).toBe(160);

      // 7. 管理员退款 A 的订单 -> 验证主余额退回 ¥40，且推广金原路退回 ¥60
      const refundARes = await app.jsonRequest<{ ok: boolean }>(
        `/api/admin/orders/${orderARes.data.order.order_no}/refund`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ restock: false }),
        }
      );
      expect(refundARes.ok).toBe(true);
      const [aAfterRefund] = await app.db.select().from(users).where(eq(users.id, regARes.data.user.id));
      expect(aAfterRefund.balance).toBe(200);
      expect(aAfterRefund.promoBalance).toBe(60);

      // 8. 管理员退款 B 的 5 件订单 (曾发 ¥22.50 返佣) -> 自动追缴 A 的 ¥22.50 推广金，A 剩 37.50
      const refundB5Res = await app.jsonRequest<{ ok: boolean }>(
        `/api/admin/orders/${orderB5Res.data.order.order_no}/refund`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ restock: false }),
        }
      );
      expect(refundB5Res.ok).toBe(true);
      const [aAfterClawback] = await app.db.select().from(users).where(eq(users.id, regARes.data.user.id));
      expect(aAfterClawback.promoBalance).toBe(37.5);
      const [ledgerB5] = await app.db
        .select()
        .from(affiliateLedgers)
        .where(eq(affiliateLedgers.orderNo, orderB5Res.data.order.order_no));
      expect(ledgerB5.status).toBe('clawed_back');
      expect(ledgerB5.clawedBackAmount).toBe(22.5);

      // 9. 验证异步网关预扣推广金超时过期自动退回
      await app.db.update(paymentPlugins).set({ enabled: 1 }).where(eq(paymentPlugins.id, 'epay'));
      const asyncOrd = await app.jsonRequest<{
        requires_payment: boolean;
        order: { order_no: string; total_amount: number; promo_used_amount: number };
        payment_intent: { intent_no: string };
      }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'refa@m3.dev',
          payment_method: 'epay',
          use_promo_balance: true,
        }),
      });
      expect(asyncOrd.ok).toBe(true);
      expect(asyncOrd.data.requires_payment).toBe(true);
      expect(asyncOrd.data.order.promo_used_amount).toBe(37.5);
      expect(asyncOrd.data.order.total_amount).toBe(62.5);
      await app.db
        .update(paymentIntents)
        .set({ expiresAt: '2020-01-01 00:00:00' })
        .where(eq(paymentIntents.intentNo, asyncOrd.data.payment_intent.intent_no));
      const pollExpired = await app.jsonRequest<{ intent: { status: string } }>(
        `/api/payments/intents/${asyncOrd.data.payment_intent.intent_no}`,
        { headers: { Authorization: `Bearer ${tokenA}` } }
      );
      expect(pollExpired.data.intent.status).toBe('expired');
      const [aAfterExpired] = await app.db.select().from(users).where(eq(users.id, regARes.data.user.id));
      expect(aAfterExpired.promoBalance).toBe(37.5);

      // 10. 注册代理 C（白银 85 折）：买 5 件选 85 折 ¥85（不与 9 折叠折），买 10 件选阶梯钳位 ¥75；且代理订单不给推荐人结算 Affiliate 佣金
      const regCRes = await app.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'agentc@m3.dev',
          password: 'Password123',
          display_name: '代理C',
          referral_code: refCodeA,
        }),
      });
      const tokenC = regCRes.data.token;
      const userCId = regCRes.data.user.id;
      const [tierSilver] = await app.db.select().from(agentTiers).where(eq(agentTiers.code, 'silver'));
      await app.db.update(users).set({ role: 'agent', balance: 5000 }).where(eq(users.id, userCId));
      await app.db.insert(walletTransactions).values({
        userId: userCId,
        type: 'recharge',
        amount: 4950,
        balanceAfter: 5000,
        refNo: 'M3-SEED-C',
        note: 'M3测试加款',
      });
      await app.db.insert(agents).values({
        userId: userCId,
        tierId: tierSilver.id,
        slug: 'agentc',
        brandName: 'AgentC 店',
        apiKey: 'ak_agentc_test_001',
        status: 'active',
      });

      const orderC5 = await app.jsonRequest<{ order: { order_no: string; unit_price: number } }>(
        '/api/orders',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenC}` },
          body: JSON.stringify({
            product_id: productId,
            spec_id: 'std',
            quantity: 5,
            contact_email: 'agentc@m3.dev',
            payment_method: 'balance',
          }),
        }
      );
      expect(orderC5.ok).toBe(true);
      expect(orderC5.data.order.unit_price).toBe(85); // 代理 85 折胜于 5 件 9 折，不叠折

      const orderC10 = await app.jsonRequest<{ order: { order_no: string; unit_price: number } }>(
        '/api/orders',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenC}` },
          body: JSON.stringify({
            product_id: productId,
            spec_id: 'std',
            quantity: 10,
            contact_email: 'agentc@m3.dev',
            payment_method: 'balance',
          }),
        }
      );
      expect(orderC10.ok).toBe(true);
      expect(orderC10.data.order.unit_price).toBe(75); // 阶梯 75 胜于代理 85，仍不叠折

      // A 的推广金仍旧停留在 37.5（确认代理身份订单未重叠发 Affiliate 佣金）
      const [aFinal] = await app.db.select().from(users).where(eq(users.id, regARes.data.user.id));
      expect(aFinal.promoBalance).toBe(37.5);

      // 11. 验证财务对账 7 项守恒检验全部通过
      const finRes = await app.jsonRequest<{
        integrity_checks: Array<{ key: string; passed: boolean; count: number }>;
      }>('/api/admin/finance/reconciliation?days=30', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(finRes.ok).toBe(true);
      expect(finRes.data.integrity_checks.length).toBe(7);
      for (const chk of finRes.data.integrity_checks) {
        expect(chk.passed).toBe(true);
      }
      expect(finRes.data.integrity_checks.some((c) => c.key === 'promo_ledger_conservation')).toBe(true);
      expect(finRes.data.integrity_checks.some((c) => c.key === 'wallet_ledger_conservation')).toBe(true);
      expect(finRes.data.integrity_checks.some((c) => c.key === 'l1_orphan_deductions')).toBe(true);
    } finally {
      app.close();
    }
  });

  it('分站品牌主题色持久化、XSS安全校验与 Cloudflare Workers Assets HTML SEO 动态边缘重写', async () => {
    const shellHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>AcctHub · 默认标题</title>
    <meta name="description" content="默认介绍" />
    <meta property="og:title" content="AcctHub" />
  </head>
  <body><div id="root"></div></body>
</html>`;

    const mockAssets = {
      fetch: async () =>
        new Response(shellHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    } as unknown as Fetcher;

    const app = createTestApp({ ADMIN_SECRET: 'm3-seo-admin', ASSETS: mockAssets });
    try {
      await app.jsonRequest('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'm3-seo-admin',
          admin_email: 'admin@seo.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'MainSeoBrand',
        }),
      });

      const regRes = await app.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'shop@seo.dev', password: 'Password123', display_name: 'Shop' }),
      });
      const userId = regRes.data.user.id;
      await app.db.update(users).set({ role: 'agent' }).where(eq(users.id, userId));
      await app.db.insert(agents).values({
        userId,
        slug: 'stardust',
        brandName: '星尘小店',
        apiKey: 'ak_stardust_001',
        status: 'active',
      });

      // 保存包含主题色、合法 Favicon、以及试图闭合标签和 javascript: XSS 的字段（必须在分站自身域名下操作）
      const updateRes = await app.jsonRequest<{
        ok: boolean;
        agent: { theme_accent: string; favicon_url: string };
      }>('http://stardust.localhost/api/agent/brand', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${regRes.data.token}` },
        body: JSON.stringify({
          brand_name: '星尘 AI 店',
          theme_accent: '#2d6a57',
          favicon_url: 'https://cdn.example.com/favicon.png',
          og_image_url: 'javascript:alert(1)',
          seo_title: '星尘AI <script>alert(1)</script> "严选"',
          seo_description: '精选正版 AI 订阅',
          footer_text: '© 2026 星尘严选分站',
        }),
      });
      expect(updateRes.ok).toBe(true);
      expect(updateRes.data.agent.theme_accent).toBe('#2D6A57');
      expect(updateRes.data.agent.favicon_url).toBe('https://cdn.example.com/favicon.png');

      // 请求前台 HTML 验证边缘重写与严格转义
      const htmlRes = await app.request('http://stardust.localhost/', {
        headers: { Accept: 'text/html' },
      });
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain('<title>星尘AI &lt;script&gt;alert(1)&lt;/script&gt; "严选"</title>');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('javascript:alert');
      expect(html).toContain('<link rel="icon" href="https://cdn.example.com/favicon.png" />');
      expect(html).toContain('<meta name="theme-color" content="#2D6A57" />');
      expect(html).toContain('<meta name="description" content="精选正版 AI 订阅" />');

      // 验证 bootstrap 公开透出主题色和自定义页脚
      const bootRes = await app.jsonRequest<{
        tenant: { themeAccent: string; footerText: string; seoTitle: string };
      }>('http://stardust.localhost/api/storefront/bootstrap');
      expect(bootRes.ok).toBe(true);
      expect(bootRes.data.tenant.themeAccent).toBe('#2D6A57');
      expect(bootRes.data.tenant.footerText).toBe('© 2026 星尘严选分站');
    } finally {
      app.close();
    }
  });

  it('分站独立管理「邀请有礼 · 推广消费金」开关/比例/门槛/封顶，且抵扣受拿货底价保护', async () => {
    const app = createTestApp({ ADMIN_SECRET: 'm3-sub-aff-admin' });
    try {
      const initRes = await app.jsonRequest<{ token: string }>('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'm3-sub-aff-admin',
          admin_email: 'admin@m3sub.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'M3SubMain',
        }),
      });
      expect(initRes.ok).toBe(true);
      const adminToken = initRes.data.token;

      const [grp] = await app.db
        .insert(categoryGroups)
        .values({ slug: 'sub-g', name: '分站测试', sortOrder: 1 })
        .returning({ id: categoryGroups.id });
      const [cat] = await app.db
        .insert(categories)
        .values({ groupId: grp.id, slug: 'sub-c', name: '子分站商品', sortOrder: 1 })
        .returning({ id: categories.id });
      const [tier] = await app.db
        .insert(agentTiers)
        .values({
          ownerAgentId: 0,
          code: 'gold',
          name: '黄金代理',
          levelRank: 2,
          minRecharge: 0,
          discountRate: 0.8,
          commissionRate: 0.1,
        })
        .returning({ id: agentTiers.id });

      const prodRes = await app.jsonRequest<{ id: number }>('/api/admin/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          category_id: cat.id,
          slug: 'sub-aff-sku',
          title: '分站独立推广商品',
          base_price: 100,
          cost_price: 50,
          stock_mode: 'manual_stock',
          manual_stock: 50,
          specs: [{ id: 'std', name: '标准版', price: 100, cost_price: 50 }],
        }),
      });
      const productId = prodRes.data.id;

      // 创建分站 owner 与分站 subone（标价加 25% -> 125，拿货 8 折底价 -> 80）
      const ownerReg = await app.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'owner@m3sub.dev', password: 'Password123!' }),
      });
      await app.db
        .update(users)
        .set({ role: 'agent', balance: 1000 })
        .where(eq(users.id, ownerReg.data.user.id));
      await app.db.insert(agents).values({
        userId: ownerReg.data.user.id,
        tierId: tier.id,
        slug: 'subone',
        brandName: 'SubOne Shop',
        apiKey: 'ak_subone_001',
        markupPercent: 25,
        status: 'active',
      });
      const ownerToken = ownerReg.data.token;

      const subOrigin = 'http://subone.localhost';

      // 默认情况下代理分站的邀请有礼是关闭的，注册用户不会发邀请码
      const defaultAffCfg = await app.jsonRequest<{ enabled: boolean }>(
        `${subOrigin}/api/agent/affiliate-config`,
        {
          headers: { Authorization: `Bearer ${ownerToken}` },
        }
      );
      expect(defaultAffCfg.ok).toBe(true);
      expect(defaultAffCfg.data.enabled).toBe(false);

      const earlyUser = await app.jsonRequest<{ token: string }>(`${subOrigin}/api/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ email: 'early@m3sub.dev', password: 'Password123!' }),
      });
      const earlySummary = await app.jsonRequest<{
        affiliate_enabled: boolean;
        referral_code: string | null;
      }>(`${subOrigin}/api/account/affiliate`, {
        headers: { Authorization: `Bearer ${earlyUser.data.token}` },
      });
      expect(earlySummary.data.affiliate_enabled).toBe(false);
      expect(earlySummary.data.referral_code).toBeNull();

      // 分站长自主开启本站推广消费金策略：比例 50%、门槛 50、单笔封顶 45
      const saveCfg = await app.jsonRequest<{ ok: boolean; enabled: boolean; max_reward: number }>(
        `${subOrigin}/api/agent/affiliate-config`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${ownerToken}` },
          body: JSON.stringify({
            enabled: true,
            commission_rate: 0.5,
            min_order_amount: 50,
            max_reward: 45,
          }),
        }
      );
      expect(saveCfg.ok).toBe(true);
      expect(saveCfg.data.enabled).toBe(true);
      expect(saveCfg.data.max_reward).toBe(45);

      // 分站 bootstrap 必须体现自身独立推广配置（不得泄漏主站关闭状态）
      const subBoot = await app.jsonRequest<{ settings: Record<string, string> }>(
        `${subOrigin}/api/storefront/bootstrap`
      );
      expect(subBoot.data.settings.affiliate_enabled).toBe('1');
      expect(subBoot.data.settings.affiliate_commission_rate).toBe('0.5');

      // 分站推广员 A 获取本站邀请码
      const subRefRes = await app.jsonRequest<{ referral_code: string | null; affiliate_enabled: boolean }>(
        `${subOrigin}/api/account/affiliate`,
        { headers: { Authorization: `Bearer ${earlyUser.data.token}` } }
      );
      expect(subRefRes.data.affiliate_enabled).toBe(true);
      expect(subRefRes.data.referral_code).toMatch(/^AH[A-Z0-9]+$/);

      // 受邀买家 B 在分站注册并下单 125 元，验证按分站规则返佣封顶 45（而非 125 * 0.5 = 62.5）
      const buyerBRes = await app.jsonRequest<{ token: string; user: { id: number } }>(
        `${subOrigin}/api/auth/register`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: 'subbuyer@m3sub.dev',
            password: 'Password123!',
            referral_code: subRefRes.data.referral_code,
          }),
        }
      );
      await app.db.update(users).set({ balance: 500 }).where(eq(users.id, buyerBRes.data.user.id));

      const bOrder = await app.jsonRequest<{
        ok?: boolean;
        order: { order_no: string; total_amount: number };
      }>(`${subOrigin}/api/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerBRes.data.token}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'subbuyer@m3sub.dev',
          payment_method: 'balance',
        }),
      });
      expect(bOrder.ok).toBe(true);
      expect(bOrder.data.order.total_amount).toBe(125);

      const earlyAfter = await app.jsonRequest<{ promo_balance: number }>(
        `${subOrigin}/api/account/affiliate`,
        { headers: { Authorization: `Bearer ${earlyUser.data.token}` } }
      );
      expect(earlyAfter.data.promo_balance).toBe(45);

      // 推广员 A 有 45 元消费金，但在分站买这件零售价 125 / 拿货底价 80 的商品时，最多只能抵扣 45（恰为 125 - 80）
      // 测试加倍数量或调高消费金到 100 时，单件实付依然不穿底 80 元拿货底价
      await app.db
        .update(users)
        .set({ balance: 500, promoBalance: 100 })
        .where(
          eq(
            users.id,
            earlyAfter
              ? (await app.db.select().from(users).where(eq(users.email, 'early@m3sub.dev')))[0].id
              : 0
          )
        );
      const useRes = await app.jsonRequest<{
        order: { promo_used_amount: number; total_amount: number };
      }>(`${subOrigin}/api/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${earlyUser.data.token}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'early@m3sub.dev',
          payment_method: 'balance',
          use_promo_balance: true,
        }),
      });
      expect(useRes.ok).toBe(true);
      expect(useRes.data.order.promo_used_amount).toBe(45);
      expect(useRes.data.order.total_amount).toBe(80);

      // 分站长本人以自己分站的邀请码推荐新注册买家，也可正常绑定并结算分站推广返佣
      const ownerAff = await app.jsonRequest<{ referral_code: string | null; affiliate_enabled: boolean }>(
        `${subOrigin}/api/account/affiliate`,
        { headers: { Authorization: `Bearer ${ownerToken}` } }
      );
      expect(ownerAff.data.affiliate_enabled).toBe(true);
      expect(ownerAff.data.referral_code).toMatch(/^AH[A-Z0-9]+$/);
      const ownerBuyerRes = await app.jsonRequest<{ token: string; user: { id: number } }>(
        `${subOrigin}/api/auth/register`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: 'ownerbuyer@m3sub.dev',
            password: 'Password123!',
            referral_code: ownerAff.data.referral_code,
          }),
        }
      );
      await app.db.update(users).set({ balance: 500 }).where(eq(users.id, ownerBuyerRes.data.user.id));
      const obOrder = await app.jsonRequest<{ order: { order_no: string } }>(`${subOrigin}/api/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerBuyerRes.data.token}` },
        body: JSON.stringify({
          product_id: productId,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'ownerbuyer@m3sub.dev',
          payment_method: 'balance',
        }),
      });
      expect(obOrder.ok).toBe(true);
      const ownerAffAfter = await app.jsonRequest<{ promo_balance: number }>(
        `${subOrigin}/api/account/affiliate`,
        { headers: { Authorization: `Bearer ${ownerToken}` } }
      );
      expect(ownerAffAfter.data.promo_balance).toBe(45);
    } finally {
      app.close();
    }
  });
});
