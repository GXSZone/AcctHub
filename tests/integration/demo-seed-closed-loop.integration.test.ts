/**
 * 沙盒全功能闭环模拟数据与生产零演示数据隔离回归测试
 */

import { describe, expect, it } from 'vitest';
import { agents, orders, products, users } from '../../worker/db/schema';
import { ensureDemoSeeded } from '../../worker/db/seeds';
import { createTestApp } from './helpers/test-app';

describe('沙盒全功能闭环模拟数据与上线零数据隔离', () => {
  it('1. 生产/预发/测试模式下严禁灌入任何模拟数据，仅冷启动写入默认基础设置', async () => {
    const ctx = createTestApp();
    try {
      for (const appEnv of ['production', 'staging', 'test']) {
        await ensureDemoSeeded({ ...ctx.env, APP_ENV: appEnv, SANDBOX_MODE: 'false' });
      }
      const [prodRows, agentRows, orderRows, userRows] = await Promise.all([
        ctx.db.select().from(products),
        ctx.db.select().from(agents),
        ctx.db.select().from(orders),
        ctx.db.select().from(users),
      ]);
      expect(prodRows).toHaveLength(0);
      expect(agentRows).toHaveLength(0);
      expect(orderRows).toHaveLength(0);
      expect(userRows).toHaveLength(0);
    } finally {
      ctx.close();
    }
  });

  it('2. 本地开发沙盒全闭环灌入：3级代理树/分站私有商品/全部商品形态/7重资金守恒全部PASS且幂等', async () => {
    const ctx = createTestApp({ APP_ENV: 'development', SANDBOX_MODE: 'true' });
    try {
      await ensureDemoSeeded(ctx.env);
      // 二次重入应完全幂等
      await ensureDemoSeeded(ctx.env);

      // 校验 3 级代理拓扑（L1 -> L2 -> L3）
      const allAgents = await ctx.db.select().from(agents);
      const slugs = new Set(allAgents.map((a) => a.slug));
      for (const slug of ['studio', 'nebula', 'aurora', 'kairo', 'pulse', 'paused-demo']) {
        expect(slugs.has(slug), `缺少代理分站 @${slug}`).toBe(true);
      }

      const pulse = allAgents.find((a) => a.slug === 'pulse');
      const aurora = allAgents.find((a) => a.slug === 'aurora');
      const studio = allAgents.find((a) => a.slug === 'studio');
      expect(pulse?.depth).toBe(3);
      expect(pulse?.parentAgentId).toBe(aurora?.id);
      expect(aurora?.depth).toBe(2);
      expect(aurora?.parentAgentId).toBe(studio?.id);

      // 管理员登录并校验财务 7 重资金守恒
      const login = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'admin@accthub.dev', password: 'admin123456' }),
      });
      expect(login.status).toBe(200);
      const headers = { Authorization: `Bearer ${login.data.token}` };

      const fin = await ctx.jsonRequest<{
        summary: { paid_orders: number; gross_gmv: number; agent_commission_total: number };
        integrity_checks: Array<{ key: string; passed: boolean; detail?: string }>;
      }>('/api/admin/finance/reconciliation?days=30', { headers });
      expect(fin.status).toBe(200);
      expect(fin.data.summary.paid_orders).toBeGreaterThanOrEqual(7);
      expect(fin.data.summary.gross_gmv).toBeGreaterThan(500);
      expect(fin.data.summary.agent_commission_total).toBeGreaterThan(100);
      expect(fin.data.integrity_checks).toHaveLength(7);
      for (const chk of fin.data.integrity_checks) {
        expect(chk.passed, `资金守恒巡检失败: ${chk.key} -> ${JSON.stringify(chk)}`).toBe(true);
      }

      // 校验后台全部核心面板均有饱满闭环数据且零报错
      const [ovRes, riskRes, hookRes, membersRes, prodRes, upRes, auditRes] = await Promise.all([
        ctx.jsonRequest('/api/admin/overview', { headers }),
        ctx.jsonRequest<{ ip_blacklist: unknown[]; events: unknown[] }>('/api/admin/risk/overview', {
          headers,
        }),
        ctx.jsonRequest<{ webhooks: Array<{ secret_masked: string }> }>('/api/admin/webhooks', { headers }),
        ctx.jsonRequest<{ items: unknown[] }>('/api/admin/members', { headers }),
        ctx.jsonRequest<{
          items: Array<{
            id: number;
            slug: string;
            allow_card_selection?: boolean;
            group_buy?: { enabled: boolean; size: number; price: number | null };
            flash_sale?: { status: string; price: number | null };
          }>;
        }>('/api/storefront/products?category=all'),
        ctx.jsonRequest<{ sources: unknown[]; logs: unknown[] }>('/api/admin/upstreams', { headers }),
        ctx.jsonRequest<{ items?: unknown[]; logs?: unknown[] }>('/api/admin/audit-logs', { headers }),
      ]);
      for (const r of [ovRes, riskRes, hookRes, membersRes, prodRes, upRes, auditRes]) {
        expect(r.status).toBe(200);
      }

      expect(riskRes.data.ip_blacklist.length).toBeGreaterThanOrEqual(2);
      expect(riskRes.data.events.length).toBeGreaterThanOrEqual(3);
      expect(hookRes.data.webhooks.length).toBeGreaterThanOrEqual(2);
      expect(hookRes.data.webhooks[0]?.secret_masked).toContain('****');
      expect(membersRes.data.items.length).toBeGreaterThanOrEqual(8);
      expect(upRes.data.sources.length).toBeGreaterThanOrEqual(2);
      expect(upRes.data.logs.length).toBeGreaterThanOrEqual(2);
      expect((auditRes.data.items ?? auditRes.data.logs ?? []).length).toBeGreaterThanOrEqual(3);

      // 前台目录：隐藏口令商品不可见；选号商品、拼团商品、秒杀商品、组合套餐可见
      expect(prodRes.data.items.some((p) => p.slug === 'vip-secret-enterprise')).toBe(false);
      const pickProd = prodRes.data.items.find((p) => p.slug === 'chatgpt-pick-seat');
      const gbProd = prodRes.data.items.find((p) => p.slug === 'netflix-group-buy');
      const flashProd = prodRes.data.items.find((p) => p.slug === 'claude-flash-deal');
      expect(pickProd?.allow_card_selection).toBe(true);
      expect(gbProd?.group_buy?.enabled).toBe(true);
      expect(flashProd?.flash_sale?.status).toBe('active');

      const cardsRes = await ctx.jsonRequest<{
        cards?: Array<{ public_label: string; select_fee: number }>;
        items?: Array<{ public_label: string; select_fee: number }>;
      }>(`/api/storefront/products/${pickProd?.id}/selectable-cards?spec_id=default`);
      expect(cardsRes.status).toBe(200);
      expect((cardsRes.data.cards ?? cardsRes.data.items ?? []).length).toBe(6);

      const gbDetailRes = await ctx.jsonRequest<{
        open_group_buys?: Array<{ code: string; status: string }>;
      }>(`/api/storefront/products/${gbProd?.id}`);
      expect(gbDetailRes.status).toBe(200);
      expect(
        (gbDetailRes.data.open_group_buys ?? []).some((s) => s.code === 'GBDEMO01' && s.status === 'open')
      ).toBe(true);

      // 校验会员视角（OAuth 绑定、推广返佣、2FA 保险箱）
      const mLogin = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'member@accthub.dev', password: 'member123456' }),
      });
      expect(mLogin.status).toBe(200);
      const mHeaders = { Authorization: `Bearer ${mLogin.data.token}` };
      const [affRes, totpRes, oauthRes] = await Promise.all([
        ctx.jsonRequest('/api/account/affiliate', { headers: mHeaders }),
        ctx.jsonRequest<{ items: Array<{ secret: string }> }>('/api/account/totp-vault', {
          headers: mHeaders,
        }),
        ctx.jsonRequest<{ bindings?: unknown[]; items?: unknown[] }>('/api/auth/oauth/bindings', {
          headers: mHeaders,
        }),
      ]);
      expect(affRes.status).toBe(200);
      expect(totpRes.status).toBe(200);
      expect(totpRes.data.items.some((i) => i.secret === 'JBSWY3DPEHPK3PXP')).toBe(true);
      expect(oauthRes.status).toBe(200);
      expect((oauthRes.data.bindings ?? oauthRes.data.items ?? []).length).toBeGreaterThanOrEqual(2);

      // 校验后台概览商品列表包含完整营销形态字段（确保商品编辑器「营销形态」可回显）
      const ovProducts =
        (
          ovRes.data as {
            products?: Array<{
              slug: string;
              is_hidden?: number;
              access_password?: string;
              flash_sale_price?: number | null;
              flash_sale_end_at?: string;
              bundle_items?: unknown[];
              group_buy_enabled?: number;
              group_buy_price?: number | null;
              allow_card_selection?: number;
              member_price?: number | null;
            }>;
          }
        ).products ?? [];
      const ovFlash = ovProducts.find((p) => p.slug === 'claude-flash-deal');
      const ovHidden = ovProducts.find((p) => p.slug === 'vip-secret-enterprise');
      const ovBundle = ovProducts.find((p) => p.slug === 'ai-dev-all-in-one-bundle');
      const ovGroup = ovProducts.find((p) => p.slug === 'netflix-group-buy');
      const ovPick = ovProducts.find((p) => p.slug === 'chatgpt-pick-seat');
      expect(ovFlash?.flash_sale_price).toBe(129);
      expect(Boolean(ovFlash?.flash_sale_end_at)).toBe(true);
      expect(ovHidden?.is_hidden).toBe(1);
      expect(ovHidden?.access_password).toBe('VIP2026');
      expect((ovBundle?.bundle_items ?? []).length).toBeGreaterThanOrEqual(2);
      expect(ovGroup?.group_buy_enabled).toBe(1);
      expect(ovGroup?.group_buy_price).toBe(19.9);
      expect(ovPick?.allow_card_selection).toBe(1);
      expect(ovPick?.member_price).toBe(128);

      // 校验分站 @nebula 独立域名下展示自有私有商品且不影响主站目录，且后台私有商品列表可见
      const subProds = await ctx.jsonRequest<{ items: Array<{ slug: string }> }>(
        'https://nebula.accthub.demo/api/storefront/products?category=all'
      );
      expect(subProds.status).toBe(200);
      expect(subProds.data.items.some((p) => p.slug === 'nebula-gpu-relay-pro')).toBe(true);
      expect(prodRes.data.items.some((p) => p.slug === 'nebula-gpu-relay-pro')).toBe(false);

      const nebLogin = await ctx.jsonRequest<{ token: string }>(
        'https://nebula.accthub.demo/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'nebula@accthub.dev', password: 'demo123456' }),
        }
      );
      expect(nebLogin.status).toBe(200);
      const nebPrivRes = await ctx.jsonRequest<{
        items: Array<{ slug: string }>;
        categories?: Array<{ id: number; name: string }>;
      }>('https://nebula.accthub.demo/api/agent/private-products', {
        headers: { Authorization: `Bearer ${nebLogin.data.token}` },
      });
      expect(nebPrivRes.status).toBe(200);
      expect(nebPrivRes.data.items.some((p) => p.slug === 'nebula-gpu-relay-pro')).toBe(true);
      expect((nebPrivRes.data.categories ?? []).length).toBeGreaterThan(0);

      // 校验 L1 代理 @studio 在分站工作台能查到下级代理（L2 @aurora）及多级分润流水
      const stLogin = await ctx.jsonRequest<{ token: string }>('https://studio.accthub.demo/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'demo@accthub.dev', password: 'demo123456' }),
      });
      expect(stLogin.status).toBe(200);
      const stHeaders = { Authorization: `Bearer ${stLogin.data.token}` };
      const stMe = await ctx.jsonRequest<{
        agent: { slug: string; total_commission: number };
        downlines?: Array<{ slug: string }>;
        commissions?: unknown[];
      }>('https://studio.accthub.demo/api/agent/me', { headers: stHeaders });
      expect(stMe.status).toBe(200);
      expect(stMe.data.agent.slug).toBe('studio');
      expect(stMe.data.agent.total_commission).toBe(50); // 32(L1) + 10(L2极差) + 8(L3隔代极差) + 18 - 18 = 50
    } finally {
      ctx.close();
    }
  });
});
