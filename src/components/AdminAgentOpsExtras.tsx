import { Banknote, CheckCircle2, Globe, Loader2, Save, Shield, XCircle } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { adminApi } from '../api/admin.api';
import { fmt } from '../i18n';
import { useAdminAgentsI18n } from '../i18n/namespaces/admin-agents';
import type { AgentWithdrawalRecord } from '../types';
import { openConfirm } from './ConfirmDialog';

export interface SaasConfigState {
  neutral_base_domain: string;
  saas_cname_target: string;
  cf_saas_zone_id: string;
  cf_saas_has_token: boolean;
  cf_saas_token_masked: string;
  agent_signup_platform_fee_pct: number;
  agent_withdrawal_fee_pct?: number;
}

interface Props {
  saasConfig?: SaasConfigState;
  withdrawals: AgentWithdrawalRecord[];
  section?: 'all' | 'saas' | 'withdrawals';
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminAgentOpsExtras({
  saasConfig,
  withdrawals,
  section = 'all',
  onReload,
  showToast,
}: Props) {
  const aa = useAdminAgentsI18n();
  const [neutralDomain, setNeutralDomain] = useState(saasConfig?.neutral_base_domain || '');
  const [cnameTarget, setCnameTarget] = useState(saasConfig?.saas_cname_target || '');
  const [zoneId, setZoneId] = useState(saasConfig?.cf_saas_zone_id || '');
  const [apiToken, setApiToken] = useState('');
  const [feePct, setFeePct] = useState<number>(saasConfig?.agent_signup_platform_fee_pct ?? 0);
  const [wdFeePct, setWdFeePct] = useState<number>(saasConfig?.agent_withdrawal_fee_pct ?? 0);
  const [savingSaas, setSavingSaas] = useState(false);
  const [processingWdId, setProcessingWdId] = useState<number | null>(null);

  useEffect(() => {
    if (!saasConfig) return;
    setNeutralDomain(saasConfig.neutral_base_domain || '');
    setCnameTarget(saasConfig.saas_cname_target || '');
    setZoneId(saasConfig.cf_saas_zone_id || '');
    setFeePct(saasConfig.agent_signup_platform_fee_pct ?? 0);
    setWdFeePct(saasConfig.agent_withdrawal_fee_pct ?? 0);
  }, [
    saasConfig?.neutral_base_domain,
    saasConfig?.saas_cname_target,
    saasConfig?.cf_saas_zone_id,
    saasConfig?.agent_signup_platform_fee_pct,
    saasConfig?.agent_withdrawal_fee_pct,
    saasConfig,
  ]);

  const handleSaveSaas = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSaas(true);
    try {
      await adminApi.updateSaasConfig({
        neutral_base_domain: neutralDomain,
        saas_cname_target: cnameTarget,
        cf_saas_zone_id: zoneId,
        cf_saas_api_token: apiToken.trim() || undefined,
        agent_signup_platform_fee_pct: feePct,
        agent_withdrawal_fee_pct: wdFeePct,
      });
      setApiToken('');
      await onReload();
      showToast(aa.saasSavedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : aa.saasSaveFailErr);
    } finally {
      setSavingSaas(false);
    }
  };

