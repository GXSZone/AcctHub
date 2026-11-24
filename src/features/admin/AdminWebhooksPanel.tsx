import { BUSINESS_WEBHOOK_EVENTS, type BusinessWebhookEvent } from '@shared/contracts/extensions.contract';
import { Loader2, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { extensionsApi } from '../../api/extensions.api';
import { fmt } from '../../i18n';
import { useExtensionsI18n } from '../../i18n/namespaces/extensions';
import {
  useAdminWebhooksQuery,
  useCreateWebhookMutation,
  useDeleteWebhookMutation,
} from '../../queries/extensions.queries';

export function AdminWebhooksPanel({ showToast }: { showToast: (msg: string) => void }) {
  const pc = useExtensionsI18n();
  const listQuery = useAdminWebhooksQuery();
  const createMut = useCreateWebhookMutation();
  const deleteMut = useDeleteWebhookMutation();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<BusinessWebhookEvent[]>(['order.delivered', 'order.refunded']);
  const [allowOverride, setAllowOverride] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  const toggleEvent = (ev: BusinessWebhookEvent) => {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (events.length === 0) return;
    try {
      await createMut.mutateAsync({
        name: name.trim(),
        url: url.trim(),
        secret: secret.trim() || undefined,
        events,
        enabled: true,
        allow_fulfill_override: allowOverride,
      });
      setName('');
      setUrl('');
      setSecret('');
      setAllowOverride(false);
      showToast(pc.webhooksCreatedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await extensionsApi.testWebhook(id);
      if (res.ok) showToast(fmt(pc.webhooksTestOkToast, { status: res.status }));
      else showToast(fmt(pc.webhooksTestFailToast, { error: res.error || String(res.status) }));
    } catch (err) {
      showToast(fmt(pc.webhooksTestFailToast, { error: err instanceof Error ? err.message : 'Error' }));
    } finally {
      setTestingId(null);
    }
  };

  const hooks = listQuery.data?.webhooks ?? [];

  return (
    <div className="paper-card rounded-2xl p-6 space-y-6">
      <div>
        <h2 className="font-editorial text-xl font-semibold flex items-center gap-2">
          <Webhook className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {pc.webhooksTitle}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {pc.webhooksDesc}
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold">{pc.webhooksAddTitle}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] mb-1">{pc.webhooksNameLabel}</div>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ERP / Fulfillment Hook"
              className="acct-input text-xs"
            />
          </div>
          <div>
            <div className="text-[11px] mb-1">{pc.webhooksUrlLabel}</div>
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/webhooks/accthub"
              className="acct-input text-xs font-mono-num"
            />
          </div>
          <div>
            <div className="text-[11px] mb-1">{pc.webhooksSecretLabel}</div>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="whsec_..."
              className="acct-input text-xs font-mono-num"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold">{pc.webhooksEventsLabel}:</span>
          {BUSINESS_WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} className="inline-flex items-center gap-1.5 cursor-pointer font-mono-num">
              <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
              <span>{ev}</span>
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={allowOverride}
            onChange={(e) => setAllowOverride(e.target.checked)}
          />
          <span>{pc.webhooksAllowOverrideLabel}</span>
        </label>

        <button
          type="submit"
          disabled={createMut.isPending || events.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {createMut.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {pc.webhooksCreateBtn}
        </button>
      </form>

      {listQuery.isLoading ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : hooks.length === 0 ? (
        <p className="text-xs py-2" style={{ color: 'var(--ink-muted)' }}>
          {pc.webhooksEmpty}
        </p>
      ) : (
        <div className="space-y-2.5">
          {hooks.map((h) => (
            <div
              key={h.id}
              className="rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold">{h.name}</span>
                  {h.events.map((ev) => (
                    <span
                      key={ev}
                      className="text-[10px] font-mono-num px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                    >
                      {ev}
                    </span>
                  ))}
                  {h.last_status !== null && (
                    <span
                      className="text-[10px] font-mono-num px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor:
                          h.last_status >= 200 && h.last_status < 300
                            ? 'var(--success-soft)'
                            : 'var(--danger-soft)',
                        color:
                          h.last_status >= 200 && h.last_status < 300 ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      HTTP {h.last_status}
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono-num truncate" style={{ color: 'var(--ink-muted)' }}>
                  {h.url}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={testingId === h.id}
                  onClick={() => void handleTest(h.id)}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-1 cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)' }}
                >
                  {testingId === h.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  {pc.webhooksTestBtn}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void deleteMut.mutateAsync(h.id).then(() => showToast(pc.webhooksDeletedToast))
                  }
                  className="px-2.5 py-1.5 rounded-lg border text-xs inline-flex items-center gap-1 cursor-pointer"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  <Trash2 className="w-3 h-3" />
                  {pc.webhooksDeleteBtn}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
