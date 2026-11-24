import { runInNewContext } from 'node:vm';
import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { paymentRoutes } from '../../worker/domains/payment/payment.routes';
import type { AppBindings } from '../../worker/env';
import { createTestD1Database } from '../integration/helpers/test-d1';

it('[S20] 三种合法沙盒收银台只显示支付单号并通过同源端点提交', async () => {
  const { d1, close } = createTestD1Database({ applyMigrations: false });
  try {
    const app = new Hono<AppBindings>().route('/api/payments', paymentRoutes);
    const env = { DB: d1, APP_ENV: 'test', SANDBOX_MODE: 'true' };
    const samples = [
      { provider: 'epay', intent: 'PAY12345678901231', heading: 'EPAY' },
      { provider: 'stripe', intent: 'PAY12345678901232', heading: 'STRIPE' },
      { provider: 'alipay_f2f', intent: 'PAY12345678901233', heading: 'ALIPAY_F2F' },
    ];
    const scripts: string[] = [];

    for (const { provider, intent, heading } of samples) {
      const query = new URLSearchParams({ provider, intent });
      const response = await app.request(`/api/payments/sandbox/mock-gateway?${query}`, {}, env);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/html');
      expect(response.headers.get('Cache-Control')).toBe('no-store');

      const page = await response.text();
      expect(page).toContain(`<h2>AcctHub 本地沙盒收银台 (${heading})</h2>`);
      expect(page.match(new RegExp(intent, 'g'))).toHaveLength(1);
      const numberNode = page.match(/<code id="intentNo">([^<]+)<\/code>/)?.[1];
      expect(numberNode).toBe(intent);
      const scriptTags = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
      expect(scriptTags).toHaveLength(1);
      expect(scriptTags[0][1]).toBe('');
      const script = scriptTags[0][2];
      scripts.push(script);

      const payButton: { onclick?: () => Promise<void> } = {};
      const output = { textContent: '' };
      const requests: [string, RequestInit][] = [];
      const outputText = '{"ok":true,"status":"paid"}';
      const elements = { payBtn: payButton, intentNo: { textContent: numberNode }, out: output };
      runInNewContext(script, {
        document: { getElementById: (name: keyof typeof elements) => elements[name] },
        fetch: async (url: string, init: RequestInit) => {
          requests.push([url, init]);
          return new Response(outputText);
        },
      });

      expect(payButton.onclick).toBeTypeOf('function');
      await payButton.onclick?.();
      expect(requests).toEqual([
        [
          '/api/payments/sandbox/simulate-pay',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent_no: intent }),
          },
        ],
      ]);
      expect(output).toEqual({ textContent: outputText });
    }

    expect(new Set(scripts).size).toBe(1);
  } finally {
    close();
  }
});
