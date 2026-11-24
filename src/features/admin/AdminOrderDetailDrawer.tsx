/**
 * 订单完整详情抽屉弹窗：查看明文卡密、买家自定义表单、买家 IP（一键拉黑）、风控放行与人工发货/掉单补单
 */

import { useQuery } from '@tanstack/react-query';
import { Ban, CheckCircle2, Loader2, Send, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { adminRiskApi } from '../../api/admin-risk.api';
import { fmt } from '../../i18n';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';

interface AdminOrderDetailDrawerProps {
  orderNo: string | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminOrderDetailDrawer({
  orderNo,
  onClose,
  onChanged,
  showToast,
}: AdminOrderDetailDrawerProps) {
  const rf = useRiskControlI18n();
  const [manualPayload, setManualPayload] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['admin', 'order-detail', orderNo],
    queryFn: () => adminRiskApi.getOrderDetail(orderNo as string),
    enabled: Boolean(orderNo),
  });

  if (!orderNo) return null;

  const order = detailQuery.data?.order;
  const intent = detailQuery.data?.payment_intent;
  const canManualConfirm =
    order &&
    ['pending_payment', 'expired', 'paid', 'fulfillment_failed', 'risk_review'].includes(order.status);

  const handleBanIp = async (ip: string) => {
    setBusy(true);
    try {
      await adminRiskApi.addIpBlacklist(ip, `Order ${orderNo}`);
      showToast(rf.riskIpAddedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveRisk = async () => {
    setBusy(true);
    try {
      const res = await adminRiskApi.approveRiskOrder(orderNo, manualNote.trim());
      showToast(fmt(rf.ordApproveRiskToast, { status: res.status }));
      await detailQuery.refetch();
      await onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const handleManualConfirm = async () => {
    setBusy(true);
    try {
      const res = await adminRiskApi.manualConfirmOrder(orderNo, manualPayload, manualNote.trim());
      setManualPayload('');
      setManualNote('');
      showToast(fmt(rf.ordManualConfirmToast, { status: res.status }));
      await detailQuery.refetch();
      await onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="paper-card rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden text-xs">
        <div
          className="px-6 py-4 border-b flex items-center justify-between gap-2 shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <h3 className="font-editorial text-lg font-semibold">{rf.ordDetailTitle}</h3>
            <div className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {orderNo}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {detailQuery.isLoading || !order ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : (
            <>
              {order.risk_note && (
                <div
                  className="p-3.5 rounded-xl border flex items-start gap-2"
                  style={{
                    borderColor: 'var(--danger)',
                    backgroundColor: 'var(--danger-soft)',
                    color: 'var(--danger)',
                  }}
                >
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">{rf.ordDetailRiskReason}</div>
                    <div className="mt-0.5">{order.risk_note}</div>
                  </div>
                </div>
              )}

              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div>
                  <span style={{ color: 'var(--ink-muted)' }}>SKU: </span>
                  <strong>
                    {order.product_title} ({order.spec_name} × {order.quantity})
                  </strong>
                </div>
                <div className="font-mono-num">
                  <span style={{ color: 'var(--ink-muted)' }}>Amount / Status: </span>
                  <strong>¥{Number(order.total_amount).toFixed(2)}</strong>
                  {order.payment_fee_amount > 0 && (
                    <span className="ml-1.5" style={{ color: 'var(--warning)' }}>
                      (+{rf.ordDetailPayFee} ¥{order.payment_fee_amount.toFixed(2)})
                    </span>
                  )}
                  <span
                    className="ml-2 px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    {order.status}
                  </span>
                </div>
                <div className="font-mono-num">
                  <span style={{ color: 'var(--ink-muted)' }}>Email: </span>
                  {order.contact_email}
                </div>
                <div className="flex items-center gap-2 font-mono-num">
                  <span style={{ color: 'var(--ink-muted)' }}>{rf.ordDetailBuyerIp}: </span>
                  <span>{order.buyer_ip || '-'}</span>
                  {order.buyer_ip && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleBanIp(order.buyer_ip)}
                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg border cursor-pointer"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    >
                      <Ban className="w-3 h-3" />
                      {rf.ordDetailBanIpBtn}
                    </button>
                  )}
                </div>
                {intent && (
                  <div
                    className="sm:col-span-2 font-mono-num text-[11px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    Intent: {intent.intent_no} ({intent.provider} · {intent.pay_amount} {intent.currency} ·{' '}
                    {intent.status}) {intent.provider_trade_no ? `· Trade: ${intent.provider_trade_no}` : ''}
                  </div>
                )}
              </div>

              {Object.keys(order.custom_inputs || {}).length > 0 && (
                <div className="space-y-1.5">
                  <div className="font-semibold">{rf.ordDetailCustomInputs}</div>
                  <div
                    className="p-3 rounded-xl border font-mono-num space-y-1"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    {Object.entries(order.custom_inputs).map(([k, v]) => (
                      <div key={k}>
                        <span style={{ color: 'var(--ink-muted)' }}>{k}: </span>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="font-semibold">{rf.ordDetailDeliveredCards}</div>
                {order.delivered_payload ? (
                  <pre
                    className="p-3 rounded-xl border font-mono-num text-[11.5px] whitespace-pre-wrap break-all max-h-48 overflow-y-auto"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    {order.delivered_payload}
                  </pre>
                ) : (
                  <div
                    className="p-3 rounded-xl border"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                  >
                    {rf.ordDetailNoCards}
                  </div>
                )}
              </div>

              {order.status === 'risk_review' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleApproveRisk()}
                  className="w-full py-2.5 rounded-xl font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: 'var(--success)', color: '#FAF9F5' }}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {rf.ordApproveRiskBtn}
                </button>
              )}

              {canManualConfirm && (
                <div
                  className="p-4 rounded-xl border space-y-2.5"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="font-semibold">{rf.ordManualConfirmTitle}</div>
                  <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {rf.ordManualConfirmHint}
                  </p>
                  <textarea
                    rows={3}
                    value={manualPayload}
                    onChange={(e) => setManualPayload(e.target.value)}
                    placeholder={rf.ordManualPayloadPlaceholder}
                    className="acct-input font-mono-num text-xs"
                  />
                  <input
                    type="text"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder={rf.ordManualNotePlaceholder}
                    className="acct-input text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleManualConfirm()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    {rf.ordManualConfirmBtn}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
