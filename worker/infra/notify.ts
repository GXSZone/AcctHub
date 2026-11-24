import { inArray } from 'drizzle-orm';
import { siteSettings } from '../db/schema/index';
import type { Env } from '../env';
import { createDb } from './db';
import { readSiteCredential } from './site-credential';

export type OpsNotifyEvent =
  | 'new_order'
  | 'new_ticket'
  | 'low_stock'
  | 'withdrawal'
  | 'restock'
  | 'upstream_alert';

export interface OpsNotifyConfig {
  tgBotToken: string;
  tgChatId: string;
  webhookUrl: string;
  events: OpsNotifyEvent[];
  lowStockThreshold: number;
}

const OPS_NOTIFY_KEYS = [
  'notify_tg_bot_token',
  'notify_tg_chat_id',
  'notify_webhook_url',
  'notify_events_json',
  'notify_low_stock_threshold',
] as const;

/** 读取运维告警通道与事件订阅配置（100% Drizzle ORM） */
export async function getOpsNotifyConfig(env: Env): Promise<OpsNotifyConfig> {
  const rows = await createDb(env.DB)
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(inArray(siteSettings.key, [...OPS_NOTIFY_KEYS]));

  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.key === 'notify_tg_bot_token' ? r.value || '' : (r.value || '').trim();

  let events: OpsNotifyEvent[] = [
    'new_order',
    'new_ticket',
    'low_stock',
    'withdrawal',
    'restock',
    'upstream_alert',
  ];
  if (map.notify_events_json) {
    try {
      const parsed = JSON.parse(map.notify_events_json);
      if (Array.isArray(parsed)) events = parsed as OpsNotifyEvent[];
    } catch (err) {
      console.warn('Invalid notify_events_json:', err instanceof Error ? err.message : String(err));
    }
  }

  return {
    tgBotToken: await readSiteCredential(env, 'notify_tg_bot_token', map.notify_tg_bot_token || ''),
    tgChatId: map.notify_tg_chat_id || '',
    webhookUrl: map.notify_webhook_url || '',
    events,
    lowStockThreshold: Math.max(0, Number(map.notify_low_stock_threshold ?? 3) || 3),
  };
}

/**
 * 向配置的 Telegram Bot 与通用 JSON Webhook 派发运维告警。
 * 严格吞并网络异常确保绝不阻断下单、工单等核心业务主流程。
 */
export async function dispatchOpsNotification(
  env: Env,
  event: OpsNotifyEvent,
  title: string,
  lines: string[],
  force = false
): Promise<{ sentTelegram: boolean; sentWebhook: boolean; errors: string[] }> {
  const cfg = await getOpsNotifyConfig(env);
  const errors: string[] = [];
  let sentTelegram = false;
  let sentWebhook = false;

  if (!force && !cfg.events.includes(event)) {
    return { sentTelegram, sentWebhook, errors };
  }

  const text = [`【${title}】`, ...lines].join('\n');

  if (cfg.tgBotToken && cfg.tgChatId) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(cfg.tgBotToken)}/sendMessage`,
        {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify({
            chat_id: cfg.tgChatId,
            text,
            disable_web_page_preview: true,
          }),
        }
      );
      if (res.ok) sentTelegram = true;
      else errors.push(`Telegram HTTP ${res.status}`);
    } catch {
      errors.push('Telegram 请求失败');
    }
  }

  if (cfg.webhookUrl && /^https?:\/\//i.test(cfg.webhookUrl)) {
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify({
          event,
          title,
          text,
          lines,
          timestamp: new Date().toISOString(),
        }),
      });
      if (res.ok) sentWebhook = true;
      else errors.push(`Webhook HTTP ${res.status}`);
    } catch (err) {
      errors.push(`Webhook: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  return { sentTelegram, sentWebhook, errors };
}