  const handleReviewWithdrawal = async (w: AgentWithdrawalRecord, action: 'paid' | 'rejected') => {
    const targetName = w.agent_brand || w.owner_email || '';
    const amountStr = Number(w.amount).toFixed(2);
    const feeVal = Number(w.fee_amount || 0);
    const netVal = Number(w.net_amount ?? w.amount - feeVal);
    const ok = await openConfirm({
      title: action === 'paid' ? aa.wdApproveConfirmTitle : aa.wdRejectConfirmTitle,
      description:
        action === 'paid'
          ? feeVal > 0
            ? fmt(aa.wdNetApproveDesc, {
                target: targetName,
                channel: w.channel,
                account: w.account_info,
                amount: amountStr,
                fee: feeVal.toFixed(2),
                net: netVal.toFixed(2),
              })
            : fmt(aa.wdApproveConfirmDesc, {
                target: targetName,
                channel: w.channel,
                account: w.account_info,
                amount: amountStr,
              })
          : fmt(aa.wdRejectConfirmDesc, { amount: amountStr }),
      confirmLabel: action === 'paid' ? aa.wdApproveConfirmBtn : aa.wdRejectConfirmBtn,
      tone: action === 'paid' ? 'accent' : 'danger',
    });
    if (!ok) return;

    setProcessingWdId(w.id);
    try {
      await adminApi.reviewWithdrawal(w.id, {
        action,
        admin_note: action === 'paid' ? aa.wdApproveNote : aa.wdRejectNote,
      });
      await onReload();
      showToast(action === 'paid' ? aa.wdApprovedToast : aa.wdRejectedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : aa.wdProcessFailErr);
    } finally {
      setProcessingWdId(null);
    }
  };

  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending').length;

  const showSaas = section === 'all' || section === 'saas';
  const showWithdrawals = section === 'all' || section === 'withdrawals';

