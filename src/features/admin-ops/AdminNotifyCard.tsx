/**
 * Telegram / Webhook 运营告警引擎配置卡片
 */

import { Bell, CheckCircle2, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { fmt } from '../../i18n';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';

export interface NotifyConfigState {
  tg_has_token: boolean;
  tg_token_masked: string;
  tg_chat_id: string;
  webhook_url: string;
  events: string[];
  low_stock_threshold: number;
}

export function AdminNotifyCard({
  notifyConfig,
  onReload,
  showToast,
}: {
  notifyConfig?: NotifyConfigState;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const ao = useAdminOpsI18n();
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState(notifyConfig?.tg_chat_id || '');
  const [webhookUrl, setWebhookUrl] = useState(notifyConfig?.webhook_url || '');
  const [threshold, setThreshold] = useState(notifyConfig?.low_stock_threshold ?? 3);
  const [events, setEvents] = useState<string[]>(
    notifyConfig?.events || ['new_order', 'new_ticket', 'low_stock', 'withdrawal', 'restock']
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!notifyConfig) return;
    setTgChatId(notifyConfig.tg_chat_id || '');
    setWebhookUrl(notifyConfig.webhook_url || '');
    setThreshold(notifyConfig.low_stock_threshold ?? 3);
    if (Array.isArray(notifyConfig.events)) setEvents(notifyConfig.events);
  }, [notifyConfig]);

  const toggleEvent = (ev: string) => {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await adminApi.updateNotifyConfig({
            tg_bot_token: tgToken.trim() || undefined,
            tg_chat_id: tgChatId,
            webhook_url: webhookUrl,
            events,
            low_stock_threshold: threshold,
          });
          setTgToken('');
          await onReload();
          showToast(ao.notSavedToast);
        } finally {
          setSaving(false);
        }
      }}
      className="paper-card rounded-2xl p-6 space-y-4 mt-6"
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ao.notTitle}</h2>
        </div>
        <button
          type="button"
          disabled={testing}
          onClick={async () => {
            setTesting(true);
            try {
              await adminApi.testNotify();
              showToast(ao.notTestOkToast);
            } catch (err) {
              showToast(err instanceof Error ? err.message : ao.notTestFailErr);
            } finally {
              setTesting(false);
            }
          }}
          className="px-3.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
          style={{
            borderColor: 'var(--accent)',
            backgroundColor: 'var(--accent-soft)',
            color: 'var(--accent)',
          }}
        >
          {testing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {ao.notTestBtn}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div>
          <div className="block font-semibold mb-1">{ao.notTgTokenLabel}</div>
          <input
            type="password"
            value={tgToken}
            onChange={(e) => setTgToken(e.target.value)}
            placeholder={
              notifyConfig?.tg_has_token
                ? fmt(ao.notTgTokenMaskedPh, { masked: notifyConfig.tg_token_masked })
                : ao.notTgTokenEmptyPh
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{ao.notTgChatLabel}</div>
          <input
            type="text"
            value={tgChatId}
            onChange={(e) => setTgChatId(e.target.value)}
            placeholder={ao.notTgChatPh}
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{ao.notWebhookLabel}</div>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-server.com/webhook/accthub"
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{ao.notThresholdLabel}</div>
          <input
            type="number"
            min={0}
            max={999}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="acct-input font-mono-num"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {[
          { id: 'new_order', label: ao.notEvNewOrder },
          { id: 'new_ticket', label: ao.notEvNewTicket },
          { id: 'low_stock', label: ao.notEvLowStock },
          { id: 'withdrawal', label: ao.notEvWithdrawal },
          { id: 'restock', label: ao.notEvRestock },
          { id: 'upstream_alert', label: ao.notEvUpstreamAlert },
        ].map((ev) => (
          <label key={ev.id} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={events.includes(ev.id)} onChange={() => toggleEvent(ev.id)} />
            <span>{ev.label}</span>
          </label>
        ))}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        {ao.notSaveBtn}
      </button>
    </form>
  );
}
