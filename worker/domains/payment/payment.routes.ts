import { sandboxGatewayQuerySchema, simulatePayInputSchema } from '@shared/index';
import { type Context, Hono } from 'hono';
import { html } from 'hono/html';
import { type AppBindings, isSandboxEnabled } from '../../env';
import { parseJsonBody, parseQueryParams } from '../../middleware/validate.middleware';
import {
  checkPaymentIntentNow,
  getPaymentIntentStatus,
  processAlipayWebhook,
  processEpayWebhook,
  processStripeWebhook,
  simulateSandboxPayment,
} from './payment.service';

export const paymentRoutes = new Hono<AppBindings>();

paymentRoutes.get('/intents/:intentNo', async (c) => {
  c.header('Cache-Control', 'no-store');
  const intentNo = c.req.param('intentNo').trim();
  const result = await getPaymentIntentStatus(c.env, c.req.raw, c.get('tenant'), intentNo);
  return c.json(result);
});

paymentRoutes.post('/intents/:intentNo/check', async (c) => {
  c.header('Cache-Control', 'no-store');
  const intentNo = c.req.param('intentNo').trim();
  const result = await checkPaymentIntentNow(c.env, c.req.raw, c.get('tenant'), intentNo);
  return c.json(result);
});

async function handleEpayWebhook(c: Context<AppBindings>) {
  const params: Record<string, string> = {};
  const url = new URL(c.req.url);
  for (const [k, v] of url.searchParams.entries()) {
    params[k] = v;
  }
  if (c.req.method === 'POST') {
    const ct = (c.req.header('Content-Type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) params[k] = String(v);
      }
    } else {
      const formText = await c.req.text().catch(() => '');
      for (const [k, v] of new URLSearchParams(formText).entries()) {
        params[k] = v;
      }
    }
  }

  const res = await processEpayWebhook(c.env, params, url.origin);
  if (!res.ok) return c.text(`fail: ${res.reason || 'invalid signature'}`, 400);
  return c.text('success', 200);
}

paymentRoutes.get('/webhook/epay', handleEpayWebhook);
paymentRoutes.post('/webhook/epay', handleEpayWebhook);

paymentRoutes.post('/webhook/stripe', async (c) => {
  const rawBody = await c.req.text();
  const sigHeader = c.req.header('Stripe-Signature') || c.req.header('stripe-signature') || '';
  const result = await processStripeWebhook(c.env, rawBody, sigHeader, new URL(c.req.url).origin);
  return c.json(result);
});

paymentRoutes.post('/webhook/alipay', async (c) => {
  const formText = await c.req.text().catch(() => '');
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(formText).entries()) {
    params[k] = v;
  }
  const res = await processAlipayWebhook(c.env, params, new URL(c.req.url).origin);
  return res.ok ? c.text('success', 200) : c.text('failure', 400);
});

if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__) {
  paymentRoutes.post('/sandbox/simulate-pay', async (c) => {
    if (!isSandboxEnabled(c.env)) return c.notFound();
    const input = await parseJsonBody(c, simulatePayInputSchema);
    const res = await simulateSandboxPayment(c.env, input.intent_no, new URL(c.req.url).origin);
    return c.json(res);
  });

  paymentRoutes.get('/sandbox/mock-gateway', async (c) => {
    if (!isSandboxEnabled(c.env)) return c.notFound();
    const { intent: intentNo, provider } = parseQueryParams(c, sandboxGatewayQuerySchema);
    c.header('Cache-Control', 'no-store');
    return c.html(
      html`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>AcctHub 沙盒模拟收银台</title></head>
    <body style="font-family:system-ui;max-width:480px;margin:64px auto;padding:24px;border:1px solid #e5e5e5;border-radius:16px">
      <h2>AcctHub 本地沙盒收银台 (${provider.toUpperCase()})</h2>
      <p>支付单号：<code id="intentNo">${intentNo}</code></p>
      <p style="color:#666;font-size:14px">此页面仅在开发/测试沙盒环境可用，点击下方按钮将触发真实异步回调履约引擎。</p>
      <button id="payBtn" style="padding:10px 20px;border-radius:10px;border:0;background:#D97757;color:#fff;cursor:pointer;font-size:15px">模拟付款成功并回调</button>
      <pre id="out" style="margin-top:16px;background:#f7f7f7;padding:12px;border-radius:8px;font-size:12px"></pre>
      <script>
        document.getElementById('payBtn').onclick = async () => {
          const r = await fetch('/api/payments/sandbox/simulate-pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent_no: document.getElementById('intentNo').textContent })
          });
          document.getElementById('out').textContent = await r.text();
        };
      </script>
    </body></html>`
    );
  });
}
