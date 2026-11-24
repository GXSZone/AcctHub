import { describe, expect, it } from 'vitest';
import { signAlipayRsa2, verifyAlipayRsa2Callback } from './payment.alipay';
import { fetchLiveRatesFromPublicApis, validateFxRateWithinGuard } from './payment.fx';

function arrayBufferToPem(buf: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  const lines = b64.match(/.{1,64}/g)?.join('\n') || b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

describe('支付宝当面付 Web Crypto RSA2 与实时汇率安全熔断单测', () => {
  it('signAlipayRsa2 与 verifyAlipayRsa2Callback 对官方异步回调验签与防篡改完全准确', async () => {
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

    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privatePem = arrayBufferToPem(pkcs8, 'PRIVATE KEY');
    const publicPem = arrayBufferToPem(spki, 'PUBLIC KEY');

    const notifyParams: Record<string, string> = {
      app_id: '2021000123456789',
      out_trade_no: 'PAY202611210001',
      trade_no: '202611212200140001001',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '99.00',
      sign_type: 'RSA2',
    };

    // 按支付宝回调规范，验签不含 sign_type
    const { sign_type: _omit, ...toSign } = notifyParams;
    notifyParams.sign = await signAlipayRsa2(toSign, privatePem);

    const ok = await verifyAlipayRsa2Callback(notifyParams, publicPem);
    expect(ok.valid).toBe(true);

    // 篡改金额后必须验签失败
    const tampered = await verifyAlipayRsa2Callback({ ...notifyParams, total_amount: '0.01' }, publicPem);
    expect(tampered.valid).toBe(false);

    // 非成功交易状态必须拦截
    const closedCheck = await verifyAlipayRsa2Callback(
      { ...notifyParams, trade_status: 'TRADE_CLOSED' },
      publicPem
    );
    expect(closedCheck.valid).toBe(false);
  });

  it('validateFxRateWithinGuard 放行合理波动并严格熔断暴涨暴跌行情', () => {
    expect(validateFxRateWithinGuard(7.24, 7.21).safe).toBe(true);
    expect(validateFxRateWithinGuard(7.5, null).safe).toBe(true);

    // 单次暴跌 > 10% 触发熔断
    const dropGuard = validateFxRateWithinGuard(6.1, 7.25);
    expect(dropGuard.safe).toBe(false);
    expect(dropGuard.reason).toContain('熔断');

    // 超出全局安全边界 [5.5, 9.0] 直接拒绝
    expect(validateFxRateWithinGuard(3.2, null).safe).toBe(false);
    expect(validateFxRateWithinGuard(12.5, 7.2).safe).toBe(false);
  });

  it('fetchLiveRatesFromPublicApis 在部分源不可用时仍能由可用数据源秒级返回最新汇率', async () => {
    const mockFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('open.er-api.com')) {
        return new Response(JSON.stringify({ rates: { CNY: 6.6933 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error('upstream blocked');
    }) as typeof fetch;

    const result = await fetchLiveRatesFromPublicApis(mockFetch);
    expect(result.usdCny).toBe(6.6933);
    expect(result.usdtCny).toBe(6.6933);
    expect(result.source).toBe('open-er-api');
  });
});
