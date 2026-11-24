/**
 * 会员中心主页 Tab：资产余额、本月消费、代理引导与近期活动
 */

import { discountDisplay } from '@shared/domain/money';
import { ArrowUpRight, Loader2, Store, Wallet } from 'lucide-react';
import { WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useAccountSummaryQuery } from '../../queries/account.queries';
import type { UserProfile } from '../../types';
import type { AccountSection } from './AccountCenterPage';

interface AccountHomeTabProps {
  user: UserProfile;
  isSuperAdmin: boolean;
  onGoSection: (sec: AccountSection) => void;
  onStartOrderTicket: (orderNo: string, productTitle: string) => void;
}

export function AccountHomeTab({ user, isSuperAdmin, onGoSection, onStartOrderTicket }: AccountHomeTabProps) {
  const acc = useAccountI18n();
  const summaryQuery = useAccountSummaryQuery(true);
  const summary = summaryQuery.data ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.homeTitle}</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {fmt(acc.homeSubtitle, { email: user.email })}
        </p>
      </div>

      {summaryQuery.isLoading && !summary ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="paper-card rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {acc.homeBalanceLabel}
                </div>
                <div
                  className="font-mono-num text-3xl font-bold mt-1.5"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  ¥{(summary?.balance ?? user.balance).toFixed(2)}
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                  {acc.homeBalanceDesc}
                  {Number(user.promo_balance || 0) >= 0.01 && (
                    <span className="ml-1.5 font-mono-num" style={{ color: 'var(--accent)' }}>
                      {fmt(acc.homePromoBalanceTag, { amount: Number(user.promo_balance).toFixed(2) })}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onGoSection('recharge')}
                className="w-full py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                <Wallet className="w-3.5 h-3.5" />
                {acc.homeRechargeBtn}
              </button>
            </div>

            <div className="paper-card rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {acc.homeMonthlySpendLabel}
                </div>
                <div className="font-mono-num text-3xl font-bold mt-1.5">
                  ¥{(summary?.monthly_spend ?? 0).toFixed(2)}
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--ink-muted)' }}>
                  {fmt(acc.homeSummaryStats, {
                    orders: summary?.total_orders ?? 0,
                    tickets: summary?.open_tickets ?? 0,
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onGoSection('orders')}
                  className="flex-1 py-2 rounded-xl border text-xs font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  {acc.homeOrdersBtn}
                </button>
                <button
                  type="button"
                  onClick={() => onGoSection('billing')}
                  className="flex-1 py-2 rounded-xl border text-xs font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  {acc.homeBillingBtn}
                </button>
              </div>
            </div>

            <div className="paper-card rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {user.agent ? acc.homeAgentCardLabelActive : acc.homeAgentCardLabelIdle}
                </div>
                <div className="font-editorial text-lg font-semibold mt-1.5">
                  {user.agent ? user.agent.brand_name : acc.homeAgentDefaultHeadline}
                </div>
                <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                  {user.agent
                    ? fmt(acc.homeAgentActiveDesc, {
                        ...discountDisplay(user.agent_tier?.discount_rate ?? 0.9),
                        offPct: Math.round((1 - (user.agent_tier?.discount_rate ?? 0.9)) * 100),
                        commission: Number(user.agent.total_commission || 0).toFixed(2),
                      })
                    : acc.homeAgentIdleDesc}
                </div>
              </div>
              {!isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => onGoSection('store')}
                  className="w-full py-2 rounded-xl border text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1"
                  style={{
                    borderColor: 'var(--accent)',
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent)',
                  }}
                >
                  <Store className="w-3.5 h-3.5" />
                  {user.agent ? acc.homeAgentEnterBtn : acc.homeAgentViewTiersBtn}
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="paper-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-editorial text-lg font-semibold">{acc.homeRecentOrdersTitle}</h2>
                <button
                  type="button"
                  onClick={() => onGoSection('orders')}
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  {acc.homeViewAllBtn}
                </button>
              </div>
              {(summary?.recent_orders || []).length === 0 ? (
                <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
                  {acc.homeNoOrders}
                </p>
              ) : (
                <div className="space-y-2">
                  {(summary?.recent_orders || []).map((o) => (
                    <div
                      key={o.order_no}
                      className="p-3 rounded-xl border flex items-center justify-between gap-2 text-xs"
                      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium truncate">{o.product_title}</span>
                          <WarrantyStatusBadge warranty={o.warranty} compact />
                        </div>
                        <div
                          className="text-[11px] font-mono-num mt-0.5"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {o.order_no} · {o.spec_name} × {o.quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono-num font-semibold">
                          ¥{Number(o.total_amount).toFixed(2)}
                        </span>
                        {o.status !== 'refunded' && (
                          <button
                            type="button"
                            onClick={() => onStartOrderTicket(o.order_no, o.product_title)}
                            className="px-2 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                            style={{ borderColor: 'var(--border-strong)', color: 'var(--accent)' }}
                          >
                            {acc.homeAfterSaleShortBtn}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="paper-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-editorial text-lg font-semibold">{acc.homeRecentBillingTitle}</h2>
                <button
                  type="button"
                  onClick={() => onGoSection('billing')}
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  {acc.homeViewDetailBtn}
                </button>
              </div>
              {(summary?.recent_transactions || []).length === 0 ? (
                <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
                  {acc.homeNoBilling}
                </p>
              ) : (
                <div className="space-y-2">
                  {(summary?.recent_transactions || []).map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-xl border flex items-center justify-between gap-2 text-xs"
                      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{tx.note}</div>
                        <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                          {fmt(acc.homeTxBalanceAfter, {
                            time: tx.created_at,
                            amount: Number(tx.balance_after).toFixed(2),
                          })}
                        </div>
                      </div>
                      <span
                        className="font-mono-num font-semibold shrink-0"
                        style={{ color: tx.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}
                      >
                        {tx.amount >= 0
                          ? `+¥${Number(tx.amount).toFixed(2)}`
                          : `-¥${Math.abs(Number(tx.amount)).toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
