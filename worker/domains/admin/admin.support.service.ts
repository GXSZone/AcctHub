import { paymentPluginPublicFields, paymentPluginSecretFields } from '@shared/domain/payment-plugin-settings';
import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import {
  getSiteMailConfigSafe,
  listSiteMailLogs,
  saveSiteMailConfig,
  sendTestDeliveryEmail,
} from '../../infra/mail';
import { resendQueuedOrderEmail } from '../../infra/mail.outbox';
import { dispatchOpsNotification } from '../../infra/notify';
import { sealPaymentPluginCredential } from '../../infra/payment-credential-storage';
import { sealSiteCredential } from '../../infra/site-credential';
import { attachOrderInfoToTickets } from '../orders/order-snapshot.repo';
import {
  isStripeLiveSecret,
  loadPaymentPluginConfig,
  loadStripeCurrencyConfig,
  requireLiveStripeKeys,
  type StripePluginConfig,
  validateStripeCurrencyConfig,
} from '../payment/payment.gateway';
import { findOrderWithProductWarrantyRepo } from '../upstream/upstream.orders.repo';
import { resolveOrderBrandNameRepo } from '../upstream/upstream.recovery.repo';
import { getCompletedReplacementMailStatus } from '../upstream/upstream.replacement.service';
import { upsertSiteSettingRepo } from './admin.catalog.repo';
import {
  createHelpArticleRepo,
  createMainAnnouncementRepo,
  deleteHelpArticleRepo,
  deleteMainAnnouncementRepo,
  findAdminTicketByIdRepo,
  listAdminTicketMessagesRepo,
  replyAdminTicketRepo,
  updateAdminTicketStatusRepo,
  updateHelpArticleRepo,
  updateMainAnnouncementRepo,
  updatePaymentPluginRepo,
} from './admin.ops.repo';

export async function createAdminAnnouncement(
  env: Env,
  body: {
    title: string;
    content: string;
    level?: string;
    audience?: 'storefront' | 'direct_downlines';
    is_pinned?: boolean;
  }
) {
  const audience = body.audience === 'direct_downlines' ? 'direct_downlines' : 'storefront';
  const id = await createMainAnnouncementRepo(createDb(env.DB), {
    audience,
    title: body.title,
    content: body.content,
    level: body.level || 'info',
    isPinned: body.is_pinned ? 1 : 0,
  });
  return { id, ok: true };
}

export async function updateAdminAnnouncement(
  env: Env,
  id: number,
  body: {
    title?: string;
    content?: string;
    level?: string;
    audience?: 'storefront' | 'direct_downlines';
    is_pinned?: boolean;
  }
) {
  const patch: Record<string, unknown> = {};
  if (body.audience) {
    patch.audience = body.audience === 'direct_downlines' ? 'direct_downlines' : 'storefront';
  }
  if (body.title !== undefined) {
    patch.title = body.title;
    patch.titleEn = body.title;
  }
  if (body.content !== undefined) {
    patch.content = body.content;
    patch.contentEn = body.content;
  }
  if (body.level !== undefined) patch.level = body.level;
  if (body.is_pinned !== undefined) patch.isPinned = body.is_pinned ? 1 : 0;

  await updateMainAnnouncementRepo(createDb(env.DB), id, patch);
  return { ok: true };
}

export async function deleteAdminAnnouncement(env: Env, id: number) {
  await deleteMainAnnouncementRepo(createDb(env.DB), id);
  return { ok: true };
}

export async function createAdminHelpArticle(
  env: Env,
  body: { category: string; title: string; content: string; sort_order?: number }
) {
  const id = await createHelpArticleRepo(createDb(env.DB), {
    category: body.category || '入门指南',
    title: body.title,
    content: body.content,
    sortOrder: Number(body.sort_order ?? 10),
  });
  return { id, ok: true };
}

export async function updateAdminHelpArticle(
  env: Env,
  id: number,
  body: { category?: string; title?: string; content?: string; sort_order?: number }
) {
  const patch: Record<string, unknown> = {};
  if (body.category !== undefined) patch.category = body.category;
  if (body.title !== undefined) {
    patch.title = body.title;
    patch.titleEn = body.title;
  }
  if (body.content !== undefined) {
    patch.content = body.content;
    patch.contentEn = body.content;
  }
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  await updateHelpArticleRepo(createDb(env.DB), id, patch);
  return { ok: true };
}

export async function deleteAdminHelpArticle(env: Env, id: number) {
  await deleteHelpArticleRepo(createDb(env.DB), id);
  return { ok: true };
}

