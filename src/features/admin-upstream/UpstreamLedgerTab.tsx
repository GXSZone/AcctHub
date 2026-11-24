/**
 * 上游直采毛利 KPI、异常待履约队列与全量幂等对账台账视图
 */

import {
  type UpstreamExceptionOrderRecord,
  type UpstreamOrderLedgerRecord,
  type UpstreamSourceRecord,
  upstreamApi,
} from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import { UpstreamExceptionQueue } from './UpstreamExceptionQueue';

interface UpstreamLedgerTabProps {
  profitSummary: {
    delivered_count: number;
    gross_revenue: number;
    total_commission: number;
    total_upstream_cost: number;
    net_profit: number;
  };
  exceptionOrders: UpstreamExceptionOrderRecord[];
  upOrders: UpstreamOrderLedgerRecord[];
  sources: UpstreamSourceRecord[];
  ledgerLoading: boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function UpstreamLedgerTab({
  profitSummary,
  exceptionOrders,
  upOrders,
  sources,
  ledgerLoading,
  onRefresh,
  showToast,
}: UpstreamLedgerTabProps) {
  const au = useAdminUpstreamI18n();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: au.kpiDelivered, value: String(profitSummary.delivered_count) },
          { label: au.kpiGross, value: `¥${profitSummary.gross_revenue.toFixed(2)}` },
          { label: au.kpiUpCost, value: `¥${profitSummary.total_upstream_cost.toFixed(2)}` },
          {
            label: au.kpiNetProfit,
            value: `¥${profitSummary.net_profit.toFixed(2)}`,
            highlight: profitSummary.net_profit >= 0 ? 'var(--success)' : 'var(--danger)',
          },
        ].map((k) => (
          <div key={k.label} className="paper-card rounded-2xl p-4">
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {k.label}
            </div>
            <div
              className="font-mono-num text-xl font-semibold mt-1"
              style={{ color: k.highlight || 'var(--ink-primary)' }}
            >
              {k.value}
            </div>
          </div>
        ))}
      </div>

      <UpstreamExceptionQueue
        exceptionOrders={exceptionOrders}
        upOrders={upOrders}
        sources={sources}
        ledgerLoading={ledgerLoading}
        onRefresh={onRefresh}
        showToast={showToast}
      />

      <div className="paper-card rounded-2xl p-5 space-y-3 overflow-x-auto">
        <h3 className="font-editorial text-lg font-semibold">{au.ledgerTitle}</h3>
        {upOrders.length === 0 ? (
          <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
            {au.ledgerEmpty}
          </p>
        ) : (
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-3">{au.colTimePurpose}</th>
                <th className="py-2 pr-3">{au.colLocalOrderKey}</th>
                <th className="py-2 pr-3">{au.colSourceUpNo}</th>
                <th className="py-2 pr-3">{au.colCostQty}</th>
                <th className="py-2 pr-3">{au.colLedgerStatus}</th>
                <th className="py-2 text-right">{au.colLedgerOps}</th>
              </tr>
            </thead>
            <tbody>
              {upOrders.map((u) => (
                <tr
                  key={u.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    <div className="font-mono-num text-[11px]">{u.created_at}</div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--bg-subtle)' }}
                    >
                      {u.purpose === 'restock_pull'
                        ? au.purposeRestock
                        : u.purpose === 'after_sale_replace'
                          ? au.purposeReplace
                          : u.purpose === 'manual_retry'
                            ? au.purposeRetry
                            : au.purposeDirect}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-mono-num">
                    <div className="font-semibold">{u.local_order_no || '—'}</div>
                    <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {u.idempotency_out_trade_no}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{u.source_name}</div>
                    <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {u.upstream_order_no || '—'}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono-num">
                    ¥{Number(u.upstream_cost).toFixed(2)} × {u.quantity}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                      style={{
                        backgroundColor:
                          u.status === 'succeeded'
                            ? 'var(--success-soft)'
                            : u.status === 'failed'
                              ? 'var(--danger-soft)'
                              : 'var(--warning-soft)',
                        color:
                          u.status === 'succeeded'
                            ? 'var(--success)'
                            : u.status === 'failed'
                              ? 'var(--danger)'
                              : 'var(--warning)',
                      }}
                    >
                      {u.status}
                    </span>
                    {u.error_message && (
                      <div
                        className="text-[10.5px] mt-0.5 max-w-[200px] truncate"
                        style={{ color: 'var(--danger)' }}
                        title={u.error_message}
                      >
                        {u.error_message}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {(u.status === 'pending' || u.status === 'timeout_unknown') && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const res = await upstreamApi.pollOrder(u.id);
                            showToast(fmt(au.ledgerPollToast, { status: res.status }));
                            await onRefresh();
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : au.ledgerPollFailed);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                      >
                        {au.ledgerPollBtn}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
