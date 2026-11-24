/**
 * 分站自有收款渠道配置面板（仅在总控授权 allow_own_payment 开启时展示）
 */

import { AlertTriangle, ArrowRight, CreditCard, Loader2, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { useSaasI18n } from '../../i18n/namespaces/saas';

interface PluginRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  config_json: string;
  secrets_configured: Record<string, boolean>;
  updated_at: string;
}

const PLUGIN_FIELDS: Record<
  string,
  Array<{ key: string; label: string; secret?: boolean; placeholder?: string }>
> = {
  epay: [
    { key: 'api_url', label: 'API Gateway URL', placeholder: 'https://pay.example.com' },
    { key: 'pid', label: 'Merchant PID', placeholder: '10001' },
    { key: 'key', label: 'Merchant Key', secret: true },
    { key: 'fee_rate_pct', label: 'Buyer Fee % (0-30)', placeholder: '0' },
  ],
  alipay_f2f: [
    { key: 'app_id', label: 'Alipay App ID' },
    { key: 'private_key', label: 'Merchant Private Key (RSA2)', secret: true },
    { key: 'alipay_public_key', label: 'Alipay Public Key', secret: true },
    { key: 'fee_rate_pct', label: 'Buyer Fee % (0-30)', placeholder: '0' },
  ],
  stripe: [
    { key: 'publishable_key', label: 'Publishable Key' },
    { key: 'secret_key', label: 'Secret Key', secret: true },
    { key: 'webhook_secret', label: 'Webhook Secret', secret: true },
    { key: 'currency', label: 'Currency (usd / cny / hkd)', placeholder: 'usd' },
    { key: 'fee_rate_pct', label: 'Buyer Fee % (0-30)', placeholder: '0' },
  ],
  usdt_trc20: [
    { key: 'wallet_address', label: 'TRC20 Wallet Address' },
    { key: 'usdt_cny_rate', label: 'USDT/CNY Rate', placeholder: '7.25' },
    { key: 'trongrid_api_key', label: 'TronGrid API Key', secret: true },
    { key: 'fee_rate_pct', label: 'Buyer Fee % (0-30)', placeholder: '0' },
  ],
};

export function AgentPaymentConfigTab({
  allowPrivateProducts = false,
  onGoPrivateCatalog,
  onToast,
  onError,
}: {
  allowPrivateProducts?: boolean;
  onGoPrivateCatalog?: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const ss = useSaasI18n();
  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; config: Record<string, string> }>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadPlugins = useCallback(async () => {
    try {
      const res = await tenantAgentApi.listOwnPaymentPlugins();
      const list = res.plugins || [];
      setPlugins(list);
      const next: Record<string, { enabled: boolean; config: Record<string, string> }> = {};
      for (const p of list) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(p.config_json || '{}') as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        const cfg: Record<string, string> = {};
        for (const f of PLUGIN_FIELDS[p.id] || []) {
          cfg[f.key] = f.secret ? '' : String(parsed[f.key] ?? '');
        }
        next[p.id] = { enabled: p.enabled === 1, config: cfg };
      }
      setDrafts(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleSave = async (pluginId: string) => {
    const draft = drafts[pluginId];
    if (!draft) return;
    setSavingId(pluginId);
    try {
      await tenantAgentApi.updateOwnPaymentPlugin(pluginId, {
        enabled: draft.enabled,
        config: draft.config,
      });
      await loadPlugins();
      onToast(ss.payOwnSavedToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="paper-card rounded-2xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ss.payOwnTitle}</h2>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {ss.payOwnDesc}
        </p>
        <div
          className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs"
          style={{
            borderColor: 'var(--warning)',
            backgroundColor: 'var(--warning-soft)',
            color: 'var(--warning)',
          }}
        >
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{allowPrivateProducts ? ss.payOwnBalanceWarn : ss.payOwnNeedPrivateHint}</span>
          </div>
          {allowPrivateProducts && onGoPrivateCatalog && (
            <button
              type="button"
              onClick={onGoPrivateCatalog}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer shrink-0"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <span>{ss.payOwnGoPrivateBtn}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {plugins.map((p) => {
          const draft = drafts[p.id] || { enabled: false, config: {} };
          const fields = PLUGIN_FIELDS[p.id] || [];
          const saving = savingId === p.id;
          return (
            <div key={p.id} className="paper-card rounded-2xl p-5 space-y-3.5 text-xs">
              <div
                className="flex items-center justify-between gap-2 pb-2.5 border-b"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div>
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {p.description}
                  </div>
                </div>
                <label className="inline-flex items-center gap-1.5 font-medium cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [p.id]: { ...draft, enabled: e.target.checked },
                      }))
                    }
                  />
                  {ss.payOwnEnabledLabel}
                </label>
              </div>

              <div className="space-y-2.5">
                {fields.map((f) => (
                  <div key={f.key}>
                    <div className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      {f.label}
                      {f.secret && p.secrets_configured?.[f.key] ? ' (configured)' : ''}
                    </div>
                    <input
                      type={f.secret ? 'password' : 'text'}
                      value={draft.config[f.key] || ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.id]: {
                            ...draft,
                            config: { ...draft.config, [f.key]: e.target.value },
                          },
                        }))
                      }
                      placeholder={
                        f.secret && p.secrets_configured?.[f.key]
                          ? '•••••••• (leave blank to keep)'
                          : f.placeholder || ''
                      }
                      className="acct-input font-mono-num text-xs"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave(p.id)}
                className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {ss.payOwnSaveBtn}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
