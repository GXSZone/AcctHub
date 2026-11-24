/**
 * 运营总控后台：SaaS 多租户全局能力开关、主站白名单与分站独立域名授权中心
 */

import { CheckCircle2, Globe, Loader2, RefreshCw, Save, Shield, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { type AdminTenantDomainRow, tenantAdminApi } from '../../api/tenant-admin.api';
import { useSaasI18n } from '../../i18n/namespaces/saas';

export function AdminSaasGovernanceCard({
  showToast,
  onPolicyLoaded,
}: {
  showToast: (msg: string) => void;
  onPolicyLoaded?: (policy: { allowOwnPayGlobal: boolean; allowPrivateGlobal: boolean }) => void;
}) {
  const ss = useSaasI18n();
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [mainHostsText, setMainHostsText] = useState('');
  const [allowPrivateGlobal, setAllowPrivateGlobal] = useState(false);
  const [allowOwnPayGlobal, setAllowOwnPayGlobal] = useState(false);

  const [domains, setDomains] = useState<AdminTenantDomainRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expiryDrafts, setExpiryDrafts] = useState<Record<number, string>>({});
  const [busyDomainId, setBusyDomainId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [pol, doms] = await Promise.all([tenantAdminApi.getSaasPolicy(), tenantAdminApi.listDomains()]);
      const ownPayOn = Boolean(pol.saas_allow_own_payment_global);
      const privOn = ownPayOn && Boolean(pol.saas_allow_private_products_global);
      setMainHostsText(pol.main_hostnames || '');
      setAllowOwnPayGlobal(ownPayOn);
      setAllowPrivateGlobal(privOn);
      onPolicyLoaded?.({ allowOwnPayGlobal: ownPayOn, allowPrivateGlobal: privOn });
      setDomains(doms.items || []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load SaaS governance');
    } finally {
      setLoading(false);
    }
  }, [onPolicyLoaded, showToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      const hosts = mainHostsText
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const effectivePrivate = allowOwnPayGlobal && allowPrivateGlobal;
      await tenantAdminApi.updateSaasPolicy({
        main_hostnames: hosts.join(', '),
        saas_allow_own_payment_global: allowOwnPayGlobal,
        saas_allow_private_products_global: effectivePrivate,
        private_product_platform_fee_pct: 0,
      });
      await loadAll();
      showToast(ss.adminPolicySavedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSavingPolicy(false);
    }
  };

  const actDomain = async (
    id: number,
    action: 'approve' | 'revoke' | 'sync' | 'set_expiry',
    expiresAt?: string | null
  ) => {
    setBusyDomainId(id);
    try {
      const res = await tenantAdminApi.authorizeDomain(id, {
        action,
        expires_at: expiresAt,
      });
      await loadAll();
      showToast(res.message || res.status);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyDomainId(null);
    }
  };

  const filteredDomains = domains.filter((d) => {
    if (statusFilter === 'pending') return d.status === 'pending_dns' || d.status === 'pending_review';
    if (statusFilter === 'active') return d.status === 'active';
    if (statusFilter === 'revoked') return d.status === 'revoked' || d.status === 'expired';
    return true;
  });

  if (loading) {
    return (
      <div className="paper-card rounded-2xl p-8 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SaaS 全局策略与主站白名单 */}
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div className="pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{ss.adminSaasPolicyTitle}</h2>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ss.adminSaasPolicyDesc}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="md:col-span-2">
            <div className="block font-semibold mb-1">{ss.adminMainHostsLabel}</div>
            <input
              type="text"
              value={mainHostsText}
              onChange={(e) => setMainHostsText(e.target.value)}
              placeholder={ss.adminMainHostsPlaceholder}
              className="acct-input font-mono-num"
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ss.adminMainHostsHint}
            </p>
          </div>

          <label
            className="flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <input
              type="checkbox"
              checked={allowOwnPayGlobal}
              onChange={(e) => {
                const next = e.target.checked;
                setAllowOwnPayGlobal(next);
                if (!next) setAllowPrivateGlobal(false);
              }}
            />
            <span className="font-medium">{ss.adminAllowOwnPayGlobal}</span>
          </label>

          <label
            className="flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <input
              type="checkbox"
              checked={allowPrivateGlobal}
              onChange={(e) => {
                const next = e.target.checked;
                setAllowPrivateGlobal(next);
                if (next) setAllowOwnPayGlobal(true);
              }}
            />
            <span className="font-medium">{ss.adminAllowPrivateGlobal}</span>
          </label>

          <div
            className="md:col-span-2 px-3.5 py-2.5 rounded-xl border text-[11px] leading-relaxed"
            style={{
              borderColor: 'color-mix(in srgb, var(--warning) 45%, var(--border-color))',
              backgroundColor: 'var(--warning-soft)',
              color: 'var(--ink-primary)',
            }}
          >
            {ss.adminPrivateOwnPayRuleHint}
          </div>
        </div>

        <button
          type="button"
          disabled={savingPolicy}
          onClick={() => void handleSavePolicy()}
          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {savingPolicy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {ss.adminSavePolicyBtn}
        </button>
      </div>

      {/* 分站独立域名授权中心 */}
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div
          className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="font-editorial text-xl font-semibold">{ss.adminDomainsTitle}</h2>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ss.adminDomainsDesc}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs">
            {(
              [
                ['all', ss.adminDomFilterAll],
                ['pending', ss.adminDomFilterPending],
                ['active', ss.adminDomFilterActive],
                ['revoked', ss.adminDomFilterRevoked],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className="px-2.5 py-1 rounded-full cursor-pointer"
                style={{
                  backgroundColor: statusFilter === k ? 'var(--accent)' : 'var(--bg-subtle)',
                  color: statusFilter === k ? '#FAF9F5' : 'var(--ink-secondary)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredDomains.length === 0 ? (
          <div className="py-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ss.adminDomEmpty}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-4">{ss.adminDomColHost}</th>
                  <th className="py-2 pr-4">{ss.adminDomColMode}</th>
                  <th className="py-2 pr-4">{ss.adminDomColExpiry}</th>
                  <th className="py-2 text-right">{ss.adminDomColActions}</th>
                </tr>
              </thead>
              <tbody>
                {filteredDomains.map((d) => {
                  const busy = busyDomainId === d.id;
                  const expDraft = expiryDrafts[d.id] ?? (d.expires_at ? d.expires_at.slice(0, 10) : '');
                  return (
                    <tr
                      key={d.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-3 pr-4">
                        <div className="font-mono-num font-semibold">{d.hostname}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {d.agent_brand || '-'} (@{d.agent_slug || d.agent_id})
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                          style={{
                            backgroundColor:
                              d.status === 'active'
                                ? 'var(--success-soft)'
                                : d.status === 'revoked' || d.status === 'expired'
                                  ? 'var(--danger-soft)'
                                  : 'var(--accent-soft)',
                            color:
                              d.status === 'active'
                                ? 'var(--success)'
                                : d.status === 'revoked' || d.status === 'expired'
                                  ? 'var(--danger)'
                                  : 'var(--accent)',
                          }}
                        >
                          {d.status}
                        </span>
                        <div
                          className="text-[10.5px] font-mono-num mt-0.5"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {d.auth_mode} · SSL: {d.ssl_status}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={expDraft}
                            onChange={(e) => setExpiryDrafts((p) => ({ ...p, [d.id]: e.target.value }))}
                            className="acct-input py-1 px-2 text-[11px] w-36 font-mono-num"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void actDomain(d.id, 'set_expiry', expDraft ? `${expDraft}T23:59:59Z` : null)
                            }
                            className="px-2 py-1 rounded-lg border text-[11px] cursor-pointer whitespace-nowrap"
                            style={{ borderColor: 'var(--border-strong)' }}
                          >
                            {ss.adminDomSetExpiryBtn}
                          </button>
                        </div>
                      </td>
                      <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                        {d.status !== 'active' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void actDomain(d.id, 'approve', expDraft ? `${expDraft}T23:59:59Z` : null)
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium cursor-pointer"
                            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {ss.adminDomApproveBtn}
                          </button>
                        )}
                        {d.status !== 'revoked' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void actDomain(d.id, 'revoke')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium cursor-pointer"
                            style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                          >
                            <XCircle className="w-3 h-3" />
                            {ss.adminDomRevokeBtn}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void actDomain(d.id, 'sync')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] cursor-pointer"
                          style={{ borderColor: 'var(--border-strong)' }}
                          title={ss.adminDomSyncBtn}
                        >
                          <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
