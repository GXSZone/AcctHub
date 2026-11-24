/**
 * 站点运营配置 → 安全风控 Tab：5 维反盗刷阈值、一键应急开关、IP/CIDR 黑名单、告警演练与风控台账
 */

import type { RiskControlConfig, RiskEmergencyMode } from '@shared/index';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, BellRing, Loader2, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminRiskApi } from '../../api/admin-risk.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';

export function AdminRiskControlTab({ showToast }: { showToast: (msg: string) => void }) {
  const rf = useRiskControlI18n();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['admin', 'risk-overview'],
    queryFn: () => adminRiskApi.getRiskOverview(),
  });

  const [draft, setDraft] = useState<RiskControlConfig | null>(null);
  const [ipInput, setIpInput] = useState('');
  const [ipReason, setIpReason] = useState('');

  useEffect(() => {
    if (query.data?.config) setDraft(query.data.config);
  }, [query.data?.config]);

  const saveMutation = useMutation({
    mutationFn: (cfg: RiskControlConfig) => adminRiskApi.updateRiskConfig(cfg),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      showToast(rf.riskSavedToast);
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Failed'),
  });

  const modeMutation = useMutation({
    mutationFn: (mode: RiskEmergencyMode) => adminRiskApi.switchEmergencyMode(mode, 'risk_panel_switch'),
    onSuccess: (_res, mode) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      const label =
        mode === 'hold_delivery'
          ? rf.riskModeHoldDelivery
          : mode === 'maintenance'
            ? rf.riskModeMaintenance
            : rf.riskModeNormal;
      showToast(fmt(rf.riskModeSwitchedToast, { mode: label }));
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Failed'),
  });

  const testAlertMutation = useMutation({
    mutationFn: () => adminRiskApi.sendTestAlert(),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      showToast(fmt(rf.riskTestAlertToast, { count: res.mail_sent_count }));
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Failed'),
  });

  const addIpMutation = useMutation({
    mutationFn: () => adminRiskApi.addIpBlacklist(ipInput.trim(), ipReason.trim()),
    onSuccess: () => {
      setIpInput('');
      setIpReason('');
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      showToast(rf.riskIpAddedToast);
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Failed'),
  });

  const delIpMutation = useMutation({
    mutationFn: (id: number) => adminRiskApi.deleteIpBlacklist(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      showToast(rf.riskIpRemovedToast);
    },
  });

  if (query.isLoading || !draft) {
    return (
      <div className="paper-card rounded-2xl p-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  const metrics = query.data?.live_metrics;
  const ips = query.data?.ip_blacklist ?? [];
  const events = query.data?.events ?? [];

  const switchMode = async (next: RiskEmergencyMode) => {
    const label =
      next === 'hold_delivery'
        ? rf.riskModeHoldDelivery
        : next === 'maintenance'
          ? rf.riskModeMaintenance
          : rf.riskModeNormal;
    const ok = await openConfirm({
      title: rf.riskSwitchConfirmTitle,
      description: fmt(rf.riskSwitchConfirmDesc, { mode: label }),
      confirmLabel: label,
      tone: next === 'normal' ? 'accent' : 'danger',
    });
    if (ok) modeMutation.mutate(next);
  };

  return (
    <div className="space-y-5 text-xs">
      {/* 顶部标题、实时指标与一键止损开关 */}
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" style={{ color: 'var(--danger)' }} />
              <h2 className="font-editorial text-xl font-semibold">{rf.riskTitle}</h2>
            </div>
            <p className="mt-1 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              {rf.riskDesc}
            </p>
          </div>
          <button
            type="button"
            disabled={testAlertMutation.isPending}
            onClick={() => testAlertMutation.mutate()}
            className="px-3.5 py-2 rounded-xl border font-semibold cursor-pointer inline-flex items-center gap-1.5"
            style={{
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
              backgroundColor: 'var(--danger-soft)',
            }}
          >
            {testAlertMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BellRing className="w-3.5 h-3.5" />
            )}
            {rf.riskTestAlertBtn}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: rf.riskMetricCards5m, val: String(metrics?.cards_5m ?? 0) },
            { label: rf.riskMetricCards1h, val: String(metrics?.cards_1h ?? 0) },
            { label: rf.riskMetricUpSpend, val: `¥${(metrics?.upstream_spend_today ?? 0).toFixed(2)}` },
            {
              label: rf.riskMetricReviewOrders,
              val: String(metrics?.risk_review_orders ?? 0),
              danger: (metrics?.risk_review_orders ?? 0) > 0,
            },
          ].map((m) => (
            <div
              key={m.label}
              className="p-3.5 rounded-xl border"
              style={{
                borderColor: m.danger ? 'var(--danger)' : 'var(--border-color)',
                backgroundColor: 'var(--bg-canvas)',
              }}
            >
              <div style={{ color: 'var(--ink-muted)' }}>{m.label}</div>
              <div
                className="font-mono-num text-xl font-bold mt-1"
                style={{ color: m.danger ? 'var(--danger)' : 'var(--ink-primary)' }}
              >
                {m.val}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(
            [
              ['normal', rf.riskModeNormal],
              ['hold_delivery', rf.riskModeHoldDelivery],
              ['maintenance', rf.riskModeMaintenance],
            ] as const
          ).map(([mode, label]) => {
            const active = draft.emergency_mode === mode;
            return (
              <button
                key={mode}
                type="button"
                disabled={modeMutation.isPending}
                onClick={() => void switchMode(mode)}
                className="px-3.5 py-2 rounded-xl border font-semibold cursor-pointer"
                style={{
                  borderColor: active
                    ? mode === 'normal'
                      ? 'var(--success)'
                      : 'var(--danger)'
                    : 'var(--border-color)',
                  backgroundColor: active
                    ? mode === 'normal'
                      ? 'var(--success-soft)'
                      : 'var(--danger)'
                    : 'var(--bg-canvas)',
                  color: active ? (mode === 'normal' ? 'var(--success)' : '#FAF9F5') : 'var(--ink-secondary)',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 自动化风控阈值配置 */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate(draft);
        }}
        className="paper-card rounded-2xl p-6 space-y-4"
      >
        <h3 className="font-editorial text-lg font-semibold">{rf.riskCfgTitle}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(
            [
              ['max_cards_5m', rf.riskMaxCards5m],
              ['max_cards_1h', rf.riskMaxCards1h],
              ['max_upstream_daily_spend', rf.riskMaxUpSpend],
              ['review_order_amount_threshold', rf.riskReviewAmt],
              ['review_order_qty_threshold', rf.riskReviewQty],
              ['max_pending_orders_per_ip_10m', rf.riskMaxPendingIp],
              ['max_pending_orders_per_email_10m', rf.riskMaxPendingEmail],
            ] as const
          ).map(([field, label]) => (
            <div key={field}>
              <div className="font-semibold mb-1">{label}</div>
              <input
                type="number"
                min={0}
                value={draft[field]}
                onChange={(e) => setDraft({ ...draft, [field]: Number(e.target.value) })}
                className="acct-input font-mono-num"
              />
            </div>
          ))}
        </div>

        <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={draft.min_cost_guard_enabled}
            onChange={(e) => setDraft({ ...draft, min_cost_guard_enabled: e.target.checked })}
          />
          {rf.riskMinCostGuard}
        </label>

        <div>
          <div className="font-semibold mb-1">{rf.riskAlertEmails}</div>
          <input
            type="text"
            value={draft.alert_emails}
            onChange={(e) => setDraft({ ...draft, alert_emails: e.target.value })}
            placeholder="admin@yourdomain.com, sec@yourdomain.com"
            className="acct-input font-mono-num"
          />
        </div>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {saveMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {rf.riskSaveCfgBtn}
        </button>
      </form>

      {/* 全站 IP / CIDR 黑名单 */}
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Ban className="w-4 h-4" style={{ color: 'var(--danger)' }} />
          <h3 className="font-editorial text-lg font-semibold">{rf.riskIpTitle}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={ipInput}
            onChange={(e) => setIpInput(e.target.value)}
            placeholder={rf.riskIpPlaceholder}
            className="acct-input font-mono-num flex-1 min-w-[200px]"
          />
          <input
            type="text"
            value={ipReason}
            onChange={(e) => setIpReason(e.target.value)}
            placeholder={rf.riskIpReasonPlaceholder}
            className="acct-input flex-1 min-w-[160px]"
          />
          <button
            type="button"
            disabled={!ipInput.trim() || addIpMutation.isPending}
            onClick={() => addIpMutation.mutate()}
            className="px-4 py-2 rounded-xl font-semibold cursor-pointer inline-flex items-center gap-1 disabled:opacity-50"
            style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {rf.riskIpAddBtn}
          </button>
        </div>
        {ips.length === 0 ? (
          <p className="py-4 text-center" style={{ color: 'var(--ink-muted)' }}>
            {rf.riskIpEmpty}
          </p>
        ) : (
          <div className="space-y-1.5">
            {ips.map((item) => (
              <div
                key={item.id}
                className="px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div>
                  <span className="font-mono-num font-semibold">{item.ip_pattern}</span>
                  {item.reason && (
                    <span className="ml-2" style={{ color: 'var(--ink-muted)' }}>
                      {item.reason}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {item.created_at}
                  </span>
                  <button
                    type="button"
                    onClick={() => delIpMutation.mutate(item.id)}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--danger)' }}
                    aria-label={item.ip_pattern}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 近期风控熔断与 3 封告警台账 */}
      <div className="paper-card rounded-2xl p-6 space-y-3">
        <h3 className="font-editorial text-lg font-semibold">{rf.riskEventsTitle}</h3>
        {events.length === 0 ? (
          <p className="py-4 text-center" style={{ color: 'var(--ink-muted)' }}>
            {rf.riskEventsEmpty}
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {events.map((ev) => (
              <div
                key={ev.id}
                className="p-3 rounded-xl border flex flex-wrap items-start justify-between gap-2"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="font-semibold flex items-center gap-2 flex-wrap">
                    <span
                      className="px-1.5 py-0.5 rounded font-mono-num text-[10px]"
                      style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                    >
                      {ev.event_type}
                    </span>
                    <span>{ev.summary}</span>
                  </div>
                  <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {ev.order_no ? `${ev.order_no} · ` : ''}
                    {ev.buyer_ip ? `IP ${ev.buyer_ip} · ` : ''}
                    {ev.contact_email ? `${ev.contact_email} · ` : ''}
                    {ev.created_at}
                  </div>
                </div>
                <span
                  className="text-[10.5px] px-2 py-0.5 rounded-full font-mono-num shrink-0"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  {fmt(rf.riskMailCountTag, { count: ev.mail_alert_count })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
