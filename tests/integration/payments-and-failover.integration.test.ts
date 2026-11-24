import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  categories,
  categoryGroups,
  orders,
  paymentPlugins,
  products,
  upstreamOrders,
} from '../../worker/db/schema/index';
import { signAlipayRsa2 } from '../../worker/domains/payment/payment.alipay';
import { syncLiveExchangeRates } from '../../worker/domains/payment/payment.fx';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { createTestApp } from './helpers/test-app';

function arrayBufferToPem(buf: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `-----BEGIN ${label}-----\n${btoa(bin)}\n-----END ${label}-----`;
}

describe('支付与货源容灾：支付宝 RSA2 回调、USDT 多链与实时汇率熔断、多上游主备 Failover', () => {
  it('支持支付宝当面付真实 RSA2 验签放货、实时汇率熔断与 USDT BEP20/ERC20 防撞单收单', async () => {
    const app = createTestApp({ ADMIN_SECRET: 'm2-test-admin-secret' });
    try {
      // 1. 初始化店铺和测试商品
      const initRes = await app.jsonRequest<{ token: string }>('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'm2-test-admin-secret',
          admin_email: 'admin@m2.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'M2PayTest',
        }),
      });
      expect(initRes.ok).toBe(true);
      const adminToken = initRes.data.token;

      const [grp] = await app.db
        .insert(categoryGroups)
        .values({ slug: 'g1', name: '测试分类', nameEn: 'Test', sortOrder: 1 })
        .returning({ id: categoryGroups.id });
      const [cat] = await app.db
        .insert(categories)
        .values({ groupId: grp.id, slug: 'c1', name: '测试子类', nameEn: 'Sub', sortOrder: 1 })
        .returning({ id: categories.id });
      const [prod] = await app.db
        .insert(products)
        .values({
          categoryId: cat.id,
          slug: 'p-pay-test',
          title: '支付测试商品',
          basePrice: 72,
          stockMode: 'manual_stock',
          manualStock: 20,
          specsJson: JSON.stringify([{ id: 'std', name: '标准', price: 72 }]),
        })
        .returning({ id: products.id });

      // 2. 配置支付宝当面付 RSA2 密钥对并启用通道
      const keyPair = (await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair;
      const privatePem = arrayBufferToPem(
        await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
        'PRIVATE KEY'
      );
      const publicPem = arrayBufferToPem(
        await crypto.subtle.exportKey('spki', keyPair.publicKey),
        'PUBLIC KEY'
      );

      const appId = '2026112100000001';
      const gatewayUrl = 'https://alipay.m2.test/gateway.do';
      const qrCode = 'https://alipay.m2.test/qr/fixture';
      await app.db
        .update(paymentPlugins)
        .set({
          enabled: 1,
          configJson: JSON.stringify({
            app_id: appId,
            private_key: privatePem,
            alipay_public_key: publicPem,
            gateway_url: gatewayUrl,
          }),
        })
        .where(eq(paymentPlugins.id, 'alipay_f2f'));

      await saveSiteMailConfig(app.env, 0, {
        enabled: true,
        auto_send_order: true,
        provider: 'custom_webhook',
        from_name: 'M2PayTest',
        from_email: 'noreply@example.com',
        api_endpoint: 'https://mail-relay.example.com/send',
      });

      // 仅替换支付宝预下单的外部 HTTP 传输，应用仍生成 RSA2 签名并创建实际支付单；发信通知走独立 mock 响应。
      const precreate = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(gatewayUrl);
        expect(init.method).toBe('POST');
        return Response.json({ alipay_trade_precreate_response: { code: '10000', qr_code: qrCode } });
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url === 'https://mail-relay.example.com/send') {
            return Response.json({ ok: true });
          }
          return precreate(url, init ?? {});
        })
      );

      const alipayOrd = await app.jsonRequest<{
        requires_payment: boolean;
        order: { order_no: string; status: string };
        payment_intent: {
          intent_no: string;
          pay_amount: number;
          qr_content: string;
          view_token: string;
        };
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          product_id: prod.id,
          spec_id: 'std',
          quantity: 1,
          contact_email: 'ali_buyer@m2.dev',
          payment_method: 'alipay_f2f',
        }),
      });
      expect(alipayOrd.ok).toBe(true);
      expect(alipayOrd.data.requires_payment).toBe(true);
      expect(alipayOrd.data.payment_intent).toMatchObject({
        pay_amount: 72,
        qr_content: qrCode,
      });
      expect(precreate).toHaveBeenCalledTimes(1);

      // 合法 RSA2 签名异步通知必须返回 success 并推进订单至 delivered
      const { intent_no: intentNo, view_token: viewToken } = alipayOrd.data.payment_intent;
      expect(viewToken).toEqual(expect.any(String));
      const precreateForm = new URLSearchParams(String(precreate.mock.calls[0][1].body));
      expect(precreateForm.get('app_id')).toBe(appId);
      expect(precreateForm.get('method')).toBe('alipay.trade.precreate');
      expect(JSON.parse(precreateForm.get('biz_content') ?? '{}')).toMatchObject({
        out_trade_no: intentNo,
        total_amount: '72.00',
      });
      const callbackParams: Record<string, string> = {
        app_id: appId,
        out_trade_no: intentNo,
        trade_no: 'ALI-TX-20261121-001',
        trade_status: 'TRADE_SUCCESS',
        total_amount: '72.00',
      };
      const notify = (params: Record<string, string>, sign: string) =>
        app.request('/api/payments/webhook/alipay', {
          method: 'POST',
          body: new URLSearchParams({ ...params, sign_type: 'RSA2', sign }),
        });

      const sign = await signAlipayRsa2(callbackParams, privatePem);
      const wrongAmount = { ...callbackParams, total_amount: '1.00' };
      expect((await notify(wrongAmount, sign)).status).toBe(400);
      expect((await notify(wrongAmount, await signAlipayRsa2(wrongAmount, privatePem))).status).toBe(400);
      const wrongApp = { ...callbackParams, app_id: '2026112100000002' };
      expect((await notify(wrongApp, await signAlipayRsa2(wrongApp, privatePem))).status).toBe(400);
      const rejected = await app.jsonRequest(`/api/payments/intents/${intentNo}`, {
        headers: { 'X-Intent-Token': viewToken },
      });
      expect(rejected.ok).toBe(true);
      expect(rejected.data).toMatchObject({
        intent: { status: 'pending', sandbox_simulated: false },
        order: null,
      });

      const okRes = await notify(callbackParams, sign);
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toBe('success');

      const polled = await app.jsonRequest<{
        intent: { status: string };
        order: { order_no: string; status: string };
      }>(`/api/payments/intents/${intentNo}`, { headers: { 'X-Intent-Token': viewToken } });
      expect(polled.ok).toBe(true);
      expect(polled.headers.get('Cache-Control')).toBe('no-store');
      expect(polled.data.intent.status).toBe('paid');
      expect(polled.data.order).toMatchObject({
        order_no: alipayOrd.data.order.order_no,
        status: 'delivered',
      });
      const anonymous = await app.jsonRequest(`/api/payments/intents/${intentNo}`);
      expect(anonymous.ok).toBe(true);
      expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
      expect(anonymous.data.order).toEqual({ locked: true });

      // 3. 测试实时汇率更新与暴跌熔断 + USDT BEP20/ERC20 防撞单
      const fxOk = await syncLiveExchangeRates(app.env, {
        force: true,
        customRates: { usdCny: 7.18, usdtCny: 7.2, source: 'test_feed' },
      });
      expect(fxOk.ok).toBe(true);
      expect(fxOk.snapshot.usdt_cny).toBe(7.2);

      // 汇率暴跌 30% 触发熔断，缓存汇率仍保持 7.2
      const fxDrop = await syncLiveExchangeRates(app.env, {
        force: true,
        customRates: { usdCny: 5.0, usdtCny: 5.0, source: 'corrupt_feed' },
      });
      expect(fxDrop.ok).toBe(false);
      expect(fxDrop.snapshot.usdt_cny).toBe(7.2);

      for (const provider of ['usdt_bep20', 'usdt_erc20']) {
        const enabled = await app.jsonRequest(`/api/admin/payment-plugins/${provider}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ enabled: true }),
        });
        expect(enabled.ok).toBe(true);

        const amounts: number[] = [];
        for (const buyer of ['first', 'second']) {
          const order = await app.jsonRequest<{
            payment_intent: { currency: string; pay_amount: number; provider: string };
          }>('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
              product_id: prod.id,
              spec_id: 'std',
              quantity: 1,
              contact_email: `${provider}-${buyer}@m2.dev`,
              payment_method: provider,
            }),
          });
          expect(order.ok).toBe(true);
          expect(order.data.payment_intent).toMatchObject({ currency: 'USDT', provider });
          amounts.push(order.data.payment_intent.pay_amount);
        }
        expect(amounts[0]).not.toBe(amounts[1]);
      }
    } finally {
      vi.unstubAllGlobals();
      app.close();
    }
  });

  it('多上游主备 Failover：主源明确失败自动切换备源交付；主源超时 timeout_unknown 严禁盲重试双下单', async () => {
    const app = createTestApp({ ADMIN_SECRET: 'm2-failover-secret' });
    try {
      const initRes = await app.jsonRequest<{ token: string }>('/api/setup/initialize', {
        method: 'POST',
        body: JSON.stringify({
          setup_secret: 'm2-failover-secret',
          admin_email: 'admin@failover.dev',
          admin_password: 'StrongPassword#2026',
          brand_name: 'FailoverShop',
        }),
      });
      const adminToken = initRes.data.token;

      await app.db
        .insert(paymentPlugins)
        .values({
          id: 'demo_instant',
          name: 'Demo Sandbox',
          description: 'Test instant',
          enabled: 1,
          configJson: '{}',
        })
        .onConflictDoNothing();

      const [grp] = await app.db
        .insert(categoryGroups)
        .values({ slug: 'g-up', name: '直采分组', nameEn: 'Up', sortOrder: 1 })
        .returning({ id: categoryGroups.id });
      const [cat] = await app.db
        .insert(categories)
        .values({ groupId: grp.id, slug: 'c-up', name: '直采分类', nameEn: 'UpSub', sortOrder: 1 })
        .returning({ id: categories.id });
      const [prod] = await app.db
        .insert(products)
        .values({
          categoryId: cat.id,
          slug: 'failover-sku',
          title: '多上游容灾商品',
          basePrice: 88,
          costPrice: 30,
          stockMode: 'cards',
          specsJson: JSON.stringify([{ id: 'pro', name: 'Pro 席位', price: 88 }]),
        })
        .returning({ id: products.id });

      // 创建两个 mock_sandbox 上游源：主源 A(always_fail) + 备源 B(normal)
      const srcARes = await app.jsonRequest<{ id: number }>('/api/admin/upstreams', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: '主源A（模拟故障）',
          adapter_type: 'mock_sandbox',
          sandbox_mode: 'always_fail',
          cached_balance: 1000,
        }),
      });
      const srcBRes = await app.jsonRequest<{ id: number }>('/api/admin/upstreams', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: '备源B（健康兜底）',
          adapter_type: 'mock_sandbox',
          sandbox_mode: 'normal',
          cached_balance: 1000,
        }),
      });
      const srcAId = srcARes.data.id;
      const srcBId = srcBRes.data.id;

      // 同时绑定至同一商品规格：主源 priority=5，备源 priority=20
      const bindARes = await app.jsonRequest<{ id: number }>('/api/admin/upstreams/bindings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          product_id: prod.id,
          spec_id: 'pro',
          source_id: srcAId,
          upstream_item_id: 'SBX-CLAUDE-PRO',
          fulfillment_mode: 'upstream_only',
          routing_strategy: 'priority',
          priority: 5,
          cached_cost: 35,
          cached_stock: 50,
        }),
      });
      expect(bindARes.ok).toBe(true);

      const bindBRes = await app.jsonRequest<{ id: number }>('/api/admin/upstreams/bindings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          product_id: prod.id,
          spec_id: 'pro',
          source_id: srcBId,
          upstream_item_id: 'SBX-GPT5-KEY',
          fulfillment_mode: 'upstream_only',
          routing_strategy: 'priority',
          priority: 20,
          cached_cost: 40,
          cached_stock: 50,
        }),
      });
      expect(bindBRes.ok).toBe(true);

      await saveSiteMailConfig(app.env, 0, {
        enabled: true,
        auto_send_order: true,
        provider: 'custom_webhook',
        from_name: 'M2Failover',
        from_email: 'noreply@example.com',
        api_endpoint: 'https://mail-relay.example.com/send',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url === 'https://mail-relay.example.com/send') {
            return Response.json({ ok: true });
          }
          throw new Error(`测试中禁止未 mock 的外部 fetch: ${url}`);
        })
      );

      // 场景 1：主源 A 明确报错失败，系统必须自动切至备源 B 秒级交付，且买家侧脱敏对象不暴露上游溯源字段
      const ordFailover = await app.jsonRequest<{
        order: { order_no: string; status: string; upstream_source_id?: number };
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          product_id: prod.id,
          spec_id: 'pro',
          quantity: 1,
          contact_email: 'failover@test.dev',
          payment_method: 'demo_instant',
        }),
      });
      expect(ordFailover.ok).toBe(true);
      expect(ordFailover.data.order.status).toBe('delivered');
      expect(ordFailover.data.order).not.toHaveProperty('upstream_source_id');

      const [dbOrd] = await app.db
        .select()
        .from(orders)
        .where(eq(orders.publicOrderNo, ordFailover.data.order.order_no))
        .limit(1);
      expect(dbOrd).toBeDefined();
      expect(dbOrd.fulfillmentSource).toBe('upstream');
      expect(dbOrd.upstreamSourceId).toBe(srcBId);

      const attempts1 = await app.db
        .select()
        .from(upstreamOrders)
        .where(eq(upstreamOrders.localOrderNo, dbOrd.orderNo));
      expect(attempts1.length).toBe(2);
      expect(attempts1.some((a) => a.sourceId === srcAId && a.status === 'failed')).toBe(true);
      expect(attempts1.some((a) => a.sourceId === srcBId && a.status === 'succeeded')).toBe(true);

      // 场景 2：主源 A 设为 always_timeout，验证严格禁止切换备源双下单！
      const timeoutConfig = await app.jsonRequest(`/api/admin/upstreams/${srcAId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ sandbox_mode: 'always_timeout' }),
      });
      expect(timeoutConfig.ok).toBe(true);

      const ordTimeout = await app.jsonRequest<{
        order: { order_no: string; status: string };
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          product_id: prod.id,
          spec_id: 'pro',
          quantity: 1,
          contact_email: 'timeout@test.dev',
          payment_method: 'demo_instant',
        }),
      });
      expect(ordTimeout.ok).toBe(true);
      expect(ordTimeout.data.order.status).toBe('upstream_pending');
      expect(ordTimeout.data.order).not.toHaveProperty('upstream_source_id');

      const [dbTimeout] = await app.db
        .select({ orderNo: orders.orderNo })
        .from(orders)
        .where(eq(orders.publicOrderNo, ordTimeout.data.order.order_no))
        .limit(1);
      expect(dbTimeout).toBeDefined();
      const attempts2 = await app.db
        .select()
        .from(upstreamOrders)
        .where(eq(upstreamOrders.localOrderNo, dbTimeout.orderNo));
      expect(attempts2.length).toBe(1);
      expect(attempts2[0].sourceId).toBe(srcAId);
      expect(attempts2[0].status).toBe('timeout_unknown');
    } finally {
      vi.unstubAllGlobals();
      app.close();
    }
  });
});
