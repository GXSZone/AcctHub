/**
 * 总控后台支付网关插件密钥配置与启停标签页（含实时汇率监控同步）
 */

import { Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';

interface PaymentPluginRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  config_json: string;
  secrets_configured: Record<string, boolean>;
}

interface AdminPaymentsTabProps {
  plugins: PaymentPluginRow[];
  fxSnapshot?: {
    usd_cny: number;
    usdt_cny: number;
    updated_at: string;
    source: string;
  };
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function AdminPaymentsTab({
  plugins,
  fxSnapshot,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminPaymentsTabProps) {
  const ac = useAdminCoreI18n();
  const rf = useRiskControlI18n();
  const [pluginDrafts, setPluginDrafts] = useState<Record<string, Record<string, string>>>({});
  const [syncingFx, setSyncingFx] = useState(false);

  useEffect(() => {
    const next: Record<string, Record<string, string>> = {};
    for (const pl of plugins) {
      try {
        const parsed = JSON.parse(pl.config_json || '{}') as Record<string, unknown>;
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
        }
        for (const k of Object.keys(pl.secrets_configured ?? {})) flat[k] = '';
        next[pl.id] = flat;
      } catch {
        next[pl.id] = {};
      }
    }
    setPluginDrafts(next);
  }, [plugins]);

  const handleSyncFx = async () => {
    setSyncingFx(true);
    try {
      const res = await adminApi.syncPaymentFx();
      await onReload();
      if (res.ok) {
        showToast(
          fmt(ac.payFxSyncOkToast, {
            usd: res.snapshot.usd_cny,
            usdt: res.snapshot.usdt_cny,
            source: res.snapshot.source,
          })
        );
      } else {
        showToast(res.guardMessage || ac.payFxGuardToast);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : ac.payFxFailErr);
    } finally {
      setSyncingFx(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="paper-card rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="text-xs font-semibold">{ac.payFxTitle}</div>
          <div className="text-[11.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
            {fmt(ac.payFxSummary, {
              usd: fxSnapshot?.usd_cny ?? 6.7,
              usdt: fxSnapshot?.usdt_cny ?? 6.72,
            })}
            {fxSnapshot?.source || 'default'}
            {fxSnapshot?.updated_at
              ? fmt(ac.payFxUpdatedAt, { time: fxSnapshot.updated_at })
              : ac.payFxPendingRefresh}
          </div>
        </div>
        <button
          type="button"
          disabled={syncingFx}
          onClick={() => void handleSyncFx()}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {syncingFx ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {ac.payFxRefreshBtn}
        </button>
      </div>

      <div className="paper-card rounded-2xl p-6 space-y-4">
        <h2 className="font-editorial text-xl font-semibold">{ac.payPluginsTitle}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plugins.map((pl) => {
            const cfg = pluginDrafts[pl.id] || {};
            const keys = Object.keys(cfg);
            return (
              <div
                key={pl.id}
                className="p-5 rounded-2xl border flex flex-col justify-between gap-4"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{pl.name}</span>
                    <span
                      className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: pl.enabled ? 'var(--success-soft)' : 'var(--bg-subtle)',
                        color: pl.enabled ? 'var(--success)' : 'var(--ink-muted)',
                      }}
                    >
                      {pl.enabled ? ac.payPluginEnabled : ac.payPluginDisabled}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                    {pl.description}
                  </p>

                  {keys.length > 0 && (
                    <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
                      {keys.map((k) => {
                        const isSecret = Object.hasOwn(pl.secrets_configured ?? {}, k);
                        const label = k === 'fee_rate_pct' ? rf.payFeeRateLabel : getPaymentFieldLabel(k, ac);
                        return (
                          <div key={k}>
                            <div
                              className="flex items-center justify-between gap-2 text-[11px] mb-1"
                              style={{ color: 'var(--ink-muted)' }}
                            >
                              <span className="font-medium" style={{ color: 'var(--ink-secondary)' }}>
                                {label}
                              </span>
                              <span className="font-mono-num text-[10px] opacity-75">{k}</span>
                            </div>
                            <input
                              type={isSecret ? 'password' : 'text'}
                              value={cfg[k] || ''}
                              onChange={(e) =>
                                setPluginDrafts((prev) => ({
                                  ...prev,
                                  [pl.id]: { ...cfg, [k]: e.target.value },
                                }))
                              }
                              autoComplete={isSecret ? 'new-password' : undefined}
                              placeholder={
                                isSecret && pl.secrets_configured[k]
                                  ? ac.paySecretKeepPlaceholder
                                  : fmt(ac.payParamPlaceholder, { key: label })
                              }
                              className="acct-input py-1.5 text-xs font-mono-num"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const patch = Object.fromEntries(
                        Object.entries(cfg).filter(
                          ([key, value]) => !Object.hasOwn(pl.secrets_configured ?? {}, key) || value.trim()
                        )
                      );
                      await adminApi.updatePaymentPlugin(pl.id, { config: patch });
                      await onReload();
                      onStorefrontUpdated();
                      showToast(fmt(ac.payConfigSavedToast, { name: pl.name }));
                    }}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                  >
                    {ac.paySaveBtn}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await adminApi.updatePaymentPlugin(pl.id, { enabled: !pl.enabled });
                      await onReload();
                      onStorefrontUpdated();
                      showToast(
                        fmt(ac.payPluginToggledToast, {
                          name: pl.name,
                          state: pl.enabled ? ac.payStateDisabled : ac.payStateEnabled,
                        })
                      );
                    }}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-medium border cursor-pointer"
                    style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    {pl.enabled ? ac.payActionDisable : ac.payActionEnable}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getPaymentFieldLabel(key: string, ac: ReturnType<typeof useAdminCoreI18n>): string {
  const map: Record<string, string> = {
    min_topup: ac.payFieldMinTopup,
    cdk_purchase_url: ac.payFieldCdkPurchaseUrl,
    cdk_purchase_label: ac.payFieldCdkPurchaseLabel,
    mode: ac.payFieldMode,
    channels: ac.payFieldChannels,
    api_url: ac.payFieldApiUrl,
    pid: ac.payFieldPid,
    pay_type: ac.payFieldPayType,
    key: ac.payFieldKey,
    publishable_key: ac.payFieldPublishableKey,
    secret_key: ac.payFieldSecretKey,
    webhook_secret: ac.payFieldWebhookSecret,
    currency: ac.payFieldCurrency,
    usd_cny_rate: ac.payFieldUsdCnyRate,
    hkd_cny_rate: ac.payFieldHkdCnyRate,
    auto_fx: ac.payFieldAutoFx,
    app_id: ac.payFieldAppId,
    alipay_public_key: ac.payFieldAlipayPublicKey,
    private_key: ac.payFieldPrivateKey,
    gateway_url: ac.payFieldGatewayUrl,
    wallet_address: ac.payFieldWalletAddress,
    usdt_cny_rate: ac.payFieldUsdtCnyRate,
    rate_markup: ac.payFieldRateMarkup,
    trongrid_api_key: ac.payFieldTrongridApiKey,
    explorer_api_key: ac.payFieldExplorerApiKey,
  };
  return map[key] || key;
}
