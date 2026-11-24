/**
 * 运营概览顶部置顶：1 秒紧急止损熔断开关 + 风控待审订单提醒条
 */

import type { RiskEmergencyMode } from '@shared/index';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { adminRiskApi } from '../api/admin-risk.api';
import { fmt } from '../i18n';
import { useRiskControlI18n } from '../i18n/namespaces/risk-control';
import { toast } from '../lib/toast';
import { openConfirm } from './ConfirmDialog';

interface AdminEmergencyStripProps {
  onGoRiskOrders: () => void;
  onGoRiskSettings: () => void;
}

export function AdminEmergencyStrip({ onGoRiskOrders, onGoRiskSettings }: AdminEmergencyStripProps) {
  const rf = useRiskControlI18n();
  const qc = useQueryClient();
  const riskQuery = useQuery({
    queryKey: ['admin', 'risk-overview'],
    queryFn: () => adminRiskApi.getRiskOverview(),
    staleTime: 20_000,
  });

  const switchMutation = useMutation({
    mutationFn: (mode: RiskEmergencyMode) => adminRiskApi.switchEmergencyMode(mode, 'overview_quick_switch'),
    onSuccess: (_res, mode) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'risk-overview'] });
      toast.success(fmt(rf.riskModeSwitchedToast, { mode: modeLabel(mode, rf) }));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed'),
  });

  const mode = riskQuery.data?.config.emergency_mode ?? 'normal';
  const reviewCount = riskQuery.data?.live_metrics.risk_review_orders ?? 0;
  const isNormal = mode === 'normal';

  const handleSwitch = async (next: RiskEmergencyMode) => {
    if (next === mode) return;
    const label = modeLabel(next, rf);
    const ok = await openConfirm({
      title: rf.riskSwitchConfirmTitle,
      description: fmt(rf.riskSwitchConfirmDesc, { mode: label }),
      confirmLabel: label,
      tone: next === 'normal' ? 'accent' : 'danger',
    });
    if (ok) switchMutation.mutate(next);
  };

  return (
    <div className="space-y-2.5">
      <div
        className="paper-card rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-3 text-xs"
        style={{
          borderColor: isNormal ? 'var(--border-color)' : 'var(--danger)',
          backgroundColor: isNormal ? 'var(--bg-surface)' : 'var(--danger-soft)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-8 h-8 rounded-xl inline-flex items-center justify-center shrink-0"
            style={{
              backgroundColor: isNormal ? 'var(--success-soft)' : 'var(--danger)',
              color: isNormal ? 'var(--success)' : '#FAF9F5',
            }}
          >
            {isNormal ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
          </span>
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-2 flex-wrap">
              <span>{rf.riskEmergencyBannerTitle}</span>
              <span
                className="text-[10.5px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: isNormal ? 'var(--success-soft)' : 'var(--danger)',
                  color: isNormal ? 'var(--success)' : '#FAF9F5',
                }}
              >
                {modeLabel(mode, rf)}
              </span>
            </div>
            <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {rf.riskMetricCards5m}: {riskQuery.data?.live_metrics.cards_5m ?? 0} · {rf.riskMetricCards1h}:{' '}
              {riskQuery.data?.live_metrics.cards_1h ?? 0} · {rf.riskMetricUpSpend}: ¥
              {(riskQuery.data?.live_metrics.upstream_spend_today ?? 0).toFixed(2)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {!isNormal && (
            <button
              type="button"
              disabled={switchMutation.isPending}
              onClick={() => void handleSwitch('normal')}
              className="px-3 py-1.5 rounded-xl font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--success)', color: '#FAF9F5' }}
            >
              {rf.riskSwitchBtnNormal}
            </button>
          )}
          {mode !== 'hold_delivery' && (
            <button
              type="button"
              disabled={switchMutation.isPending}
              onClick={() => void handleSwitch('hold_delivery')}
              className="px-3 py-1.5 rounded-xl border font-semibold cursor-pointer"
              style={{
                borderColor: 'var(--warning)',
                color: 'var(--warning)',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              {rf.riskSwitchBtnHold}
            </button>
          )}
          {mode !== 'maintenance' && (
            <button
              type="button"
              disabled={switchMutation.isPending}
              onClick={() => void handleSwitch('maintenance')}
              className="px-3 py-1.5 rounded-xl font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
            >
              {rf.riskSwitchBtnMaint}
            </button>
          )}
          <button
            type="button"
            onClick={onGoRiskSettings}
            className="px-2.5 py-1.5 rounded-xl border font-medium cursor-pointer"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            {rf.riskSubTabLabel}
          </button>
        </div>
      </div>

      {reviewCount > 0 && (
        <div
          className="p-3.5 rounded-2xl border flex flex-wrap items-center justify-between gap-2 text-xs"
          style={{
            borderColor: 'var(--danger)',
            backgroundColor: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{fmt(rf.riskReviewPendingBanner, { count: reviewCount })}</span>
          </div>
          <button
            type="button"
            onClick={onGoRiskOrders}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
          >
            {rf.riskReviewGoBtn}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function modeLabel(mode: RiskEmergencyMode, rf: ReturnType<typeof useRiskControlI18n>): string {
  if (mode === 'hold_delivery') return rf.riskModeHoldDelivery;
  if (mode === 'maintenance') return rf.riskModeMaintenance;
  return rf.riskModeNormal;
}
