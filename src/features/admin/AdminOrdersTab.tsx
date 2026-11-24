/**
 * 总控后台订单流水、补发邮件和退款处理。
 */

import { useQuery } from '@tanstack/react-query';
import { Eye, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { adminRefundApi, type RefundView } from '../../api/admin-refund.api';
import { adminRiskApi } from '../../api/admin-risk.api';
import { upstreamApi } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { orderMailStatusText, useMailI18n } from '../../i18n/namespaces/mail';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { AdminCashflowTables } from './AdminCashflowTables';
import { AdminOrderDetailDrawer } from './AdminOrderDetailDrawer';
import { AdminRefundPanel, AdminRefundPolicyButton } from './AdminRefundPanel';
import type { AdminOrderRow } from './admin.types';

interface AdminOrdersTabProps {
  initialStatusFilter?: string;
  orders: AdminOrderRow[];
  isSuperAdmin: boolean;
  onJumpToUpstreams: () => void;
  onEditProductById?: (productId: number) => void;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function AdminOrdersTab({
  initialStatusFilter = 'all',
  orders,
  isSuperAdmin,
  onJumpToUpstreams,
  onEditProductById,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminOrdersTabProps) {
  const ac = useAdminCoreI18n();
  const mt = useMailI18n();
  const rf = useRiskControlI18n();
  const [subTab, setSubTab] = useState<'products' | 'upgrades' | 'recharges'>('products');
  const [searchInput, setSearchInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [payFilter, setPayFilter] = useState('all');
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [manualOrderNo, setManualOrderNo] = useState<string | null>(null);
  const [manualCards, setManualCards] = useState('');
  const [submittingDelivery, setSubmittingDelivery] = useState(false);
  const [refundDetails, setRefundDetails] = useState<{ orderNo: string; view: RefundView } | null>(null);
  const [loadingRefund, setLoadingRefund] = useState(false);

  useEffect(() => {
    setStatusFilter(initialStatusFilter || 'all');
  }, [initialStatusFilter]);

  const isFiltering = Boolean(appliedQ || statusFilter !== 'all' || payFilter !== 'all');
  const searchQuery = useQuery({
    queryKey: ['admin', 'orders-search', appliedQ, statusFilter, payFilter],
    queryFn: () =>
      adminRiskApi.searchOrders({
        q: appliedQ || undefined,
        status: statusFilter,
        payment_method: payFilter,
        page: 1,
        page_size: 50,
      }),
    enabled: subTab === 'products' && isFiltering,
  });

  const displayedOrders: AdminOrderRow[] = isFiltering
    ? ((searchQuery.data?.items ?? []) as unknown as AdminOrderRow[])
    : orders;
  return (
    <div className="paper-card rounded-2xl p-6 overflow-x-auto space-y-4">
      <AdminRefundPolicyButton title={ac.ordTitle} subtitle={ac.ordSubtitle} />
      <div className="flex items-center gap-1.5 flex-wrap">
        {(
          [
            ['products', ac.ordTabProducts],
            ['upgrades', ac.ordTabUpgrades],
            ['recharges', ac.ordTabRecharges],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setSubTab(k)}
            className="px-3.5 py-1.5 rounded-full text-xs font-medium border cursor-pointer"
            style={{
              backgroundColor: subTab === k ? 'var(--accent-soft)' : 'var(--bg-surface)',
              borderColor: subTab === k ? 'transparent' : 'var(--border-color)',
              color: subTab === k ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {subTab !== 'products' ? (
        <AdminCashflowTables mode={subTab} />
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setAppliedQ(searchInput.trim());
            }}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={rf.ordSearchPlaceholder}
              className="acct-input h-9 flex-1 min-w-[200px] text-xs"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="acct-input h-9 w-auto text-xs"
            >
              <option value="all">{rf.ordFilterAllStatus}</option>
              <option value="risk_review">{rf.ordFilterRiskReview}</option>
              <option value="delivered">{rf.ordFilterDelivered}</option>
              <option value="pending_payment">{rf.ordFilterPendingPay}</option>
              <option value="paid">{rf.ordFilterPaid}</option>
              <option value="fulfillment_failed">{rf.ordFilterFailed}</option>
              <option value="refunded">{rf.ordFilterRefunded}</option>
            </select>
            <select
              value={payFilter}
              onChange={(e) => setPayFilter(e.target.value)}
              className="acct-input h-9 w-auto text-xs"
            >
              <option value="all">{rf.ordFilterAllPay}</option>
              <option value="balance">balance</option>
              <option value="epay">epay</option>
              <option value="alipay_f2f">alipay_f2f</option>
              <option value="stripe">stripe</option>
              <option value="usdt_trc20">usdt_trc20</option>
            </select>
            <button
              type="submit"
              className="h-9 px-3.5 rounded-xl font-semibold cursor-pointer inline-flex items-center gap-1"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Search className="w-3.5 h-3.5" />
              {rf.ordSearchBtn}
            </button>
            {isFiltering && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setAppliedQ('');
                  setStatusFilter('all');
                  setPayFilter('all');
                }}
                className="h-9 px-3 rounded-xl border cursor-pointer"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {rf.ordResetBtn}
              </button>
            )}
          </form>
          {manualOrderNo && (
            <form
              className="my-4 grid gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                setSubmittingDelivery(true);
                try {
                  const result = await upstreamApi.manualFulfillOrder(manualOrderNo, {
                    cards_text: manualCards,
                  });
                  setManualOrderNo(null);
                  setManualCards('');
                  showToast(`${mt.manualDeliveryCompleted} · ${orderMailStatusText(mt, result.mail_status)}`);
                  await onReload();
                } catch (error) {
                  showToast(error instanceof Error ? error.message : ac.ordStatusException);
                } finally {
                  setSubmittingDelivery(false);
                }
              }}
            >
              <label htmlFor="manual-order-credentials">
                {mt.manualDeliveryLabel} · {manualOrderNo}
              </label>
              <textarea
                id="manual-order-credentials"
                className="acct-input"
                placeholder={mt.manualDeliveryPlaceholder}
                rows={3}
                value={manualCards}
                onChange={(event) => setManualCards(event.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="acct-btn"
                  disabled={submittingDelivery || !manualCards.trim()}
                >
                  {mt.manualDeliverySubmit}
                </button>
                <button
                  type="button"
                  className="acct-btn"
                  onClick={() => {
                    setManualOrderNo(null);
                    setManualCards('');
                  }}
                >
                  {mt.manualDeliveryCancel}
                </button>
              </div>
            </form>
          )}
          {refundDetails && (
            <AdminRefundPanel
              key={refundDetails.orderNo}
              orderNo={refundDetails.orderNo}
              view={refundDetails.view}
              onUpdate={(view) =>
                setRefundDetails((current) =>
                  current?.orderNo === refundDetails.orderNo ? { ...current, view } : current
                )
              }
              onClose={() => setRefundDetails(null)}
              onComplete={async () => {
                await onReload();
                onStorefrontUpdated();
              }}
            />
          )}
          {displayedOrders.length === 0 ? (
            <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              {ac.ordEmpty}
            </p>
          ) : (
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-4">{ac.ordColNo}</th>
                  <th className="py-2 pr-4">{ac.ordColProd}</th>
                  <th className="py-2 pr-4">{ac.ordColEmail}</th>
                  <th className="py-2 pr-4">{ac.ordColSourceStatus}</th>
                  <th className="py-2 pr-4">{ac.ordColPaidProfit}</th>
                  <th className="py-2 text-right">{ac.ordColActions}</th>
                </tr>
              </thead>
              <tbody>
                {displayedOrders.map((o) => {
                  const netProfit =
                    Number(o.total_amount) -
                    Number(o.commission_amount || 0) -
                    Number(o.upstream_cost_total || 0);
                  return (
                    <tr
                      key={o.order_no}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-2.5 pr-4 font-mono-num">{o.public_order_no || o.order_no}</td>
                      <td className="py-2.5 pr-4">
                        {(() => {
                          const pid = o.product_id;
                          return pid && onEditProductById ? (
                            <button
                              type="button"
                              onClick={() => onEditProductById(pid)}
                              className="font-medium text-left hover:underline cursor-pointer"
                              style={{ color: 'var(--accent)' }}
                            >
                              {o.product_title}
                            </button>
                          ) : (
                            <div className="font-medium">{o.product_title}</div>
                          );
                        })()}
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {o.spec_name} × {o.quantity}
                        </div>
                      </td>
                      <td className="py-2.5 pr-4">{o.contact_email}</td>
                      <td className="py-2.5 pr-4">
                        <div className="font-mono-num text-[11px]">
                          {o.tenant_slug ? `@${o.tenant_slug} (${o.channel})` : ac.ordDirectCustomer}
                        </div>
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          <span
                            className="inline-block text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{
                              backgroundColor:
                                o.status === 'refunded' ||
                                o.status === 'fulfillment_failed' ||
                                o.status === 'risk_review'
                                  ? 'var(--danger-soft)'
                                  : o.status === 'upstream_pending'
                                    ? 'var(--warning-soft)'
                                    : 'var(--success-soft)',
                              color:
                                o.status === 'refunded' ||
                                o.status === 'fulfillment_failed' ||
                                o.status === 'risk_review'
                                  ? 'var(--danger)'
                                  : o.status === 'upstream_pending'
                                    ? 'var(--warning)'
                                    : 'var(--success)',
                            }}
                          >
                            {o.status === 'risk_review'
                              ? rf.ordStatusRiskReview
                              : o.status === 'refunded'
                                ? ac.ovStatusRefunded
                                : o.status === 'delivered'
                                  ? ac.ordStatusDelivered
                                  : o.status === 'upstream_pending'
                                    ? ac.ordStatusDispatching
                                    : o.status === 'fulfillment_failed'
                                      ? ac.ordStatusException
                                      : ac.ordStatusProcessing}
                          </span>
                          {o.fulfillment_source === 'upstream' && (
                            <span
                              className="inline-block text-[10px] px-1.5 py-0.5 rounded font-mono-num"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                              title={
                                o.upstream_order_no
                                  ? fmt(ac.ordUpOrderTitle, { orderNo: o.upstream_order_no })
                                  : ac.ordUpRealtimeTitle
                              }
                            >
                              {fmt(ac.ordUpSourceBadge, {
                                name: o.upstream_source_name || ac.ordUpDirectName,
                              })}
                            </span>
                          )}
                        </div>
                        {o.upstream_order_no && (
                          <div
                            className="text-[10px] font-mono-num mt-0.5 truncate max-w-[170px]"
                            style={{ color: 'var(--ink-muted)' }}
                            title={o.upstream_order_no}
                          >
                            {fmt(ac.ordUpOrderNo, { orderNo: o.upstream_order_no })}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono-num">
                        <div className="font-semibold">¥{Number(o.total_amount).toFixed(2)}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {fmt(ac.ordCommission, { amount: Number(o.commission_amount || 0).toFixed(2) })}
                          {o.fulfillment_source === 'upstream' &&
                            Number(o.upstream_cost_total || 0) > 0 &&
                            fmt(ac.ordCost, { amount: Number(o.upstream_cost_total).toFixed(2) })}
                        </div>
                        {o.fulfillment_source === 'upstream' && (
                          <div
                            className="text-[10.5px] font-semibold"
                            style={{ color: netProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}
                          >
                            {fmt(ac.ordNetProfit, { amount: netProfit.toFixed(2) })}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailOrderNo(o.order_no)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer"
                          style={{
                            borderColor: 'var(--accent)',
                            color: 'var(--accent)',
                            backgroundColor: 'var(--accent-soft)',
                          }}
                        >
                          <Eye className="w-3 h-3" />
                          {rf.ordDetailBtn}
                        </button>
                        {o.status === 'delivered' && o.public_order_no && (
                          <span className="text-[11px]">
                            {mt.orderMailLabel} · {orderMailStatusText(mt, o.mail_status)}
                          </span>
                        )}
                        {o.status === 'paid' && isSuperAdmin && (
                          <button
                            type="button"
                            className="acct-btn"
                            onClick={() => {
                              setManualCards('');
                              setManualOrderNo(o.order_no);
                            }}
                          >
                            {mt.manualDeliveryLabel}
                          </button>
                        )}
                        {(o.status === 'upstream_pending' || o.status === 'fulfillment_failed') &&
                          isSuperAdmin && (
                            <button
                              type="button"
                              onClick={onJumpToUpstreams}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer"
                              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                            >
                              {ac.ordHandleExcBtn}
                            </button>
                          )}
                        {o.status !== 'refunded' ? (
                          <>
                            {o.status === 'delivered' && o.public_order_no && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await adminApi.resendOrderEmail(o.order_no);
                                    showToast(orderMailStatusText(mt, res.mail_status));
                                    await onReload();
                                  } catch (err) {
                                    showToast(err instanceof Error ? err.message : ac.ordResendFailErr);
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer"
                                style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
                              >
                                {ac.ordResendBtn}
                              </button>
                            )}
                            {['paid', 'delivered', 'fulfillment_failed'].includes(o.status) && (
                              <button
                                type="button"
                                disabled={loadingRefund}
                                onClick={async () => {
                                  setLoadingRefund(true);
                                  try {
                                    const view = await adminRefundApi.getOrderRefund(o.order_no);
                                    setRefundDetails({ orderNo: o.order_no, view });
                                  } catch (error) {
                                    showToast(error instanceof Error ? error.message : ac.refLoadFailed);
                                  } finally {
                                    setLoadingRefund(false);
                                  }
                                }}
                                className="px-3 py-1 rounded-lg border text-xs font-medium cursor-pointer"
                                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                              >
                                {ac.ordRefundBtn}
                              </button>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                            {ac.ordSettledTag}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
      <AdminOrderDetailDrawer
        orderNo={detailOrderNo}
        onClose={() => setDetailOrderNo(null)}
        onChanged={async () => {
          await onReload();
          if (isFiltering) await searchQuery.refetch();
        }}
        showToast={showToast}
      />
    </div>
  );
}
