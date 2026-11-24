/**
 * 本地演示收银台扫码弹窗（确保演示通道也经过完整的二维码确认交互再扣款签发）
 */

import { Loader2, QrCode, ShieldAlert, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';

interface DemoCashierModalProps {
  open: boolean;
  amount: number;
  productTitle: string;
  specName: string;
  quantity: number;
  contactEmail: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirmPay: () => void;
}

export function DemoCashierModal({
  open,
  amount,
  productTitle,
  specName,
  quantity,
  contactEmail,
  submitting,
  onCancel,
  onConfirmPay,
}: DemoCashierModalProps) {
  const m = useCommonModalsI18n();
  const [channel, setChannel] = useState<'alipay' | 'wechat'>('alipay');
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    if (!open) {
      setQrDataUrl('');
      return;
    }
    const uri = `accthub://sandbox-pay/${channel}?amount=${amount.toFixed(2)}&qty=${quantity}`;
    void QRCode.toDataURL(uri, { width: 210, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [open, channel, amount, quantity]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(18, 17, 16, 0.62)' }}
      role="dialog"
      aria-modal="true"
      aria-label={m.cshDialogAria}
    >
      <div
        className="paper-card rounded-2xl w-full max-w-md p-6 space-y-4 border"
        style={{ borderColor: 'var(--border-strong)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className="text-[11px] font-mono-num uppercase tracking-wider"
              style={{ color: 'var(--accent)' }}
            >
              {m.demoCashierBadge}
            </div>
            <h3 className="font-editorial text-xl font-semibold mt-0.5">{m.demoCashierTitle}</h3>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={m.cshCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="rounded-xl p-4 text-center space-y-1 border"
          style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-xs truncate" style={{ color: 'var(--ink-secondary)' }}>
            {productTitle} · {specName} × {quantity}
          </div>
          <div className="text-2xl font-bold font-mono-num" style={{ color: 'var(--accent)' }}>
            ¥{amount.toFixed(2)}
          </div>
          <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
            {m.demoCashierEmailLabel}：{contactEmail}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setChannel('alipay')}
            className="py-2 rounded-xl border text-xs font-medium cursor-pointer"
            style={{
              borderColor: channel === 'alipay' ? 'var(--accent)' : 'var(--border-color)',
              backgroundColor: channel === 'alipay' ? 'var(--accent-soft)' : 'var(--bg-canvas)',
              color: channel === 'alipay' ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            {m.demoCashierChannelAlipay}
          </button>
          <button
            type="button"
            onClick={() => setChannel('wechat')}
            className="py-2 rounded-xl border text-xs font-medium cursor-pointer"
            style={{
              borderColor: channel === 'wechat' ? 'var(--accent)' : 'var(--border-color)',
              backgroundColor: channel === 'wechat' ? 'var(--accent-soft)' : 'var(--bg-canvas)',
              color: channel === 'wechat' ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            {m.demoCashierChannelWechat}
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="p-2.5 bg-white rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={m.cshQrAlt} className="w-44 h-44" />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center">
                <QrCode className="w-10 h-10 opacity-40" />
              </div>
            )}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {m.demoCashierQrHint}
          </div>
        </div>

        <div
          className="rounded-xl p-3 text-[11px] leading-relaxed flex items-start gap-2"
          style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}
        >
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{m.demoCashierHint}</span>
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border text-xs font-medium cursor-pointer"
            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
          >
            {m.demoCashierCancelBtn}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirmPay}
            className="flex-1 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-55"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? m.demoCashierPayingBtn : m.demoCashierConfirmBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
