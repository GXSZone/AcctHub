import type { Env } from '../env';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';
import { createDb } from './db';
import { assertSafeMailEndpoint } from './mail.endpoint';
import { enqueueMail, type QueuedMailResult, sendQueuedMail } from './mail.outbox';
import { sendEmailViaProvider } from './mail.providers';
import {
  type EmailDeliveryLogRow,
  findSiteMailConfigRow,
  insertMailDeliveryLogRow,
  listSiteMailLogRows,
  upsertSiteMailConfigRow,
} from './mail.repo';
import { buildOrderDeliveryEmailTemplate } from './mail.templates';

export type MailProvider = 'resend' | 'brevo' | 'mailgun' | 'custom_webhook';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  orderNo?: string;
  scene:
    | 'order_created'
    | 'order_delivery'
    | 'order_resend'
    | 'order_replacement'
    | 'restock_alert'
    | 'risk_alert'
    | 'password_reset'
    | 'group_buy_refund'
    | 'renewal_reminder'
    | 'test';
  forceIgnoreDisabled?: boolean;
  meta?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface MailResult {
  ok: boolean;
  skipped?: boolean;
  provider?: string;
  error?: string;
}

export interface SiteMailConfigRecord {
  owner_agent_id: number;
  enabled: boolean;
  auto_send_order: boolean;
  auto_send_restock: boolean;
  provider: MailProvider;
  from_name: string;
  from_email: string;
  reply_to: string;
  api_key: string;
  api_endpoint: string;
  mailgun_domain: string;
  footer_note: string;
  order_email_subject_tpl: string;
  order_email_body_tpl: string;
  updated_at: string;
}

export interface SiteMailConfigPublic {
  owner_agent_id: number;
  enabled: boolean;
  auto_send_order: boolean;
  auto_send_restock: boolean;
  provider: MailProvider;
  from_name: string;
  from_email: string;
  reply_to: string;
  has_api_key: boolean;
  api_key_masked: string;
  api_endpoint: string;
  mailgun_domain: string;
  footer_note: string;
  order_email_subject_tpl: string;
  order_email_body_tpl: string;
  updated_at: string;
}

const VALID_PROVIDERS = new Set<MailProvider>(['resend', 'brevo', 'mailgun', 'custom_webhook']);

function normalizeProvider(raw: unknown): MailProvider {
  const s = String(raw || '').trim() as MailProvider;
  return VALID_PROVIDERS.has(s) ? s : 'resend';
}

export async function getSiteMailConfig(env: Env, ownerAgentId: number): Promise<SiteMailConfigRecord> {
  const row = await findSiteMailConfigRow(createDb(env.DB), ownerAgentId);
  if (!row) {
    return {
      owner_agent_id: ownerAgentId,
      enabled: false,
      auto_send_order: true,
      auto_send_restock: true,
      provider: 'resend',
      from_name: '',
      from_email: '',
      reply_to: '',
      api_key: '',
      api_endpoint: '',
      mailgun_domain: '',
      footer_note: '',
      order_email_subject_tpl: '',
      order_email_body_tpl: '',
      updated_at: '',
    };
  }

  const enc = (row.apiKeyEncrypted || '').trim();
  const decryptedKey = enc ? await decryptSecret(env, enc) : '';

  return {
    owner_agent_id: ownerAgentId,
    enabled: Boolean(row.enabled),
    auto_send_order: row.autoSendOrder !== 0,
    auto_send_restock: row.autoSendRestock !== 0,
    provider: normalizeProvider(row.provider),
    from_name: row.fromName || '',
    from_email: row.fromEmail || '',
    reply_to: row.replyTo || '',
    api_key: decryptedKey,
    api_endpoint: row.apiEndpoint || '',
    mailgun_domain: row.mailgunDomain || '',
    footer_note: row.footerNote || '',
    order_email_subject_tpl: row.orderEmailSubjectTpl || '',
    order_email_body_tpl: row.orderEmailBodyTpl || '',
    updated_at: row.updatedAt || '',
  };
}

export function isMailConfigAutoDeliveryReady(
  cfg: Pick<
    SiteMailConfigRecord,
    'enabled' | 'auto_send_order' | 'from_email' | 'provider' | 'api_endpoint' | 'api_key'
  >
): boolean {
  const hasEndpoint = cfg.provider === 'custom_webhook' ? Boolean(cfg.api_endpoint) : Boolean(cfg.api_key);
  return Boolean(cfg.enabled && cfg.auto_send_order && cfg.from_email && hasEndpoint);
}

export async function isSiteMailAutoDeliveryReady(env: Env, ownerAgentId: number): Promise<boolean> {
  const cfg = await getSiteMailConfig(env, ownerAgentId);
  return isMailConfigAutoDeliveryReady(cfg);
}