  return (
    <div className="space-y-6">
      {/* Anti-traceability Domain Pool + Cloudflare for SaaS + Platform Signup Cut */}
      {showSaas && (
        <form onSubmit={handleSaveSaas} className="paper-card rounded-2xl p-6 space-y-4">
          <div
            className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h2 className="font-editorial text-xl font-semibold">{aa.saasTitle}</h2>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                {aa.saasSubtitle}
              </p>
            </div>
            <span
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
              style={{
                backgroundColor: saasConfig?.cf_saas_has_token ? 'var(--success-soft)' : 'var(--bg-subtle)',
                color: saasConfig?.cf_saas_has_token ? 'var(--success)' : 'var(--ink-muted)',
              }}
            >
              <Shield className="w-3 h-3" />
              {saasConfig?.cf_saas_has_token ? aa.saasReadyBadge : aa.saasManualBadge}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <div className="block font-semibold mb-1">{aa.saasNeutralLabel}</div>
              <input
                type="text"
                value={neutralDomain}
                onChange={(e) => setNeutralDomain(e.target.value)}
                placeholder={aa.saasNeutralPlaceholder}
                className="acct-input font-mono-num"
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {aa.saasNeutralHint}
              </p>
            </div>

            <div>
              <div className="block font-semibold mb-1">{aa.saasCnameLabel}</div>
              <input
                type="text"
                value={cnameTarget}
                onChange={(e) => setCnameTarget(e.target.value)}
                placeholder={aa.saasCnamePlaceholder}
                className="acct-input font-mono-num"
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {aa.saasCnameHint}
              </p>
            </div>

            <div>
              <div className="block font-semibold mb-1">{aa.saasFeePctLabel}</div>
              <input
                type="number"
                min={0}
                max={80}
                step="1"
                value={feePct}
                onChange={(e) => setFeePct(Number(e.target.value))}
                className="acct-input font-mono-num"
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {aa.saasFeePctHint}
              </p>
            </div>

            <div>
              <div className="block font-semibold mb-1">{aa.saasWdFeePctLabel}</div>
              <input
                type="number"
                min={0}
                max={30}
                step="0.5"
                value={wdFeePct}
                onChange={(e) => setWdFeePct(Number(e.target.value))}
                className="acct-input font-mono-num"
              />
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                {aa.saasWdFeePctHint}
              </p>
            </div>

            <div>
              <div className="block font-semibold mb-1">{aa.saasZoneLabel}</div>
              <input
                type="text"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                placeholder={aa.saasZonePlaceholder}
                className="acct-input font-mono-num"
              />
            </div>

            <div className="md:col-span-2">
              <div className="block font-semibold mb-1">{aa.saasTokenLabel}</div>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder={
                    saasConfig?.cf_saas_has_token
                      ? fmt(aa.saasTokenPlaceholderMasked, { masked: saasConfig.cf_saas_token_masked })
                      : aa.saasTokenPlaceholderEmpty
                  }
                  className="acct-input font-mono-num flex-1"
                />
                {saasConfig?.cf_saas_has_token && (
                  <button
                    type="button"
                    onClick={async () => {
                      await adminApi.updateSaasConfig({ clear_cf_token: true });
                      await onReload();
                      showToast(aa.saasTokenClearedToast);
                    }}
                    className="px-3 py-2 rounded-xl border text-xs cursor-pointer whitespace-nowrap"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  >
                    {aa.saasClearTokenBtn}
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={savingSaas}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {savingSaas ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {aa.saasSaveBtn}
          </button>
        </form>
      )}

      {/* Agent Withdrawal Review Queue */}
      {showWithdrawals && (
        <div className="paper-card rounded-2xl p-6 space-y-4">
          <div
            className="flex items-center justify-between gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="font-editorial text-xl font-semibold">{aa.wdTitle}</h2>
            </div>
            {pendingWithdrawals > 0 && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono-num"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {fmt(aa.wdPendingCount, { count: pendingWithdrawals })}
              </span>
            )}
          </div>

          {withdrawals.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
              {aa.wdEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr
                    className="border-b"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                  >
                    <th className="py-2 pr-4">{aa.wdColStore}</th>
                    <th className="py-2 pr-4">{aa.wdColAmount}</th>
                    <th className="py-2 pr-4">{aa.wdColChannel}</th>
                    <th className="py-2 pr-4">{aa.wdColStatus}</th>
                    <th className="py-2 text-right">{aa.wdColActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawals.map((w) => (
                    <tr
                      key={w.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-2.5 pr-4">
                        <div className="font-semibold">
                          {w.agent_brand || fmt(aa.wdAgentFallback, { id: w.agent_id })}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          @{w.agent_slug} · {w.owner_email}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 font-mono-num">
                        <div className="font-bold text-sm">¥{Number(w.amount).toFixed(2)}</div>
                        {Number(w.fee_amount || 0) > 0 && (
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {fmt(aa.wdFeeSubLine, {
                              rate: Number(w.fee_rate || 0),
                              fee: Number(w.fee_amount || 0).toFixed(2),
                              net: Number(w.net_amount ?? w.amount - Number(w.fee_amount || 0)).toFixed(2),
                            })}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="font-mono-num">{w.account_info}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {w.channel === 'alipay'
                            ? aa.wdChannelAlipay
                            : w.channel === 'wechat'
                              ? aa.wdChannelWechat
                              : aa.wdChannelUsdt}
                          {w.account_name ? ` · ${w.account_name}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                          style={{
                            backgroundColor:
                              w.status === 'paid'
                                ? 'var(--success-soft)'
                                : w.status === 'rejected'
                                  ? 'var(--danger-soft)'
                                  : 'var(--accent-soft)',
                            color:
                              w.status === 'paid'
                                ? 'var(--success)'
                                : w.status === 'rejected'
                                  ? 'var(--danger)'
                                  : 'var(--accent)',
                          }}
                        >
                          {w.status === 'paid'
                            ? aa.wdStatusPaid
                            : w.status === 'rejected'
                              ? aa.wdStatusRejected
                              : aa.wdStatusPending}
                        </span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {w.status === 'pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={processingWdId === w.id}
                              onClick={() => void handleReviewWithdrawal(w, 'paid')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium cursor-pointer"
                              style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {aa.wdApproveBtn}
                            </button>
                            <button
                              type="button"
                              disabled={processingWdId === w.id}
                              onClick={() => void handleReviewWithdrawal(w, 'rejected')}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium cursor-pointer"
                              style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                            >
                              <XCircle className="w-3 h-3" />
                              {aa.wdRejectBtn}
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                            {w.processed_at || aa.wdSettledFallback}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