export async function getAdminTicketDetail(env: Env, id: number) {
  const db = createDb(env.DB);
  const ticket = await findAdminTicketByIdRepo(db, id);
  if (!ticket) throw Errors.notFound('工单不存在');
  const [enrichedList, messages, replacementMailStatus] = await Promise.all([
    attachOrderInfoToTickets(env, [ticket], true, true),
    listAdminTicketMessagesRepo(db, id),
    getCompletedReplacementMailStatus(env, id),
  ]);
  return { ticket: enrichedList[0], messages, replacementMailStatus };
}

export async function replyAdminTicket(
  env: Env,
  id: number,
  body: { content?: string; status?: 'admin_replied' | 'resolved' | 'closed' }
) {
  const db = createDb(env.DB);
  const ticket = await findAdminTicketByIdRepo(db, id);
  if (!ticket) throw Errors.notFound('工单不存在');
  if (ticket.status === 'closed') {
    throw Errors.validation('该工单已关闭，如需继续回复请先调整工单状态');
  }
  const content = (body.content || '').trim();
  if (!content) throw Errors.validation('回复内容不能为空');

  const nextStatus = body.status || 'admin_replied';
  await replyAdminTicketRepo(db, id, content.slice(0, 3000), nextStatus);
  return { ok: true, status: nextStatus };
}

export async function updateAdminTicketStatus(env: Env, id: number, status?: string) {
  const allowed = new Set(['open', 'agent_replied', 'escalated', 'admin_replied', 'resolved', 'closed']);
  if (!status || !allowed.has(status)) throw Errors.validation('无效工单状态');
  await updateAdminTicketStatusRepo(createDb(env.DB), id, status);
  return { ok: true };
}

export async function updateAdminNotifyConfig(
  env: Env,
  body: {
    tg_bot_token?: string;
    clear_tg_token?: boolean;
    tg_chat_id?: string;
    webhook_url?: string;
    events?: string[];
    low_stock_threshold?: number;
  }
) {
  const db = createDb(env.DB);
  if (body.clear_tg_token) await upsertSiteSettingRepo(db, 'notify_tg_bot_token', '');
  else if (body.tg_bot_token?.trim()) {
    const token = await sealSiteCredential(env, 'notify_tg_bot_token', body.tg_bot_token.trim());
    await upsertSiteSettingRepo(db, 'notify_tg_bot_token', token);
  }
  if (body.tg_chat_id !== undefined) {
    await upsertSiteSettingRepo(db, 'notify_tg_chat_id', body.tg_chat_id.trim());
  }
  if (body.webhook_url !== undefined) {
    await upsertSiteSettingRepo(db, 'notify_webhook_url', body.webhook_url.trim());
  }
  if (Array.isArray(body.events)) {
    await upsertSiteSettingRepo(db, 'notify_events_json', JSON.stringify(body.events));
  }
  if (body.low_stock_threshold !== undefined) {
    await upsertSiteSettingRepo(
      db,
      'notify_low_stock_threshold',
      String(Math.max(0, Math.floor(Number(body.low_stock_threshold) || 3)))
    );
  }
  return { ok: true };
}

export async function sendAdminNotifyTest(env: Env) {
  const res = await dispatchOpsNotification(
    env,
    'new_order',
    'AcctHub 运营通知测试',
    [
      '这是一条来自 AcctHub 边缘总控后台的测试推送。',
      `触发时间：${new Date().toISOString()}`,
      '如果您收到此消息，说明通知通道已联通！',
    ],
    true
  );
  if (!res.sentTelegram && !res.sentWebhook) {
    throw Errors.validation(
      res.errors.length > 0
        ? `推送失败：${res.errors.join('；')}`
        : '请先填写 Telegram Bot Token + Chat ID 或 Webhook URL 并保存后再测试'
    );
  }
  return { ok: true, ...res };
}

export async function getAdminMailConfig(env: Env) {
  const [config, logs] = await Promise.all([getSiteMailConfigSafe(env, 0), listSiteMailLogs(env, 0, 25)]);
  return { config, logs };
}

export async function saveAdminMailConfig(env: Env, body: Record<string, unknown>) {
  try {
    const config = await saveSiteMailConfig(env, 0, {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      auto_send_order: body.auto_send_order !== undefined ? Boolean(body.auto_send_order) : undefined,
      auto_send_restock: body.auto_send_restock !== undefined ? Boolean(body.auto_send_restock) : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      from_name: typeof body.from_name === 'string' ? body.from_name : undefined,
      from_email: typeof body.from_email === 'string' ? body.from_email : undefined,
      reply_to: typeof body.reply_to === 'string' ? body.reply_to : undefined,
      api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
      clear_api_key: Boolean(body.clear_api_key),
      api_endpoint: typeof body.api_endpoint === 'string' ? body.api_endpoint : undefined,
      mailgun_domain: typeof body.mailgun_domain === 'string' ? body.mailgun_domain : undefined,
      footer_note: typeof body.footer_note === 'string' ? body.footer_note : undefined,
    });
    return { ok: true, config };
  } catch (err) {
    throw Errors.validation(err instanceof Error ? err.message : '保存邮箱配置失败');
  }
}