export async function getSiteMailConfigSafe(env: Env, ownerAgentId: number): Promise<SiteMailConfigPublic> {
  const cfg = await getSiteMailConfig(env, ownerAgentId);
  return {
    owner_agent_id: cfg.owner_agent_id,
    enabled: cfg.enabled,
    auto_send_order: cfg.auto_send_order,
    auto_send_restock: cfg.auto_send_restock,
    provider: cfg.provider,
    from_name: cfg.from_name,
    from_email: cfg.from_email,
    reply_to: cfg.reply_to,
    has_api_key: Boolean(cfg.api_key),
    api_key_masked: maskSecret(cfg.api_key),
    api_endpoint: cfg.api_endpoint,
    mailgun_domain: cfg.mailgun_domain,
    footer_note: cfg.footer_note,
    order_email_subject_tpl: cfg.order_email_subject_tpl,
    order_email_body_tpl: cfg.order_email_body_tpl,
    updated_at: cfg.updated_at,
  };
}

export async function saveSiteMailConfig(
  env: Env,
  ownerAgentId: number,
  input: {
    enabled?: boolean;
    auto_send_order?: boolean;
    auto_send_restock?: boolean;
    provider?: string;
    from_name?: string;
    from_email?: string;
    reply_to?: string;
    api_key?: string;
    clear_api_key?: boolean;
    api_endpoint?: string;
    mailgun_domain?: string;
    footer_note?: string;
    order_email_subject_tpl?: string;
    order_email_body_tpl?: string;
  }
): Promise<SiteMailConfigPublic> {
  const db = createDb(env.DB);
  const existing = await findSiteMailConfigRow(db, ownerAgentId);

  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : Number(existing?.enabled ?? 0);
  const autoSendOrder =
    input.auto_send_order !== undefined
      ? input.auto_send_order
        ? 1
        : 0
      : Number(existing?.autoSendOrder ?? 1);
  const autoSendRestock =
    input.auto_send_restock !== undefined
      ? input.auto_send_restock
        ? 1
        : 0
      : Number(existing?.autoSendRestock ?? 1);
  const provider =
    input.provider !== undefined ? normalizeProvider(input.provider) : normalizeProvider(existing?.provider);
  const fromName = (input.from_name !== undefined ? input.from_name : existing?.fromName || '')
    .trim()
    .slice(0, 60);
  const fromEmail = (input.from_email !== undefined ? input.from_email : existing?.fromEmail || '')
    .trim()
    .slice(0, 120);
  const replyTo = (input.reply_to !== undefined ? input.reply_to : existing?.replyTo || '')
    .trim()
    .slice(0, 120);
  const apiEndpoint = (input.api_endpoint !== undefined ? input.api_endpoint : existing?.apiEndpoint || '')
    .trim()
    .slice(0, 300);
  const mailgunDomain = (
    input.mailgun_domain !== undefined ? input.mailgun_domain : existing?.mailgunDomain || ''
  )
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .slice(0, 120);
  const footerNote = (input.footer_note !== undefined ? input.footer_note : existing?.footerNote || '')
    .trim()
    .slice(0, 300);

  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    throw new Error('发件人邮箱格式不正确');
  }
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) {
    throw new Error('回复邮箱 (Reply-To) 格式不正确');
  }
  if (apiEndpoint) assertSafeMailEndpoint(apiEndpoint);
  if (mailgunDomain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(mailgunDomain)) {
    throw new Error('Mailgun 发信域名格式不正确');
  }

  let encryptedKey = existing?.apiKeyEncrypted || '';
  if (input.clear_api_key) {
    encryptedKey = '';
  } else if (input.api_key?.trim()) {
    encryptedKey = await encryptSecret(env, input.api_key.trim());
  }

  const orderEmailSubjectTpl = (
    input.order_email_subject_tpl !== undefined
      ? input.order_email_subject_tpl
      : existing?.orderEmailSubjectTpl || ''
  )
    .trim()
    .slice(0, 240);
  const orderEmailBodyTpl = (
    input.order_email_body_tpl !== undefined ? input.order_email_body_tpl : existing?.orderEmailBodyTpl || ''
  ).slice(0, 15000);

  await upsertSiteMailConfigRow(db, {
    ownerAgentId,
    enabled,
    autoSendOrder,
    autoSendRestock,
    provider,
    fromName,
    fromEmail,
    replyTo,
    apiKeyEncrypted: encryptedKey,
    apiEndpoint,
    mailgunDomain,
    footerNote,
    orderEmailSubjectTpl,
    orderEmailBodyTpl,
  });

  return getSiteMailConfigSafe(env, ownerAgentId);
}

export async function listSiteMailLogs(
  env: Env,
  ownerAgentId: number,
  limit = 25
): Promise<EmailDeliveryLogRow[]> {
  return listSiteMailLogRows(createDb(env.DB), ownerAgentId, limit);
}

