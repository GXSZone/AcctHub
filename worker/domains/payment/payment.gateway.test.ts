import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { hmacSha256Hex } from '../../infra/crypto';
import {
  buildEpaySignString,
  createStripeCheckoutSession,
  signEpayParams,
  verifyEpayCallback,
  verifyStripeWebhookSignature,
} from './payment.gateway';

describe('worker/domains/payment/payment.gateway（Phase 1 真实支付网关签名与回调验签）', () => {
  it('[B15] Stripe HKD 按配置的人民币兑港币价格创建整数分会话', async () => {
    let posted = new URLSearchParams();
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      posted = new URLSearchParams(String(init.body));
      return Response.json({
        id: 'cs_fixture_b15',
        url: 'https://checkout.stripe.com/fixture',
        livemode: true,
      });
    });
    try {
      const config = {
        secret_key: 'sk_live_fixture',
        webhook_secret: 'fixture',
        auto_fx: false,
        usd_cny_rate: '7.2',
        hkd_cny_rate: '0.9',
        currency: 'hkd',
      };
      const result = await createStripeCheckoutSession({} as Env, config, {
        intentNo: 'PAY-FX-FIXTURE',
        subject: '订单',
        amountCny: 90,
        originUrl: 'https://example.test',
        returnUrl: 'https://example.test/orders',
      });
      expect(result).toMatchObject({ currency: 'HKD', payAmount: 100, providerTradeNo: 'cs_fixture_b15' });
      expect(posted.get('line_items[0][price_data][unit_amount]')).toBe('10000');
      expect(posted.get('line_items[0][price_data][currency]')).toBe('hkd');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('易支付 MD5 参数排序签名与回调验签准确无误且拦截篡改', () => {
    const key = 'epay_merchant_secret_2026';
    const params: Record<string, string> = {
      pid: '10086',
      trade_no: '202611210001',
      out_trade_no: 'PAY12345678',
      type: 'alipay',
      name: 'Claude Pro 独享席位',
      money: '149.00',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5',
    };
    const sorted = buildEpaySignString(params);
    expect(sorted).toBe(
      'money=149.00&name=Claude Pro 独享席位&out_trade_no=PAY12345678&pid=10086&trade_no=202611210001&trade_status=TRADE_SUCCESS&type=alipay'
    );

    const sign = signEpayParams(params, key);
    expect(verifyEpayCallback({ ...params, sign }, key).valid).toBe(true);

    // 篡改金额必须验签失败
    expect(verifyEpayCallback({ ...params, money: '0.01', sign }, key).valid).toBe(false);
    // 空白商户密钥必须拒绝
    expect(verifyEpayCallback({ ...params, sign }, '').valid).toBe(false);
    // 非 TRADE_SUCCESS 必须拒绝
    expect(
      verifyEpayCallback(
        {
          ...params,
          trade_status: 'TRADE_CLOSED',
          sign: signEpayParams({ ...params, trade_status: 'TRADE_CLOSED' }, key),
        },
        key
      ).valid
    ).toBe(false);
  });

  it('Stripe Webhook HMAC-SHA256 验签与 5 分钟防重放窗口严格生效', async () => {
    const secret = 'whsec_test_stripe_2026_secret';
    const rawBody = JSON.stringify({
      id: 'evt_test_001',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_001', client_reference_id: 'PAY99999', payment_status: 'paid' } },
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const validSig = await hmacSha256Hex(secret, `${nowSec}.${rawBody}`);
    const okRes = await verifyStripeWebhookSignature(rawBody, `t=${nowSec},v1=${validSig}`, secret);
    expect(okRes.valid).toBe(true);

    // 篡改消息体必须验签失败
    const tampered = await verifyStripeWebhookSignature(`${rawBody} `, `t=${nowSec},v1=${validSig}`, secret);
    expect(tampered.valid).toBe(false);

    // 超出 5 分钟重放窗口的历史时间戳必须拒绝
    const staleSec = nowSec - 600;
    const staleSig = await hmacSha256Hex(secret, `${staleSec}.${rawBody}`);
    const staleRes = await verifyStripeWebhookSignature(rawBody, `t=${staleSec},v1=${staleSig}`, secret);
    expect(staleRes.valid).toBe(false);

    // 空白 webhook_secret 必须拒绝
    const emptySec = await verifyStripeWebhookSignature(rawBody, `t=${nowSec},v1=${validSig}`, '');
    expect(emptySec.valid).toBe(false);
  });
});