export async function sendAdminMailTest(env: Env, toEmail: string) {
  const to = toEmail.trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw Errors.validation('请输入有效的测试收件邮箱');
  }
  const brand = await resolveOrderBrandNameRepo(createDb(env.DB), 0);
  const res = await sendTestDeliveryEmail(env, 0, to, brand);
  if (!res.ok) throw Errors.validation(`测试发信失败：${res.error || '未知错误'}`);
  return { ok: true, provider: res.provider };
}

export async function resendAdminOrderEmail(env: Env, orderNo: string, _originUrl?: string) {
  const db = createDb(env.DB);
  const found = await findOrderWithProductWarrantyRepo(db, orderNo);
  if (!found) throw Errors.notFound('订单不存在');

  const order = found.order;
  if (order.status !== 'delivered' || !order.deliveredPayload) {
    throw Errors.conflict('订单尚无可补发的交付凭证');
  }
  if (!order.publicOrderNo) {
    throw Errors.conflict('该历史订单没有公开查单号，请通过原订单账号查询');
  }
  const result = await resendQueuedOrderEmail(env, order.id, order.agentId ?? 0, order.publicOrderNo);
  return { ok: true, to: order.contactEmail, mail_status: result.mail_status };
}

export async function updateAdminPaymentPlugin(
  env: Env,
  id: string,
  body: { enabled?: boolean; config?: Record<string, string> }
) {
  if (id === 'stripe' && !isSandboxEnabled(env)) {
    const secret = body.config?.secret_key?.trim();
    const publishable = body.config?.publishable_key?.trim();
    if (secret && !isStripeLiveSecret(secret)) {
      throw Errors.validation('当前环境仅允许 Stripe 正式 Secret Key');
    }
    if (publishable && !/^pk_live_[A-Za-z0-9_]+$/.test(publishable)) {
      throw Errors.validation('当前环境仅允许 Stripe 正式 Publishable Key');
    }
    if (body.enabled === true) {
      const { config } = await loadPaymentPluginConfig<StripePluginConfig>(env, id);
      requireLiveStripeKeys({
        secret_key: secret || config.secret_key,
        publishable_key: body.config?.publishable_key ?? config.publishable_key,
      });
    }
  }
  const publicFields = paymentPluginPublicFields[id];
  const secretFields = paymentPluginSecretFields[id];
  const allowedPublic = new Set(Array.isArray(publicFields) ? publicFields : []);
  const allowedSecret = new Set(Array.isArray(secretFields) ? secretFields : []);
  const configPatch: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(body.config ?? {})) {
    if (allowedSecret.has(field) && typeof value === 'string' && value.trim()) {
      configPatch[field] = await sealPaymentPluginCredential(env, id, field, value);
    } else if (allowedPublic.has(field) && typeof value === 'string') {
      if (field === 'channels') {
        let channels: unknown;
        try {
          channels = JSON.parse(value);
        } catch {
          throw Errors.validation('支付渠道需使用 JSON 字符串数组');
        }
        if (!Array.isArray(channels) || channels.some((channel) => typeof channel !== 'string')) {
          throw Errors.validation('支付渠道需使用 JSON 字符串数组');
        }
        configPatch[field] = channels;
      } else if (id === 'balance' && field === 'min_topup') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0.01 || parsed > 50000) {
          throw Errors.validation('最低充值金额需在 ¥0.01 – ¥50,000 之间');
        }
        configPatch[field] = Number(parsed.toFixed(2));
      } else if (id === 'balance' && field === 'cdk_purchase_url') {
        const trimmed = value.trim();
        if (trimmed && !/^https?:\/\/[^\s<>"']{3,500}$/i.test(trimmed)) {
          throw Errors.validation('外部发卡购买链接必须以 http:// 或 https:// 开头');
        }
        configPatch[field] = trimmed;
      } else if (id === 'balance' && field === 'cdk_purchase_label') {
        configPatch[field] = value.trim().slice(0, 40);
      } else {
        configPatch[field] = value;
      }
    }
  }
  if (id === 'stripe' && (body.enabled === true || Object.keys(configPatch).length > 0)) {
    const current = await loadStripeCurrencyConfig(env);
    const config = { ...current, ...configPatch };
    validateStripeCurrencyConfig(config);
  }
  await updatePaymentPluginRepo(createDb(env.DB), id, {
    ...(body.enabled !== undefined ? { enabled: body.enabled ? 1 : 0 } : {}),
    ...(Object.keys(configPatch).length ? { configJson: JSON.stringify(configPatch) } : {}),
  });
  return { ok: true };
}
