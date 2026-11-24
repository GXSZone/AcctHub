import type { MailMessage, SiteMailConfigRecord } from './mail';
import { assertSafeMailEndpoint } from './mail.endpoint';

/** 按所选发信服务商（Resend / Brevo / Mailgun / Custom Webhook）投递邮件 */
export async function sendEmailViaProvider(
  cfg: SiteMailConfigRecord,
  params: MailMessage
): Promise<Response> {
  const fromDisplay = cfg.from_name ? `${cfg.from_name} <${cfg.from_email}>` : cfg.from_email;
  // Workers 拒绝 redirect: 'error'，手动模式下交由调用方将 3xx 判定为失败。
  const options = { signal: AbortSignal.timeout(10_000), redirect: 'manual' } as const;
  const idempotencyHeader: Record<string, string> = params.idempotencyKey
    ? { 'Idempotency-Key': params.idempotencyKey }
    : {};

  if (cfg.provider === 'resend') {
    return fetch('https://api.resend.com/emails', {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.api_key}`,
        ...idempotencyHeader,
      },
      body: JSON.stringify({
        from: fromDisplay,
        to: [params.to],
        ...(cfg.reply_to ? { reply_to: cfg.reply_to } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });
  }

  if (cfg.provider === 'brevo') {
    return fetch('https://api.brevo.com/v3/smtp/email', {
      ...options,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.api_key },
      body: JSON.stringify({
        sender: { name: cfg.from_name || 'Order Delivery', email: cfg.from_email },
        to: [{ email: params.to }],
        ...(cfg.reply_to ? { replyTo: { email: cfg.reply_to } } : {}),
        subject: params.subject,
        htmlContent: params.html,
        textContent: params.text,
      }),
    });
  }

  if (cfg.provider === 'mailgun') {
    const form = new URLSearchParams();
    form.set('from', fromDisplay);
    form.set('to', params.to);
    if (cfg.reply_to) form.set('h:Reply-To', cfg.reply_to);
    form.set('subject', params.subject);
    form.set('html', params.html);
    form.set('text', params.text);
    const base = cfg.api_endpoint
      ? assertSafeMailEndpoint(cfg.api_endpoint)
      : `https://api.mailgun.net/v3/${encodeURIComponent(cfg.mailgun_domain)}/messages`;
    return fetch(base, {
      ...options,
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${cfg.api_key}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...idempotencyHeader };
  if (cfg.api_key) headers.Authorization = `Bearer ${cfg.api_key}`;
  return fetch(assertSafeMailEndpoint(cfg.api_endpoint), {
    ...options,
    method: 'POST',
    headers,
    body: JSON.stringify({
      from_name: cfg.from_name,
      from_email: cfg.from_email,
      reply_to: cfg.reply_to || cfg.from_email,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      scene: params.scene,
      order_no: params.orderNo || '',
      meta: params.meta || {},
    }),
  });
}
