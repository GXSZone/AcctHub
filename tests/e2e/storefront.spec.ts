import type { APIRequestContext } from '@playwright/test';
import { expect, seededSession, tenantOrigin, test } from './browser-fixture';

async function loadAdminOrderNo(request: APIRequestContext, publicOrderNo: string) {
  const overview = await request.get('/api/admin/overview', {
    headers: { Authorization: `Bearer ${seededSession('admin')}` },
  });
  await expect(overview).toBeOK();
  const { orders } = (await overview.json()) as {
    orders: Array<{ order_no: string; public_order_no: string }>;
  };
  const order = orders.find((row) => row.public_order_no === publicOrderNo);
  if (!order) throw new Error(`总控订单列表中缺少 ${publicOrderNo}`);
  return order.order_no;
}

test.describe('AcctHub v3.0 端到端全站 6 大核心商业闭环与多语言回归验收', () => {
  test('1. 主站首页与按域懒加载 5 语种实时无缝切换（含 2FA 与订单页懒加载字典）', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();

    const langSelect = page.getByTestId('header-locale-select');
    await expect(langSelect).toBeVisible();

    // 切换为 English 并验证 2FA 与订单页按域懒加载英文命名空间
    await langSelect.selectOption('en');
    await expect(page.locator('header')).toContainText('Catalog');
    await expect(page.locator('header')).toContainText('Orders');

    await page.goto('/2fa');
    await expect(page.locator('body')).toContainText('2FA Authenticator');
    await expect(page.locator('body')).toContainText('Generate Code');

    await page.goto('/orders');
    await expect(page.locator('body')).toContainText('Lookup');

    // 切换为日本語
    await langSelect.selectOption('ja');
    await expect(page.locator('header')).toContainText('ストア');
    await expect(page.locator('body')).toContainText('照会する');

    // 切换为한국어
    await langSelect.selectOption('ko');
    await expect(page.locator('header')).toContainText('스토어');

    // 切换为繁體中文
    await langSelect.selectOption('zh-TW');
    await expect(page.locator('header')).toContainText('購物');

    // 切回简体中文
    await langSelect.selectOption('zh-CN');
    await expect(page.locator('header')).toContainText('购物');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('2. 游客异步收银台（易支付）沙盒模拟回调全链路发卡 + 财务对账守恒验收', async ({ request }) => {
    const adminToken = seededSession('admin');

    await request.put('/api/admin/mail-config', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        enabled: true,
        auto_send_order: true,
        provider: 'custom_webhook',
        from_name: 'AcctHub E2E',
        from_email: 'store@example.test',
        api_endpoint: process.env.ACCTHUB_E2E_MAIL_ENDPOINT,
      },
    });

    await request.put('/api/admin/payment-plugins/epay', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { enabled: true },
    });

    const prods = await request.get('/api/storefront/products?category=all');
    const prodData = (await prods.json()) as {
      items: Array<{ id: number; available_stock: number; specs: Array<{ id: string }> }>;
    };
    const candidates = prodData.items.filter((p) => Number(p.available_stock) > 0);
    expect(candidates.length).toBeGreaterThan(0);

    let createRes: Awaited<ReturnType<typeof request.post>> | null = null;
    for (const prod of candidates) {
      for (const spec of prod.specs) {
        const attempt = await request.post('/api/orders', {
          data: {
            product_id: prod.id,
            spec_id: spec.id,
            quantity: 1,
            contact_email: `e2e_${Date.now()}@accthub.dev`,
            payment_method: 'epay',
          },
        });
        if (attempt.ok()) {
          createRes = attempt;
          break;
        }
      }
      if (createRes) break;
    }
    expect(createRes?.ok()).toBe(true);
    const created = (await createRes?.json()) as {
      requires_payment: boolean;
      order: { order_no: string; status: string };
      payment_intent: { intent_no: string; status: string; view_token: string };
    };
    expect(created.requires_payment).toBe(true);
    expect(created.order.status).toBe('pending_payment');
    expect(created.payment_intent.status).toBe('pending');

    const simRes = await request.post('/api/payments/sandbox/simulate-pay', {
      data: { intent_no: created.payment_intent.intent_no },
    });
    expect(simRes.ok()).toBe(true);

    const pollRes = await request.get(`/api/payments/intents/${created.payment_intent.intent_no}`, {
      headers: { 'X-Intent-Token': created.payment_intent.view_token },
    });
    expect(pollRes.ok()).toBe(true);
    const polled = (await pollRes.json()) as {
      intent: { status: string };
      order: { status: string; delivered_payload: string };
    };
    expect(polled.intent.status).toBe('paid');
    expect(['delivered', 'paid', 'upstream_pending']).toContain(polled.order.status);

    const finRes = await request.get('/api/admin/finance/reconciliation?days=30', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(finRes.ok()).toBe(true);
    const fin = (await finRes.json()) as {
      integrity_checks: Array<{ key: string; passed: boolean }>;
    };
    expect(fin.integrity_checks.length).toBe(7);
    for (const chk of fin.integrity_checks) {
      expect(chk.passed).toBe(true);
    }

    const csvRes = await request.get('/api/admin/finance/reconciliation/csv?days=30', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(csvRes.ok()).toBe(true);
    const csvText = await csvRes.text();
    expect(csvText).toContain('订单号');
    expect(csvText).toContain(`"${await loadAdminOrderNo(request, created.order.order_no)}"`);
  });

  test('3. 核心页面（2FA 工具 / API 文档 / 代理引导 / 订单查询）加载渲染零报错', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/2fa');
    await expect(page.locator('body')).toContainText(/2FA|TOTP|验证码/);

    await page.goto('/docs');
    await expect(page.locator('body')).toContainText(/API|Reseller|Open/);

    await page.goto('/agent');
    await expect(page.locator('body')).toContainText(/代理|分站/);

    await page.goto('/orders');
    await expect(page.locator('body')).toContainText(/订单/);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('4. 运营总控后台解锁、财务对账、商品编辑器与上游中枢全链路切换零报错', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const token = seededSession('admin');

    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('accthub_token', t);
    }, token);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '运营概览' })).toBeVisible({ timeout: 15000 });

    for (const label of [
      '商品与卡密',
      '分组与分类',
      '财务对账',
      '上游对接',
      'AI 文案引擎',
      '内容与公告',
      '操作审计',
    ]) {
      await page
        .getByRole('button', { name: new RegExp(label) })
        .first()
        .click();
      await expect(page.getByRole('heading', { name: label })).toBeVisible({ timeout: 10000 });
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('5. 会员注册→CDK充值→钱包余额下单发卡→会员中心查单→售后工单与总控回复闭环', async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1) 总控签发一张 ¥500 充值卡密 CDK
    const adminToken = seededSession('admin');

    const cdkRes = await request.post('/api/admin/cdks/generate', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { amount: 500, count: 1, batch_note: 'E2E 会员闭环测试' },
    });
    expect(cdkRes.ok()).toBe(true);
    const { generated } = (await cdkRes.json()) as { generated: string[] };
    expect(generated.length).toBe(1);

    // 2) 注册全新会员并兑换 CDK
    const memberEmail = `member_e2e_${Date.now()}@accthub.dev`;
    const regRes = await request.post('/api/auth/register', {
      data: { email: memberEmail, password: 'MemberPass#2026', display_name: 'E2E 会员' },
    });
    expect(regRes.ok()).toBe(true);
    const { token: memberToken } = (await regRes.json()) as { token: string };

    const redeemRes = await request.post('/api/account/redeem-cdk', {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: { code: generated[0] },
    });
    expect(redeemRes.ok()).toBe(true);
    const redeemData = (await redeemRes.json()) as { balance: number };
    expect(redeemData.balance).toBeGreaterThanOrEqual(500);

    // 3) 使用站内钱包余额下单自动发卡
    const prods = await request.get('/api/storefront/products?category=all');
    const prodData = (await prods.json()) as {
      items: Array<{ id: number; available_stock: number; specs: Array<{ id: string }> }>;
    };
    const candidates = prodData.items.filter((p) => Number(p.available_stock) > 0);
    let orderNo = '';
    for (const prod of candidates) {
      for (const spec of prod.specs) {
        const res = await request.post('/api/orders', {
          headers: { Authorization: `Bearer ${memberToken}` },
          data: {
            product_id: prod.id,
            spec_id: spec.id,
            quantity: 1,
            contact_email: memberEmail,
            payment_method: 'balance',
          },
        });
        if (res.ok()) {
          const data = (await res.json()) as { order: { order_no: string; status: string } };
          orderNo = data.order.order_no;
          expect(['delivered', 'paid', 'upstream_pending']).toContain(data.order.status);
          break;
        }
      }
      if (orderNo) break;
    }
    expect(orderNo).toBeTruthy();

    // 4) 发起售后工单并由总控回复完结
    const ticketRes = await request.post('/api/account/tickets', {
      headers: { Authorization: `Bearer ${memberToken}` },
      data: {
        order_no: orderNo,
        category: 'after_sale',
        subject: `订单 ${orderNo} 售后回归核验`,
        content: '请协助核验账号质保状态。',
      },
    });
    expect(ticketRes.ok()).toBe(true);
    const ticketJson = (await ticketRes.json()) as { ticket?: { id: number }; id?: number };
    const ticketId = ticketJson.ticket?.id ?? ticketJson.id;
    expect(ticketId).toBeTruthy();

    const replyRes = await request.post(`/api/admin/tickets/${ticketId}/reply`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { content: '已核验通过，账号处于在保状态。', status: 'resolved' },
    });
    expect(replyRes.ok()).toBe(true);

    // 5) 在真实浏览器中以该会员身份打开会员中心与工单页，验证订单与工单可视化渲染
    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('accthub_token', t);
    }, memberToken);

    await page.goto('/account/orders');
    await expect(page.locator('body')).toContainText(orderNo, { timeout: 15000 });

    await page.goto('/account/tickets');
    await expect(page.locator('body')).toContainText(`订单 ${orderNo} 售后回归核验`, {
      timeout: 15000,
    });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('6. 多级代理白标分站（studio.localhost）品牌展示、跨站 SSO 自治工作台与分站下单分润守恒闭环', async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const studioUrl = tenantOrigin('studio');

    // 1) 真实浏览器访问白标分站独立子域 studio.localhost，确认独立分站品牌渲染
    await page.goto(`${studioUrl}/`);
    await expect(page.locator('header')).toContainText('星尘 AI 研选社', { timeout: 15000 });

    // 2) 在分站独立域名下通过浏览器同源 fetch 注册会员并完成一次下单（验证多租户加价与分润记账）
    const tenantOrderNo = await page.evaluate(async () => {
      const email = `studio_buyer_${Date.now()}@accthub.dev`;
      const regRes = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'StudioBuyer#2026' }),
      });
      if (!regRes.ok) throw new Error(`分站注册失败 (${regRes.status})`);
      const { token } = (await regRes.json()) as { token: string };

      const prodsRes = await fetch('/api/storefront/products?category=all');
      if (!prodsRes.ok) throw new Error(`分站目录加载失败 (${prodsRes.status})`);
      const prodData = (await prodsRes.json()) as {
        items: Array<{ id: number; available_stock: number; specs: Array<{ id: string }> }>;
      };
      const candidates = prodData.items.filter((p) => Number(p.available_stock) > 0);
      for (const prod of candidates) {
        for (const spec of prod.specs) {
          const orderRes = await fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              product_id: prod.id,
              spec_id: spec.id,
              quantity: 1,
              contact_email: email,
              payment_method: 'demo_instant',
            }),
          });
          if (orderRes.ok) {
            const json = (await orderRes.json()) as { order: { order_no: string } };
            return json.order.order_no;
          }
        }
      }
      return '';
    });
    expect(tenantOrderNo).toBeTruthy();

    // 3) 登录示例代理账号并在主站签发一次性 SSO 票据直达分站自治工作台，确认分站面板渲染零报错
    const agentToken = seededSession('agent');
    const ssoRes = await request.post('/api/auth/sso/issue', {
      headers: { Authorization: `Bearer ${agentToken}` },
      data: { redirect_path: '/agent' },
    });
    expect(ssoRes.ok()).toBe(true);
    const { redirect_url: ssoRedirectUrl } = (await ssoRes.json()) as { redirect_url: string };

    await page.goto(ssoRedirectUrl);
    await expect(page).toHaveURL(new RegExp(`^${studioUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/agent`), {
      timeout: 15000,
    });
    await expect(page.locator('body')).toContainText('星尘 AI 研选社', { timeout: 15000 });

    // 4) 总控财务对账校验：包含 studio 租户维度且 7 项资金守恒巡检全部通过
    const adminToken = seededSession('admin');
    const finRes = await request.get('/api/admin/finance/reconciliation?days=30', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(finRes.ok()).toBe(true);
    const fin = (await finRes.json()) as {
      by_tenant: Array<{ tenant_slug: string }>;
      integrity_checks: Array<{ key: string; passed: boolean }>;
    };
    expect(fin.by_tenant.some((t) => t.tenant_slug === 'studio')).toBe(true);
    for (const chk of fin.integrity_checks) {
      expect(chk.passed).toBe(true);
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('7. 增长基建闭环：推广链接 ?ref= 自动归因、会员邀请中心、分站自定义主题色与页脚生效', async ({
    page,
    request,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1) 创建会员 A 并获取专属推荐码
    const emailA = `m3_ref_${Date.now()}@accthub.dev`;
    const regARes = await request.post('/api/auth/register', {
      data: { email: emailA, password: 'Password123', display_name: 'M3推荐会员' },
    });
    expect(regARes.ok()).toBe(true);
    const regAData = (await regARes.json()) as { token: string; user: { referral_code?: string } };
    expect(regAData.user.referral_code).toBeTruthy();

    // 2) 通过 /?ref=CODE 访问前台并验证 localStorage 捕获推荐码 + 会员「邀请有礼」面板渲染
    await page.goto(`/?ref=${regAData.user.referral_code}`);
    const savedRef = await page.evaluate(() => localStorage.getItem('accthub_ref_code'));
    expect(savedRef).toBe(regAData.user.referral_code);

    await page.evaluate((t) => localStorage.setItem('accthub_token', t), regAData.token);
    await page.goto('/account/affiliate');
    await expect(page.locator('body')).toContainText('邀请有礼 · 推广消费金', { timeout: 15000 });
    await expect(page.locator('body')).toContainText(regAData.user.referral_code || '');

    // 3) 在分站独立域名下通过 SSO 免登配置示例代理分站 studio 自定义主题色与页脚文案并验证实时 CSS 变量注入
    const studioUrl = tenantOrigin('studio');
    const agentToken = seededSession('agent');
    const ssoRes = await request.post('/api/auth/sso/issue', {
      headers: { Authorization: `Bearer ${agentToken}` },
      data: { redirect_path: '/agent' },
    });
    expect(ssoRes.ok()).toBe(true);
    const { redirect_url: ssoUrl } = (await ssoRes.json()) as { redirect_url: string };
    await page.goto(ssoUrl);
    await expect(page).toHaveURL(new RegExp(`^${studioUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/agent`), {
      timeout: 15000,
    });
    const updOk = await page.evaluate(async () => {
      const token = localStorage.getItem('accthub_token') || '';
      const r = await fetch('/api/agent/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          theme_accent: '#2D6A57',
          seo_title: '星尘独立SEO测试标题',
          footer_text: '© 2026 星尘M3白标页脚',
        }),
      });
      return r.ok;
    });
    expect(updOk).toBe(true);

    await page.goto(`${studioUrl}/`);
    await expect(page).toHaveTitle(/星尘独立SEO测试标题/);
    await expect(page.locator('footer')).toContainText('© 2026 星尘M3白标页脚');
    const accentVal = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent').trim().toUpperCase()
    );
    expect(accentVal).toBe('#2D6A57');

    // 恢复主站访问以确认主题色变量正常清理回默认赤陶色
    await page.goto('/');
    const mainAccentVal = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--accent').trim()
    );
    expect(mainAccentVal).toBe('');

    // 4) 注册下级受邀会员 B 触发首单推广返利 -> 会员 A 使用推广消费金抵扣下单 -> 管理员退款追缴与资金守恒
    const emailB = `m3_invitee_${Date.now()}@accthub.dev`;
    const regBRes = await request.post('/api/auth/register', {
      data: {
        email: emailB,
        password: 'Password123',
        display_name: 'M3受邀会员B',
        referral_code: regAData.user.referral_code,
      },
    });
    expect(regBRes.ok()).toBe(true);
    const { token: tokenB } = (await regBRes.json()) as { token: string };

    const prodsRes = await request.get('/api/storefront/products?category=all');
    const prodsJson = (await prodsRes.json()) as {
      items: Array<{ id: number; available_stock: number; specs: Array<{ id: string; price: number }> }>;
    };
    const buyable = prodsJson.items.filter((p) => Number(p.available_stock) > 0 && p.specs.length > 0);
    expect(buyable.length).toBeGreaterThan(0);

    let orderBNo = '';
    for (const prod of buyable) {
      for (const spec of prod.specs) {
        const qty = Math.max(
          1,
          Math.min(Number(prod.available_stock), Math.ceil(20 / Math.max(1, spec.price)))
        );
        const res = await request.post('/api/orders', {
          headers: { Authorization: `Bearer ${tokenB}` },
          data: {
            product_id: prod.id,
            spec_id: spec.id,
            quantity: qty,
            contact_email: emailB,
            payment_method: 'demo_instant',
          },
        });
        if (res.ok()) {
          const j = (await res.json()) as { order: { order_no: string; status: string } };
          orderBNo = j.order.order_no;
          break;
        }
      }
      if (orderBNo) break;
    }
    expect(orderBNo).toBeTruthy();

    const affRes = await request.get('/api/account/affiliate', {
      headers: { Authorization: `Bearer ${regAData.token}` },
    });
    expect(affRes.ok()).toBe(true);
    const affData = (await affRes.json()) as { promo_balance: number; referred_count: number };
    expect(affData.referred_count).toBeGreaterThanOrEqual(1);
    expect(affData.promo_balance).toBeGreaterThan(0);

    const adminToken = seededSession('admin');
    const cdk = await request.post('/api/admin/cdks/generate', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { amount: 500, count: 1, batch_note: 'E2E 推广消费金退款' },
    });
    await expect(cdk).toBeOK();
    const { generated } = (await cdk.json()) as { generated: string[] };
    await expect(
      await request.post('/api/account/redeem-cdk', {
        headers: { Authorization: `Bearer ${regAData.token}` },
        data: { code: generated[0] },
      })
    ).toBeOK();

    let orderANo = '';
    for (const prod of buyable) {
      for (const spec of prod.specs) {
        const res = await request.post('/api/orders', {
          headers: { Authorization: `Bearer ${regAData.token}` },
          data: {
            product_id: prod.id,
            spec_id: spec.id,
            quantity: 1,
            contact_email: emailA,
            payment_method: 'balance',
            use_promo_balance: true,
          },
        });
        if (res.ok()) {
          const j = (await res.json()) as { order: { order_no: string; promo_used_amount?: number } };
          orderANo = j.order.order_no;
          expect(Number(j.order.promo_used_amount || 0)).toBeGreaterThan(0);
          break;
        }
      }
      if (orderANo) break;
    }
    expect(orderANo).toBeTruthy();

    const refundARes = await request.post(`/api/admin/orders/${orderANo}/refund`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {},
    });
    await expect(refundARes).toBeOK();
    expect(await refundARes.json()).toMatchObject({ refund: { route: 'wallet', status: 'succeeded' } });

    const finCheckRes = await request.get('/api/admin/finance/reconciliation?days=30', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(finCheckRes.ok()).toBe(true);
    const finCheck = (await finCheckRes.json()) as {
      integrity_checks: Array<{ key: string; passed: boolean }>;
    };
    expect(finCheck.integrity_checks.length).toBe(7);
    for (const chk of finCheck.integrity_checks) {
      expect(chk.passed).toBe(true);
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('8. 全站 5 语种按域懒加载总控巡检：切换 English/日本語 解锁 /admin 遍历核心模块零报错', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const token = seededSession('admin');

    await page.goto('/');
    await page.evaluate((t) => {
      localStorage.setItem('accthub_token', t);
      localStorage.setItem('accthub_lang', 'en');
    }, token);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15000 });

    for (const label of ['Products & Keys', 'Upstreams', 'Notices', 'Finance', 'Audit Logs']) {
      await page
        .locator('aside')
        .getByRole('button', { name: new RegExp(label) })
        .first()
        .click();
      await expect(page.getByRole('heading', { name: label })).toBeVisible({ timeout: 10000 });
    }

    const langSelect = page.getByTestId('header-locale-select');
    await langSelect.selectOption('ja');
    await expect(
      page
        .locator('aside')
        .getByRole('button', { name: /上流連携/ })
        .first()
    ).toBeVisible({ timeout: 10000 });
    await page
      .locator('aside')
      .getByRole('button', { name: /上流連携/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: '上流連携' })).toBeVisible({ timeout: 10000 });

    await page
      .locator('aside')
      .getByRole('button', { name: /コンテンツ・お知らせ/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'コンテンツ・お知らせ' })).toBeVisible({ timeout: 10000 });

    await langSelect.selectOption('zh-CN');
    await expect(
      page
        .locator('aside')
        .getByRole('button', { name: /运营概览/ })
        .first()
    ).toBeVisible({ timeout: 10000 });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
