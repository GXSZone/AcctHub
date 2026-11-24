import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agents,
  agentTiers,
  categories,
  categoryGroups,
  paymentIntents,
  paymentPlugins,
  productCards,
  products,
  upstreamSources,
  users,
} from '../../worker/db/schema/index';
import { signAlipayRsa2 } from '../../worker/domains/payment/payment.gateway';
import { signUpstreamParams } from '../../worker/domains/upstream/upstream.signer';
import { encryptSecret, sha256Hex } from '../../worker/infra/crypto';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

describe('数据隐私与密钥安全回归：卡密遮罩 / 非开发隔离 / 密钥哈希与防重放 / 金额校验与随机码', () => {
  let ctx: TestAppContext;
  let productId: number;
  let seatProductId: number;
  let memberId: number;
  let memberToken: string;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp({ ADMIN_SECRET: 'batch3-admin-secret' });

    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'ai', name: 'AI 专区', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'gpt', name: 'ChatGPT', sortOrder: 1 })
      .returning();

    const [prod] = await ctx.db
      .insert(products)
      .values({
        categoryId: cat.id,
        slug: 'gpt-b3',
        title: 'ChatGPT Plus S1/S2',
        basePrice: 80,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'month', name: '月卡', price: 80 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;

    const [seatProd] = await ctx.db
      .insert(products)
      .values({
        categoryId: cat.id,
        slug: 'gpt-seat-b3',
        title: 'ChatGPT 车队席位',
        basePrice: 30,
        stockMode: 'seats',
        seatTotal: 5,
        seatUsed: 0,
        specsJson: JSON.stringify([{ id: 'seat', name: '单席位', price: 30 }]),
        isActive: 1,
      })
      .returning();
    seatProductId = seatProd.id;

    await ctx.db.insert(productCards).values([
      { productId: prod.id, specId: 'month', cardContent: 'B3-SECRET-CARD-001', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'B3-SECRET-CARD-002', status: 'available' },
      { productId: prod.id, specId: 'month', cardContent: 'B3-SECRET-CARD-003', status: 'available' },
    ]);

    await ctx.db.insert(paymentPlugins).values([
      { id: 'demo_instant', name: '演示收银台', description: '开发测试', enabled: 1 },
      {
        id: 'epay',
        name: '易支付',
        description: 'Epay',
        enabled: 1,
        configJson: JSON.stringify({ key: 'epay-b3' }),
      },
    ]);

    await ctx.db.insert(agentTiers).values({
      code: 'gold',
      name: '黄金代理',
      minRecharge: 100,
      discountRate: 0.85,
      commissionRate: 0.1,
      levelRank: 1,
    });

    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'member_b3@example.com', password: 'Password123!' }),
    });
    memberId = reg.data.user.id;
    memberToken = reg.data.token;
    await ctx.db.update(users).set({ balance: 500 }).where(eq(users.id, memberId));
  });

  afterEach(() => {
    ctx.close();
  });

  it('[S10][S21] 支付轮询仅向会员订单的归属账号返回订单内容', async () => {
    // 创建会员带查单口令的异步订单
    const created = await ctx.jsonRequest<{
      payment_intent: { intent_no: string; view_token?: string };
      order: { order_no: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'member_b3@example.com',
        query_password: 'pin-9527',
        payment_method: 'epay',
      }),
    });
    expect(created.status).toBe(200);
    const { intent_no: intentNo, view_token: viewToken } = created.data.payment_intent;
    expect(viewToken).toMatch(/^vt_/);

    await ctx.jsonRequest('/api/payments/sandbox/simulate-pay', {
      method: 'POST',
      body: JSON.stringify({ intent_no: intentNo }),
    });

    // 1.1 匿名凭 intentNo 轮询：锁定卡密、无余额、且绝不透出 view_token
    const anonPoll = await ctx.jsonRequest<{
      intent: Record<string, unknown>;
      order: { locked: boolean; delivered_payload: string };
      balance?: number;
    }>(`/api/payments/intents/${intentNo}`);
    expect(anonPoll.status).toBe(200);
    expect(anonPoll.data.intent).toEqual({ intent_no: intentNo, status: 'paid' });
    expect(anonPoll.data.balance).toBeUndefined();
    expect(anonPoll.data.order).toEqual({ locked: true });

    // 会员订单不能只凭收银台令牌查询或主动核单。
    const tokenWithoutPass = await ctx.jsonRequest<{
      intent: Record<string, unknown>;
      order: { locked: boolean; delivered_payload: string };
      balance?: number;
    }>(`/api/payments/intents/${intentNo}`, {
      headers: { 'X-Intent-Token': String(viewToken) },
    });
    expect(tokenWithoutPass.status).toBe(200);
    expect(tokenWithoutPass.data.intent).toEqual({ intent_no: intentNo, status: 'paid' });
    expect(tokenWithoutPass.data.order.locked).toBe(true);
    expect(tokenWithoutPass.data.balance).toBeUndefined();
    const deniedCheck = await ctx.jsonRequest(`/api/payments/intents/${intentNo}/check`, {
      method: 'POST',
      headers: { 'X-Intent-Token': String(viewToken) },
    });
    expect(deniedCheck.status).toBe(404);

    // 1.4 订单归属会员登录后查询 -> 解锁卡密并返回个人余额
    const ownerPoll = await ctx.jsonRequest<{
      order: { locked: boolean; delivered_payload: string };
      balance?: number;
    }>(`/api/payments/intents/${intentNo}`, {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(ownerPoll.status).toBe(200);
    expect(ownerPoll.data.order.locked).toBe(false);
    expect(ownerPoll.data.order.delivered_payload).toContain('B3-SECRET-CARD-');
    expect(ownerPoll.data.balance).toBe(500);
  });

  it('[S10][S21] 会员订单仅归属人读取，游客使用单独查单号', async () => {
    const lookup = (q: string, headers?: HeadersInit) =>
      ctx.jsonRequest<{ orders: Array<{ locked: boolean; delivered_payload: string }> }>(
        '/api/orders/lookup',
        { method: 'POST', headers, body: JSON.stringify({ q }) }
      );
    // 2.1 会员无口令订单（userId !== null）
    const memberOrd = await ctx.jsonRequest<{ order: { order_no: string } }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'member_b3@example.com',
        payment_method: 'balance',
      }),
    });
    expect(memberOrd.status).toBe(200);
    const memberOrderNo = memberOrd.data.order.order_no;

    expect((await lookup('member_b3@example.com')).data.orders).toEqual([]);
    expect((await lookup(memberOrderNo)).data.orders).toEqual([]);

    // 本人携带 JWT 查单 -> 解锁
    const ownerLookup = await lookup(memberOrderNo, { Authorization: `Bearer ${memberToken}` });
    expect(ownerLookup.data.orders[0].locked).toBe(false);
    expect(ownerLookup.data.orders[0].delivered_payload).toContain('B3-SECRET-CARD-');

    // 2.2 纯游客无口令订单（userId === null，先启用站点自动发信邮箱允许游客下单）
    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHub',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-relay.example.com/send',
    });
    const mailSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const guestNoPass = await ctx.jsonRequest<{ order: { order_no: string } }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'month',
        quantity: 1,
        contact_email: 'guest_open@example.com',
        payment_method: 'demo_instant',
      }),
    });
    mailSpy.mockRestore();
    expect(guestNoPass.status).toBe(200);
    const guestOpenNo = guestNoPass.data.order.order_no;

    expect((await lookup('guest_open@example.com')).data.orders).toEqual([]);

    // 凭高熵精确单号查询 -> 解锁
    const guestByNo = await lookup(guestOpenNo);
    expect(guestByNo.data.orders[0].locked).toBe(false);
    expect(guestByNo.data.orders[0].delivered_payload).toContain('B3-SECRET-CARD-');
  });

  it('3. [S3] staging 环境强隔离：强制禁沙盒、拒绝默认/弱管理员秘钥、未配强 JWT_SECRET 直接拦截', async () => {
    const weakStaging = createTestApp({
      APP_ENV: 'staging',
      SANDBOX_MODE: undefined,
      ADMIN_SECRET: 'accthub-admin',
      JWT_SECRET: 'accthub-edge-hmac-secret-change-in-prod',
    });

    try {
      // 3.1 沙盒回调在 staging 默认禁用并隐藏（返回 404）
      const sbxRes = await weakStaging.jsonRequest<{ code?: string }>('/api/payments/sandbox/simulate-pay', {
        method: 'POST',
        body: JSON.stringify({ intent_no: 'PAYANYTHING' }),
      });
      expect(sbxRes.status).toBe(404);

      // 3.2 显式使用默认弱管理员口令 'accthub-admin' 在 staging 下访问总控/上游一律返回 403
      const adminOverviewRes = await weakStaging.jsonRequest('/api/admin/overview', {
        headers: { 'X-Admin-Secret': 'accthub-admin' },
      });
      expect(adminOverviewRes.status).toBe(403);

      const upstreamAdminRes = await weakStaging.jsonRequest('/api/admin/upstreams', {
        headers: { 'X-Admin-Secret': 'accthub-admin' },
      });
      expect(upstreamAdminRes.status).toBe(403);

      // 3.3 setup 状态识别 staging 为非 dev/test (is_production: true)，弱口令初始化返回错误
      const setupStatus = await weakStaging.jsonRequest<{ is_production: boolean }>('/api/setup/status');
      expect(setupStatus.status).toBe(200);
      expect(setupStatus.data.is_production).toBe(true);

      const setupInit = await weakStaging.jsonRequest<{ code: string }>('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'accthub-admin',
          admin_email: 'admin_stg@example.com',
          admin_password: 'StrongPassword123!',
          admin_display_name: 'StagingAdmin',
          brand_name: 'AcctHub Stg',
          brand_tagline: 'Staging',
        }),
      });
      expect(setupInit.status).toBe(500);
      expect(setupInit.data.code).toBe('CONFIGURATION_ERROR');

      // 3.4 注册用户在 staging 使用默认 JWT_SECRET 时签发 Token 触发配置拦截（非 200 降级）
      const regFail = await weakStaging.jsonRequest<{ code: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'stg_fail@example.com', password: 'Password123!' }),
      });
      expect(regFail.status).toBe(500);
      expect(regFail.data.code).toBe('CONFIGURATION_ERROR');
    } finally {
      weakStaging.close();
    }

    // 3.5 配置强密钥的 staging 实例总控与登录均正常放行，且仍不开启沙盒体验金
    const strongStaging = createTestApp({
      APP_ENV: 'staging',
      SANDBOX_MODE: undefined,
      ADMIN_SECRET: 'Staging-Strong-Admin-Secret-2026!',
      JWT_SECRET: 'Staging-Strong-JWT-Secret-At-Least-32-Chars!',
    });
    try {
      const setupSecretDenied = await strongStaging.jsonRequest('/api/admin/overview', {
        headers: { 'X-Admin-Secret': 'Staging-Strong-Admin-Secret-2026!' },
      });
      expect(setupSecretDenied.status).toBe(403);
      const adminOk = await strongStaging.jsonRequest('/api/admin/overview', {
        headers: await strongStaging.adminHeaders(),
      });
      expect(adminOk.status).toBe(200);

      const regOk = await strongStaging.jsonRequest<{ user: { balance: number } }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: 'stg_ok@example.com', password: 'Password123!' }),
      });
      expect(regOk.status).toBe(200);
      expect(regOk.data.user.balance).toBe(0); // staging 禁沙盒注册不送体验金
    } finally {
      strongStaging.close();
    }
  });

  it('4. [S9] B2B API Key 哈希+密文隔离存储与禁 URL ?api_key= 传参，以及上游回调密钥隔离、防降级 MD5 与防重放', async () => {
    // 4.1 开通代理 -> 检查数据库中 api_key 列脱敏、api_key_hash 与 api_key_enc 入库、本人面板可读明文
    const applyRes = await ctx.jsonRequest<{ agent: { id: number; api_key: string; slug: string } }>(
      '/api/agent/recharge',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ amount: 150, slug: 'b3agent' }),
      }
    );
    expect(applyRes.status).toBe(200);
    const plainKey = applyRes.data.agent.api_key;
    expect(plainKey).toMatch(/^ah_/);

    const dbAgent = (await ctx.db.select().from(agents).where(eq(agents.id, applyRes.data.agent.id)))[0];
    expect(dbAgent.apiKey).not.toBe(plainKey);
    expect(dbAgent.apiKey).not.toContain(dbAgent.apiKeyHash.slice(0, 8));
    expect(dbAgent.apiKeyHash).toBe(await sha256Hex(plainKey));
    expect(dbAgent.apiKeyEnc.length).toBeGreaterThan(20);

    // 轮换 Key 后旧 Key 立即失效，新 Key 正常鉴权（分站写操作必须在自身分站域名下执行）
    const rotateRes = await ctx.jsonRequest<{ api_key: string }>(
      `http://${applyRes.data.agent.slug}.localhost/api/agent/rotate-key`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberToken}` },
      }
    );
    expect(rotateRes.status).toBe(200);
    const rotatedKey = rotateRes.data.api_key;
    expect(rotatedKey).not.toBe(plainKey);

    // 本人查询 /api/agent/me 可解密拿回明文新 Key
    const meAgent = await ctx.jsonRequest<{ agent: { api_key: string } }>('/api/agent/me', {
      headers: { Authorization: `Bearer ${memberToken}` },
    });
    expect(meAgent.status).toBe(200);
    expect(meAgent.data.agent.api_key).toBe(rotatedKey);

    // 4.2 URL ?api_key= 传参被强制 401 拒绝，必须走 Bearer 或 X-API-Key 请求头
    const qsRes = await ctx.jsonRequest<{ error: string }>(
      `/api/v1/reseller/balance?api_key=${encodeURIComponent(rotatedKey)}`
    );
    expect(qsRes.status).toBe(401);
    expect(qsRes.data.error).toContain('disabled');

    const headerRes = await ctx.jsonRequest<{ agent_slug: string }>('/api/v1/reseller/balance', {
      headers: { 'X-API-Key': rotatedKey },
    });
    expect(headerRes.status).toBe(200);
    expect(headerRes.data.agent_slug).toBe(applyRes.data.agent.slug);

    const oldKeyRes = await ctx.jsonRequest('/api/v1/reseller/balance', {
      headers: { Authorization: `Bearer ${plainKey}` },
    });
    expect(oldKeyRes.status).toBe(401);

    // 4.3 上游 Webhook：未配独立 webhookSecret/apiSecret（即使配了 apiKey）必被拒
    const apiKeyEnc = await encryptSecret(ctx.env, 'outbound-api-key-only');
    const [noWhSrc] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: 'S9 仅配ApiKey源',
        adapterType: 'generic_json',
        authMode: 'hmac_sha256',
        baseUrl: 'https://up-s9-a.local',
        apiKeyEnc,
        status: 'active',
      })
      .returning();

    const noWhPayload: Record<string, unknown> = { out_trade_no: 'ANY-1', status: 'succeeded' };
    noWhPayload.sign = await signUpstreamParams('hmac_sha256', noWhPayload, 'outbound-api-key-only');
    const noWhRes = await ctx.jsonRequest<{ error: string }>(`/api/webhooks/upstream/${noWhSrc.id}`, {
      method: 'POST',
      body: JSON.stringify(noWhPayload),
    });
    expect(noWhRes.status).toBe(401);

    // 4.4 配置独立 webhookSecret 且 auth_mode='hmac_sha256'：禁止 MD5 算法降级 + 拦截 >5 分钟过期时间戳
    const whSecEnc = await encryptSecret(ctx.env, 's9-webhook-secret-xyz');
    const [hmacSrc] = await ctx.db
      .insert(upstreamSources)
      .values({
        name: 'S9 HMAC 防重放源',
        adapterType: 'generic_json',
        authMode: 'hmac_sha256',
        baseUrl: 'https://up-s9-b.local',
        webhookSecretEnc: whSecEnc,
        status: 'active',
      })
      .returning();

    const md5DowngradeBody: Record<string, unknown> = { out_trade_no: 'NONE-1', status: 'succeeded' };
    md5DowngradeBody.sign = await signUpstreamParams(
      'acgfaka_sign',
      md5DowngradeBody,
      's9-webhook-secret-xyz'
    );
    const md5Res = await ctx.jsonRequest<{ error: string }>(`/api/webhooks/upstream/${hmacSrc.id}`, {
      method: 'POST',
      body: JSON.stringify(md5DowngradeBody),
    });
    expect(md5Res.status).toBe(401);

    const staleTsSec = Math.floor(Date.now() / 1000) - 600;
    const staleBody: Record<string, unknown> = {
      out_trade_no: 'NONE-1',
      status: 'succeeded',
      timestamp: staleTsSec,
    };
    staleBody.sign = await signUpstreamParams('hmac_sha256', staleBody, 's9-webhook-secret-xyz');
    const staleRes = await ctx.jsonRequest<{ error: string }>(`/api/webhooks/upstream/${hmacSrc.id}`, {
      method: 'POST',
      body: JSON.stringify(staleBody),
    });
    expect(staleRes.status).toBe(401);
    expect(staleRes.data.error).toContain('时间戳');
  });

  it('5. [S10] 支付宝回调缺失或无效 total_amount 即使 RSA2 签名合法也拦截 + 拼车席位 CSPRNG PIN', async () => {
    // 5.1 生成一对测试 RSA-2048 密钥配置到 alipay_f2f，构造有效 RSA2 签名但缺失 total_amount 的回调
    const kp = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const privPem = arrayBufferToBase64(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const pubPem = arrayBufferToBase64(await crypto.subtle.exportKey('spki', kp.publicKey));

    await ctx.db
      .insert(paymentPlugins)
      .values({
        id: 'alipay_f2f',
        name: '支付宝当面付',
        description: 'RSA2 测试',
        enabled: 1,
        configJson: JSON.stringify({ app_id: '2026000000000001', alipay_public_key: pubPem }),
      })
      .onConflictDoUpdate({
        target: paymentPlugins.id,
        set: {
          enabled: 1,
          configJson: JSON.stringify({ app_id: '2026000000000001', alipay_public_key: pubPem }),
        },
      });

    await ctx.db.insert(paymentIntents).values({
      intentNo: 'PAYALIPAYB301',
      bizType: 'wallet_recharge',
      bizRef: `R-${memberId}`,
      userId: memberId,
      siteAgentId: 0,
      provider: 'alipay_f2f',
      currency: 'CNY',
      amountCny: 99,
      payAmount: 99,
      status: 'pending',
      fulfillStatus: 'pending',
      expiresAt: '2099-01-01 00:00:00',
    });

    const missingAmtParams: Record<string, string> = {
      app_id: '2026000000000001',
      out_trade_no: 'PAYALIPAYB301',
      trade_no: 'ALI-NO-AMT-01',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'RSA2',
    };
    missingAmtParams.sign = await signAlipayRsa2(missingAmtParams, privPem);

    const alipayRes = await ctx.request('/api/payments/webhook/alipay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(missingAmtParams).toString(),
    });
    expect(alipayRes.status).toBe(400);
    expect(await alipayRes.text()).toBe('failure');

    const intentAfter = (
      await ctx.db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, 'PAYALIPAYB301'))
    )[0];
    expect(intentAfter.status).toBe('pending');

    // 5.2 拼车席位下单验证生成 4 位安全随机 PIN
    const seatOrd = await ctx.jsonRequest<{
      order: { status: string; delivered_payload: string };
    }>('/api/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}` },
      body: JSON.stringify({
        product_id: seatProductId,
        spec_id: 'seat',
        quantity: 2,
        contact_email: 'member_b3@example.com',
        payment_method: 'balance',
      }),
    });
    expect(seatOrd.status).toBe(200);
    expect(seatOrd.data.order.status).toBe('delivered');
    const pinMatches = seatOrd.data.order.delivered_payload.match(/专属 PIN: \d{4}/g) || [];
    expect(pinMatches.length).toBe(2);
  });
});
