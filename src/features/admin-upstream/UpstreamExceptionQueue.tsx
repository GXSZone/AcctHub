/**
 * 上游直采异常待履约与异步确认队列组件（主动查单、换源重试、手动补卡、退余额）
 */

import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  type UpstreamExceptionOrderRecord,
  type UpstreamOrderLedgerRecord,
  type UpstreamSourceRecord,
  upstreamApi,
} from '../../api/upstream.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import { orderMailStatusText, useMailI18n } from '../../i18n/namespaces/mail';

interface UpstreamExceptionQueueProps {
  exceptionOrders: UpstreamExceptionOrderRecord[];
  upOrders: UpstreamOrderLedgerRecord[];
  sources: UpstreamSourceRecord[];
  ledgerLoading: boolean;
  onRefresh: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function UpstreamExceptionQueue({
  exceptionOrders,
  upOrders,
  sources,
  ledgerLoading,
  onRefresh,
  showToast,
}: UpstreamExceptionQueueProps) {
  const au = useAdminUpstreamI18n();
  const mt = useMailI18n();
  const [busyOrderNo, setBusyOrderNo] = useState<string | null>(null);
  const [manualOrderNo, setManualOrderNo] = useState<string | null>(null);
  const [manualCardsText, setManualCardsText] = useState('');
  const [manualUpOrderNo, setManualUpOrderNo] = useState('');
  const [manualUpCost, setManualUpCost] = useState('');
  const [retrySourcePick, setRetrySourcePick] = useState<Record<string, number>>({});

  return (
    <div className="paper-card rounded-2xl p-5 space-y-4">
      <div
        className="flex items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            className="w-4 h-4"
            style={{ color: exceptionOrders.length > 0 ? 'var(--danger)' : 'var(--success)' }}
          />
          <h3 className="font-editorial text-lg font-semibold">
            {fmt(au.exQueueTitle, { count: exceptionOrders.length })}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg border text-xs cursor-pointer"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${ledgerLoading ? 'animate-spin' : ''}`} />
          {au.refreshBtn}
        </button>
      </div>

      {exceptionOrders.length === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
          {au.exQueueEmpty}
        </p>
      ) : (
        <div className="space-y-3">
          {exceptionOrders.map((eo) => {
            const isPending = eo.status === 'upstream_pending';
            const matchingUp = upOrders.find((u) => u.local_order_no === eo.order_no);
            return (
              <div
                key={eo.order_no}
                className="p-4 rounded-xl border space-y-3 text-xs"
                style={{
                  borderColor: isPending ? 'var(--warning)' : 'var(--danger)',
                  backgroundColor: 'var(--bg-canvas)',
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono-num font-bold">{eo.order_no}</span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold"
                        style={{
                          backgroundColor: isPending ? 'var(--warning-soft)' : 'var(--danger-soft)',
                          color: isPending ? 'var(--warning)' : 'var(--danger)',
                        }}
                      >
                        {isPending ? au.exBadgePending : au.exBadgeFailed}
                      </span>
                      <span className="font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(au.exPaidLabel, {
                          amount: Number(eo.total_amount).toFixed(2),
                          method: eo.payment_method,
                        })}
                      </span>
                    </div>
                    <div className="font-medium">
                      {eo.product_title} ({eo.spec_name}) × {eo.quantity} · {eo.contact_email}
                    </div>
                    {eo.upstream_error && (
                      <div className="text-[11px]" style={{ color: 'var(--danger)' }}>
                        {fmt(au.exErrorPrefix, { err: eo.upstream_error })}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {isPending && matchingUp && (
                      <button
                        type="button"
                        disabled={busyOrderNo === eo.order_no}
                        onClick={async () => {
                          setBusyOrderNo(eo.order_no);
                          try {
                            const res = await upstreamApi.pollOrder(matchingUp.id);
                            showToast(
                              res.status === 'succeeded'
                                ? au.pollSuccessToast
                                : fmt(au.pollStatusToast, {
                                    status: res.status,
                                    errPart: res.errorMessage ? ` · ${res.errorMessage}` : '',
                                  })
                            );
                            await onRefresh();
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : au.pollFailedFallback);
                          } finally {
                            setBusyOrderNo(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {au.pollOrderBtn}
                      </button>
                    )}

                    {!isPending && (
                      <>
                        <select
                          value={retrySourcePick[eo.order_no] || 0}
                          onChange={(e) =>
                            setRetrySourcePick((p) => ({ ...p, [eo.order_no]: Number(e.target.value) }))
                          }
                          className="acct-input py-1 px-2 text-[11px] w-auto"
                        >
                          <option value={0}>{au.retryAutoPick}</option>
                          {sources.map((s) => (
                            <option key={s.id} value={s.id}>
                              {fmt(au.retrySpecificPick, { name: s.name })}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={busyOrderNo === eo.order_no}
                          onClick={async () => {
                            setBusyOrderNo(eo.order_no);
                            try {
                              const sid = retrySourcePick[eo.order_no] || undefined;
                              const res = await upstreamApi.retryFailedOrder(eo.order_no, sid);
                              showToast(
                                res.status === 'delivered'
                                  ? fmt(au.retryDeliveredToast, { orderNo: res.upstream_order_no || '' })
                                  : res.message || au.retryPendingFallback
                              );
                              await onRefresh();
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : au.retryFailedFallback);
                            } finally {
                              setBusyOrderNo(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {au.retryBtn}
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setManualOrderNo(manualOrderNo === eo.order_no ? null : eo.order_no);
                        setManualCardsText('');
                        setManualUpOrderNo(eo.upstream_order_no || '');
                        setManualUpCost(eo.upstream_cost_total ? String(eo.upstream_cost_total) : '');
                      }}
                      className="px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                      style={{ borderColor: 'var(--border-strong)' }}
                    >
                      {au.manualFulfillBtn}
                    </button>

                    {!isPending && (eo.payment_method === 'balance' || eo.user_id !== null) && (
                      <button
                        type="button"
                        disabled={busyOrderNo === eo.order_no}
                        onClick={async () => {
                          const compensation = eo.payment_method !== 'balance';
                          const ok = await openConfirm({
                            title: au.refundConfirmTitle,
                            description: fmt(au.refundConfirmDesc, {
                              orderNo: eo.order_no,
                              amount: Number(eo.total_amount).toFixed(2),
                            }),
                            confirmLabel: au.refundConfirmBtn,
                            tone: 'danger',
                          });
                          if (!ok) return;
                          setBusyOrderNo(eo.order_no);
                          try {
                            const res = await upstreamApi.refundFailedOrderToBalance(
                              eo.order_no,
                              compensation
                            );
                            showToast(
                              res.refundedToWallet
                                ? fmt(au.refundedWalletToast, { amount: res.amount.toFixed(2) })
                                : fmt(au.refundedWalletNoCashToast, { orderNo: eo.order_no })
                            );
                            await onRefresh();
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : au.refundFailedFallback);
                          } finally {
                            setBusyOrderNo(null);
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      >
                        {au.refundBtn}
                      </button>
                    )}
                  </div>
                </div>

                {manualOrderNo === eo.order_no && (
                  <div className="pt-3 border-t space-y-2.5" style={{ borderColor: 'var(--border-color)' }}>
                    <textarea
                      rows={3}
                      value={manualCardsText}
                      onChange={(e) => setManualCardsText(e.target.value)}
                      placeholder={au.manualCardsPlaceholder}
                      className="acct-input font-mono-num text-xs"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={manualUpOrderNo}
                        onChange={(e) => setManualUpOrderNo(e.target.value)}
                        placeholder={au.manualUpOrderPlaceholder}
                        className="acct-input text-xs w-52"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={manualUpCost}
                        onChange={(e) => setManualUpCost(e.target.value)}
                        placeholder={au.manualUpCostPlaceholder}
                        className="acct-input font-mono-num text-xs w-36"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const result = await upstreamApi.manualFulfillOrder(eo.order_no, {
                              cards_text: manualCardsText,
                              upstream_order_no: manualUpOrderNo,
                              upstream_cost: manualUpCost ? Number(manualUpCost) : undefined,
                            });
                            setManualOrderNo(null);
                            setManualCardsText('');
                            showToast(
                              `${mt.manualDeliveryCompleted} · ${orderMailStatusText(mt, result.mail_status)}`
                            );
                            await onRefresh();
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : au.manualFulfillFailedFallback);
                          }
                        }}
                        className="px-4 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                        style={{ backgroundColor: 'var(--success)', color: '#FAF9F5' }}
                      >
                        {au.manualFulfillConfirmBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
