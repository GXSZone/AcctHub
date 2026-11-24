import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { ordersApi } from '../api/orders.api';
import { fmt } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { toast } from '../lib/toast';
import {
  hasTerminalOrderFailure,
  isOrderAwaitingDelivery,
  isWalletRechargeAwaitingCredit,
  usePaymentIntentQuery,
} from '../queries/payment.queries';
import type { OrderRecord, PaymentIntentInfo } from '../types';

interface AsyncCashierModalProps {
  intent: PaymentIntentInfo | null;
  onClose: () => void;
  onPaid: (result: { order?: OrderRecord | null; balance?: number }) => void;
}

/**
 * 统一异步支付收银台弹窗（支持 易支付 / Stripe / USDT TRC20 扫码、跳转、自动轮询与沙盒联调模拟）
 */
export function AsyncCashierModal({ intent, onClose, onPaid }: AsyncCashierModalProps) {
  const m = useCommonModalsI18n();
  const query = usePaymentIntentQuery(intent);
  const liveIntent = intent ? (query.data?.intent ?? intent) : null;
  const notifiedIntent = useRef<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    if (!intent) {
      setQrDataUrl('');
      return;
    }
    const content = intent.qr_content || intent.pay_url;
    if (content) {
      void QRCode.toDataURL(content, { width: 220, margin: 1 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(''));
    } else {
      setQrDataUrl('');
    }
  }, [intent]);

  useEffect(() => {
    const result = query.data;
    if (
      !result ||
      liveIntent?.status !== 'paid' ||
      isWalletRechargeAwaitingCredit(liveIntent) ||
      isOrderAwaitingDelivery(liveIntent, result.order) ||
      notifiedIntent.current === liveIntent.intent_no
    ) {
      return;
    }
    notifiedIntent.current = liveIntent.intent_no;
    onPaid({ order: result.order, balance: result.balance });
  }, [liveIntent, onPaid, query.data]);

  if (!liveIntent) return null;

  const awaitingCredit = isWalletRechargeAwaitingCredit(liveIntent);
  const awaitingDelivery = isOrderAwaitingDelivery(liveIntent, query.data?.order);
  const deliveryFailed =
    liveIntent.biz_type === 'order' &&
    liveIntent.status === 'paid' &&
    (hasTerminalOrderFailure(query.data?.order) ||
      (awaitingDelivery && liveIntent.fulfill_status === 'failed'));
  const isUsdt = liveIntent.provider.startsWith('usdt_');
  const usdtNetworkLabel =
    liveIntent.provider === 'usdt_bep20'
      ? 'BEP20 (BSC)'
      : liveIntent.provider === 'usdt_erc20'
        ? 'ERC20 (Ethereum)'
        : 'TRC20 (TRON)';
  const copyVal = async (key: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedField(key);
    toast.success(m.cshCopied);
    window.setTimeout(() => setCopiedField(null), 1600);
  };

  const handleManualCheck = async () => {
    setChecking(true);
    toast.clearErrors();
    try {
      await ordersApi.checkPaymentIntent(liveIntent.intent_no, intent?.view_token);
      await query.refetch({ throwOnError: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : m.cshCheckErr, { alertRole: false });
    } finally {
      setChecking(false);
    }
  };

  const handleSimulatePay = __ACCTHUB_SANDBOX__
    ? async () => {
        setSimulating(true);
        toast.clearErrors();
        try {
          await ordersApi.simulateSandboxPay?.(liveIntent.intent_no);
          await query.refetch({ throwOnError: true });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : (m.cshSandboxErr ?? ''), { alertRole: false });
        } finally {
          setSimulating(false);
        }
      }
    : undefined;

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
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-[11px] font-mono-num uppercase tracking-wider"
              style={{ color: 'var(--accent)' }}
            >
              ASYNC CHECKOUT · {liveIntent.provider.toUpperCase()}
            </div>
            <h3 className="font-editorial text-xl font-semibold mt-0.5">
              {deliveryFailed
                ? m.cshTitleDeliveryFailed
                : awaitingDelivery
                  ? m.cshTitleAwaitingDelivery
                  : awaitingCredit
                    ? m.cshTitleAwaitingCredit
                    : liveIntent.status === 'paid'
                      ? m.cshTitlePaid
                      : liveIntent.status === 'expired'
                        ? m.cshTitleExpired
                        : m.cshTitlePending}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
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
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {m.cshIntentNoPrefix}
            <span className="font-mono-num">{liveIntent.intent_no}</span>
          </div>
          <div className="text-2xl font-bold font-mono-num" style={{ color: 'var(--accent)' }}>
            {isUsdt
              ? `${Number(liveIntent.pay_amount).toFixed(4)} USDT`
              : `${liveIntent.currency === 'USD' ? '$' : '¥'}${Number(liveIntent.pay_amount).toFixed(2)} ${liveIntent.currency}`}
          </div>
          {isUsdt && (
            <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
              {fmt(m.cshUsdtHint, { amount: Number(liveIntent.amount_cny).toFixed(2) })}
            </div>
          )}
        </div>

        {deliveryFailed || awaitingDelivery ? (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ backgroundColor: 'var(--bg-subtle)' }}
            role="status"
          >
            {deliveryFailed ? m.cshDeliveryFailedBanner : m.cshAwaitingDeliveryBanner}
          </div>
        ) : awaitingCredit ? (
          <div className="space-y-2 text-sm" role="status">
            <p>{m.cshAwaitingCreditBanner}</p>
            <button
              type="button"
              disabled={checking}
              onClick={() => void handleManualCheck()}
              className="px-3 py-2 rounded-xl text-xs font-medium border cursor-pointer"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {m.cshCheckBtn}
            </button>
          </div>
        ) : liveIntent.status === 'paid' ? (
          <div
            className="rounded-xl p-4 flex items-center gap-3 text-sm"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>{m.cshPaidBanner}</span>
          </div>
        ) : liveIntent.status === 'expired' ? (
          <div
            className="rounded-xl p-4 text-sm text-center"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
          >
            {m.cshExpiredBanner}
          </div>
        ) : (
          <div className="space-y-3">
            {qrDataUrl && (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="p-2.5 bg-white rounded-xl border"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <img src={qrDataUrl} alt={m.cshQrAlt} className="w-44 h-44" />
                </div>
                <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--ink-muted)' }}>
                  <Clock className="w-3.5 h-3.5" />
                  <span>{fmt(m.cshValidUntil, { time: liveIntent.expires_at })}</span>
                </div>
              </div>
            )}

            {isUsdt && liveIntent.qr_content && (
              <div className="space-y-2 text-xs">
                <div
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl border"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="truncate">
                    <div className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                      {usdtNetworkLabel} {m.cshRecvAddressSuffix}
                    </div>
                    <div className="font-mono-num truncate">{liveIntent.qr_content}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyVal('addr', liveIntent.qr_content)}
                    className="px-2.5 py-1.5 rounded-lg border shrink-0 cursor-pointer inline-flex items-center gap-1"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    {copiedField === 'addr' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedField === 'addr' ? m.cshCopied : m.cshCopyAddress}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void copyVal('amt', Number(liveIntent.pay_amount).toFixed(4))}
                  className="w-full py-2 rounded-xl border cursor-pointer inline-flex items-center justify-center gap-1.5"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  {copiedField === 'amt' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedField === 'amt'
                    ? m.cshCopiedAmt
                    : fmt(m.cshCopyAmt, { amount: Number(liveIntent.pay_amount).toFixed(4) })}
                </button>
              </div>
            )}

            {liveIntent.pay_url && (
              <a
                href={liveIntent.pay_url}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2 no-underline"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                <ExternalLink className="w-4 h-4" />
                {m.cshGoPayBtn}
              </a>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={checking}
                onClick={() => void handleManualCheck()}
                className="flex-1 py-2 rounded-xl text-xs font-medium border cursor-pointer inline-flex items-center justify-center gap-1.5"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {checking ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {m.cshCheckBtn}
              </button>

              {__ACCTHUB_SANDBOX__ && liveIntent.sandbox_simulated && handleSimulatePay && (
                <button
                  type="button"
                  disabled={simulating}
                  onClick={() => void handleSimulatePay()}
                  className="flex-1 py-2 rounded-xl text-xs font-medium cursor-pointer inline-flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: 'var(--success)', color: '#FAF9F5' }}
                >
                  {simulating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  {m.cshSandboxBtn}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