/** 统一发信执行器（支持 Resend / Brevo / Mailgun / Custom Webhook，自动记录审计日志） */
export async function sendSiteEmail(
  env: Env,
  ownerAgentId: number,
  params: MailMessage
): Promise<MailResult> {
  const cfg = await getSiteMailConfig(env, ownerAgentId);
  if (!cfg.enabled && !params.forceIgnoreDisabled) {
    return { ok: false, skipped: true, error: '当前站点未开启邮箱发信' };
  }
  if (params.scene === 'restock_alert' && !cfg.auto_send_restock) {
    return { ok: false, skipped: true, error: '当前站点已关闭到货邮件' };
  }
  if (!cfg.from_email) {
    return { ok: false, skipped: !params.forceIgnoreDisabled, error: '请先填写发件人邮箱地址 (From Email)' };
  }
  if (cfg.provider !== 'custom_webhook' && !cfg.api_key) {
    return {
      ok: false,
      skipped: !params.forceIgnoreDisabled,
      error: `请先填写 ${cfg.provider.toUpperCase()} API Key`,
    };
  }
  if (cfg.provider === 'mailgun' && !cfg.mailgun_domain) {
    return { ok: false, skipped: !params.forceIgnoreDisabled, error: '请先填写 Mailgun 发信域名' };
  }
  if (cfg.provider === 'custom_webhook' && !cfg.api_endpoint) {
    return { ok: false, skipped: !params.forceIgnoreDisabled, error: '请先填写自定义发信网关 URL' };
  }

  const db = createDb(env.DB);
  try {
    const res = await sendEmailViaProvider(cfg, params);

    if (!res.ok) {
      const errMsg = `发信服务返回 HTTP ${res.status}`;
      await insertMailDeliveryLogRow(db, {
        ownerAgentId,
        orderNo: params.orderNo,
        toEmail: params.to,
        subject: params.subject,
        provider: cfg.provider,
        scene: params.scene,
        status: 'failed',
        errorMessage: errMsg,
      });
      return { ok: false, provider: cfg.provider, error: errMsg };
    }

    await insertMailDeliveryLogRow(db, {
      ownerAgentId,
      orderNo: params.orderNo,
      toEmail: params.to,
      subject: params.subject,
      provider: cfg.provider,
      scene: params.scene,
      status: 'sent',
    });
    return { ok: true, provider: cfg.provider };
  } catch {
    const errMsg = '发信服务网络请求异常';
    await insertMailDeliveryLogRow(db, {
      ownerAgentId,
      orderNo: params.orderNo,
      toEmail: params.to,
      subject: params.subject,
      provider: cfg.provider,
      scene: params.scene,
      status: 'failed',
      errorMessage: errMsg,
    });
    return { ok: false, provider: cfg.provider, error: errMsg };
  }
}

interface OrderMailParams {
  ownerAgentId: number;
  brandName: string;
  toEmail: string;
  orderNo: string;
  productTitle: string;
  specName: string;
  quantity: number;
  lookupUrl?: string;
}

export async function queueOrderDeliveryEmail(
  env: Env,
  params: OrderMailParams & {
    totalAmount: number;
    deliveredPayload: string;
    warrantySummary?: string;
    scene?: 'order_delivery' | 'order_resend' | 'order_replacement';
    eventKey?: string;
  }
): Promise<string | undefined> {
  const scene = params.scene ?? 'order_delivery';
  if (!params.deliveredPayload.trim() || !params.toEmail.trim()) return;
  const cfg = await findSiteMailConfigRow(createDb(env.DB), params.ownerAgentId);
  if (scene === 'order_delivery' && (!cfg?.enabled || !cfg.autoSendOrder)) return;

  const tpl = buildOrderDeliveryEmailTemplate({
    brandName: cfg?.fromName || params.brandName,
    orderNo: params.orderNo,
    productTitle: params.productTitle,
    specName: params.specName,
    quantity: params.quantity,
    totalAmount: params.totalAmount,
    deliveredPayload: params.deliveredPayload,
    warrantySummary: params.warrantySummary,
    lookupUrl: params.lookupUrl,
    footerNote: cfg?.footerNote,
    replacement: scene === 'order_replacement',
    customSubjectTpl: cfg?.orderEmailSubjectTpl,
    customBodyTpl: cfg?.orderEmailBodyTpl,
  });

  const eventKey = `${scene}:${params.orderNo}${params.eventKey ? `:${params.eventKey}` : ''}`;
  await enqueueMail(env, params.ownerAgentId, eventKey, {
    to: params.toEmail,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    orderNo: params.orderNo,
    scene,
    meta: { product_title: params.productTitle, spec_name: params.specName, quantity: params.quantity },
  });
  return eventKey;
}

export async function dispatchOrderDeliveryEmail(
  env: Env,
  params: Parameters<typeof queueOrderDeliveryEmail>[1]
): Promise<QueuedMailResult> {
  const eventKey = await queueOrderDeliveryEmail(env, params);
  if (!eventKey)
    return { ok: false, skipped: true, error: '未启用自动发信或订单尚未交付', mail_status: 'disabled' };
  return sendQueuedMail(env, params.ownerAgentId, eventKey);
}

export { sendTestDeliveryEmail } from './mail.test-sender';
