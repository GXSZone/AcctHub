/**
 * 分站工作台 Tab 1：总览 KPI、补差晋级、收益提现、实时分账账本与近期零售订单
 */

import { discountDisplay } from '@shared/domain/money';
import { ArrowUpRight } from 'lucide-react';
import { type AgentMeResponse, agentApi } from '../../api/agent.api';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { orderMailStatusText, useMailI18n } from '../../i18n/namespaces/mail';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import type { AgentInfo, AgentTierInfo } from '../../types';
import { AgentWithdrawalSection } from './AgentWithdrawalSection';

interface AgentOverviewTabProps {
  agent: AgentInfo;
  balance: number;
  totalRecharged: number;
  nextTier: AgentTierInfo | null;
  directSubCount: number;
  totalDownlineCount: number;
  withdrawals: AgentMeResponse['withdrawals'];
  ledger: AgentMeResponse['commission_ledger'];
  recentOrders: AgentMeResponse['recent_orders'];
  withdrawalFeePct?: number;
  recharging: boolean;
  onJoinOrUpgrade: (tier: AgentTierInfo) => void;
  onRefresh: () => Promise<void>;
  onRefreshUser: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentOverviewTab({
  agent,
  balance,
  totalRecharged,
  nextTier,
  directSubCount,
  totalDownlineCount,
  withdrawals,
  ledger,
  recentOrders,
  withdrawalFeePct = 0,
  recharging,
  onJoinOrUpgrade,
  onRefresh,
  onRefreshUser,
  onToast,
  onError,
}: AgentOverviewTabProps) {
  const ag = useAgentI18n();
  const mt = useMailI18n();
  const ss = useSaasI18n();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="paper-card rounded-2xl p-5">
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovWalletBalanceLabel}
          </div>
          <div className="font-mono-num text-2xl font-bold mt-1" style={{ color: 'var(--success)' }}>
            ¥{balance.toFixed(2)}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovWalletBalanceHint}
          </div>
        </div>
        <div className="paper-card rounded-2xl p-5">
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovCommissionTotalLabel}
          </div>
          <div className="font-mono-num text-2xl font-bold mt-1" style={{ color: 'var(--accent)' }}>
            ¥{Number(agent.total_commission || 0).toFixed(2)}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovCommissionTotalHint}
          </div>
        </div>
        <div className="paper-card rounded-2xl p-5">
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovTotalSalesLabel}
          </div>
          <div className="font-mono-num text-2xl font-bold mt-1">
            ¥{Number(agent.total_revenue || 0).toFixed(2)}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
            {fmt(ag.ovRecentOrdersHint, { count: recentOrders.length })}
          </div>
        </div>
        <div className="paper-card rounded-2xl p-5">
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovDownlinesLabel}
          </div>
          <div className="font-mono-num text-2xl font-bold mt-1">
            {directSubCount}{' '}
            <span className="text-xs font-normal" style={{ color: 'var(--ink-muted)' }}>
              {fmt(ag.ovDownlinesUnit, { total: totalDownlineCount })}
            </span>
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovDownlinesHint}
          </div>
        </div>
      </div>

      {nextTier && (
        <div
          className="paper-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          style={{ borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--border-color))' }}
        >
          <div className="space-y-1">
            <div
              className="text-xs font-semibold inline-flex items-center gap-1.5"
              style={{ color: 'var(--accent)' }}
            >
              <ArrowUpRight className="w-4 h-4" />
              {fmt(ag.ovNextTierBannerTitle, {
                name: nextTier.name,
                ...discountDisplay(nextTier.discount_rate),
              })}
            </div>
            <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
              {fmt(ag.ovNextTierPaidPart, { paid: totalRecharged.toFixed(2) })}
              {Math.max(0, Number((nextTier.min_recharge - totalRecharged).toFixed(2))).toFixed(2)}{' '}
              {ag.ovNextTierDiffTail}
            </p>
          </div>
          <button
            type="button"
            disabled={recharging}
            onClick={() => onJoinOrUpgrade(nextTier)}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {fmt(ag.ovUpgradeToTierBtn, { name: nextTier.name })}
          </button>
        </div>
      )}

      <AgentWithdrawalSection
        balance={balance}
        withdrawalFeePct={withdrawalFeePct}
        withdrawals={withdrawals}
        onRefresh={onRefresh}
        onRefreshUser={onRefreshUser}
        onToast={onToast}
        onError={onError}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="paper-card rounded-2xl p-6 space-y-3">
          <h2 className="font-editorial text-xl font-semibold">{ag.ovLedgerTitle}</h2>
          {ledger.length === 0 ? (
            <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              {ag.ovLedgerEmpty}
            </p>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {ledger.map((l) => (
                <div
                  key={l.id}
                  className="p-3 rounded-xl border flex items-start justify-between gap-3 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium">{l.note}</div>
                    <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      {l.order_no} · {l.created_at}
                    </div>
                  </div>
                  <span
                    className="font-mono-num font-bold shrink-0"
                    style={{ color: l.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {l.amount >= 0
                      ? `+¥${Number(l.amount).toFixed(2)}`
                      : `-¥${Math.abs(Number(l.amount)).toFixed(2)}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="paper-card rounded-2xl p-6 space-y-3">
          <h2 className="font-editorial text-xl font-semibold">{ag.ovRecentOrdersTitle}</h2>
          {recentOrders.length === 0 ? (
            <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              {ag.ovRecentOrdersEmpty}
            </p>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
              {recentOrders.map((o) => (
                <div
                  key={o.order_no}
                  className="p-3 rounded-xl border flex items-center justify-between gap-3 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{o.product_title}</div>
                    <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.order_no} · {o.contact_email} × {o.quantity}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {o.status === 'awaiting_agent_funding' && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await tenantAgentApi.retryOrderFunding(o.order_no);
                            onToast(ss.payRetryFundingToast);
                            await onRefresh();
                            onRefreshUser();
                          } catch (err) {
                            onError(err instanceof Error ? err.message : ag.ovResendMailErr);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                        style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}
                      >
                        {ss.payRetryFundingBtn}
                      </button>
                    )}
                    {o.status === 'delivered' && o.public_order_no && (
                      <div className="space-y-1 text-right">
                        <div className="text-[11px]">{orderMailStatusText(mt, o.mail_status)}</div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await agentApi.resendOrderEmail(o.order_no);
                              onToast(orderMailStatusText(mt, res.mail_status));
                              await onRefresh();
                            } catch (err) {
                              onError(err instanceof Error ? err.message : ag.ovResendMailErr);
                            }
                          }}
                          className="px-2 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                          style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }}
                        >
                          {ag.ovResendMailBtn}
                        </button>
                      </div>
                    )}
                    <div className="text-right font-mono-num">
                      <div className="font-semibold">¥{Number(o.total_amount).toFixed(2)}</div>
                      <div className="text-[10.5px]" style={{ color: 'var(--success)' }}>
                        {fmt(ag.ovOrderProfit, { amount: Number(o.commission_amount || 0).toFixed(2) })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
