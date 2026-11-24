/**
 * 商品结账台下半区：支付通道选择、优惠券核销、透明费用明细与缺货登记/提交按钮
 */

import {
  BellRing,
  Check,
  Coins,
  CreditCard,
  Loader2,
  LogIn,
  QrCode,
  Sparkles,
  Tag,
  Wallet,
  Zap,
} from 'lucide-react';
import { fmt } from '../../i18n';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useDisplayCurrency } from '../../lib/currency';
import type { AgentTierInfo, PaymentMethod, UserProfile } from '../../types';

interface ProductPaymentSectionProps {
  availablePayments: PaymentMethod[];
  paymentMethod: string;
  user: UserProfile | null;
  agentTier?: AgentTierInfo | null;
  couponInput: string;
  appliedCoupon: { code: string; name: string; discount_amount: number } | null;
  couponError: string;
  validatingCoupon: boolean;
  retailUnitPrice: number;
  quantity: number;
  totalSaved: number;
  promoUsedPreview?: number;
  totalAmount: number;
  paymentFeeRatePct?: number;
  paymentFeeAmount?: number;
  payableWithFee?: number;
  balanceInsufficient: boolean;
  submitError: string;
  guestRequiresLogin?: boolean;
  guestLoginReason?: string;
  activeSpecStock: number;
  restockEmail: string;
  restockDoneMsg: string;
  restockLoading: boolean;
  submitting: boolean;
  onSelectPayment: (id: string) => void;
  onOpenAuth: () => void;
  onCouponInputChange: (val: string) => void;
  onApplyCoupon: () => void;
  onRestockEmailChange: (val: string) => void;
  onRestockSubscribe: () => void;
}

export function ProductPaymentSection({
  availablePayments,
  paymentMethod,
  user,
  agentTier,
  couponInput,
  appliedCoupon,
  validatingCoupon,
  retailUnitPrice,
  quantity,
  totalSaved,
  promoUsedPreview = 0,
  totalAmount,
  paymentFeeRatePct = 0,
  paymentFeeAmount = 0,
  payableWithFee,
  balanceInsufficient,
  guestRequiresLogin = false,
  guestLoginReason,
  activeSpecStock,
  restockEmail,
  restockDoneMsg,
  restockLoading,
  submitting,
  onSelectPayment,
  onOpenAuth,
  onCouponInputChange,
  onApplyCoupon,
  onRestockEmailChange,
  onRestockSubscribe,
}: ProductPaymentSectionProps) {
  const sf = useStorefrontI18n();
  const rf = useRiskControlI18n();
  const { formatMoneyFixed } = useDisplayCurrency();
  const finalPayAmount = payableWithFee ?? totalAmount;
  return (
    <>
      <div>
        <div className="text-xs font-semibold mb-2.5">{sf.paymentMethodTitle}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {availablePayments.map((pm) => {
            const isBalance = pm.id === 'balance';
            const active = paymentMethod === pm.id;
            const channelName = pm.name.replace(/（.*?）/g, '').trim();
            return (
              <button
                key={pm.id}
                type="button"
                onClick={() => {
                  if (isBalance && !user) onOpenAuth();
                  else onSelectPayment(pm.id);
                }}
                aria-pressed={active}
                className="group px-3.5 py-3 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between gap-2.5"
                style={{
                  borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                  boxShadow: active ? '0 0 0 1px var(--accent)' : 'none',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      backgroundColor: active ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                      color: isBalance ? 'var(--success)' : 'var(--accent)',
                    }}
                  >
                    <PaymentMethodIcon id={pm.id} />
                  </span>
                  <div className="min-w-0">
                    <div
                      className="text-xs font-semibold leading-snug break-words"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      {channelName}
                    </div>
                    {isBalance && (
                      <div
                        className="text-[11px] font-mono-num mt-0.5 font-medium"
                        style={{ color: user ? 'var(--success)' : 'var(--ink-muted)' }}
                      >
                        {user ? formatMoneyFixed(user.balance) : sf.loginToUse}
                      </div>
                    )}
                    {!isBalance && Number(pm.fee_rate_pct || 0) > 0 && (
                      <div className="text-[10.5px] font-mono-num mt-0.5" style={{ color: 'var(--warning)' }}>
                        {fmt(rf.payFeeBadge, { rate: Number(pm.fee_rate_pct) })}
                      </div>
                    )}
                  </div>
                </div>
                <span
                  className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors"
                  style={{
                    borderColor: active ? 'var(--accent)' : 'var(--border-strong)',
                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                    color: '#FAF9F5',
                  }}
                >
                  {active && <Check className="w-2.5 h-2.5" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="order-coupon" className="block text-xs font-semibold mb-1">
          {sf.couponLabel}
        </label>
        <div className="flex gap-2">
          <input
            id="order-coupon"
            type="text"
            value={couponInput}
            onChange={(e) => onCouponInputChange(e.target.value.toUpperCase())}
            placeholder={sf.couponPlaceholder}
            className="acct-input font-mono-num text-xs flex-1"
          />
          <button
            type="button"
            disabled={validatingCoupon || !couponInput.trim()}
            onClick={onApplyCoupon}
            className="px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer whitespace-nowrap disabled:opacity-45 inline-flex items-center gap-1"
            style={{
              borderColor: 'var(--accent)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            <Tag className="w-3.5 h-3.5" />
            {sf.couponApplyBtn}
          </button>
        </div>
        {appliedCoupon && (
          <div className="text-[11px] mt-1 font-medium" style={{ color: 'var(--success)' }}>
            「{appliedCoupon.name}」 -{formatMoneyFixed(appliedCoupon.discount_amount)}
          </div>
        )}
      </div>

      <div
        className="p-3.5 rounded-xl border space-y-1.5 text-xs"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="flex items-center justify-between" style={{ color: 'var(--ink-secondary)' }}>
          <span>
            {sf.subtotalLabel}（{formatMoneyFixed(retailUnitPrice)} × {quantity}）
          </span>
          <span className="font-mono-num">{formatMoneyFixed(retailUnitPrice * quantity)}</span>
        </div>
        {totalSaved > 0 && (
          <div className="flex items-center justify-between" style={{ color: 'var(--success)' }}>
            <span>{agentTier ? `${agentTier.name} · ${sf.discountSavedLabel}` : sf.discountSavedLabel}</span>
            <span className="font-mono-num font-semibold">-{formatMoneyFixed(totalSaved)}</span>
          </div>
        )}
        {promoUsedPreview > 0 && (
          <div className="flex items-center justify-between" style={{ color: 'var(--success)' }}>
            <span>{sf.promoCreditDeduction}</span>
            <span className="font-mono-num font-semibold">-{formatMoneyFixed(promoUsedPreview)}</span>
          </div>
        )}
        {paymentFeeAmount > 0 && (
          <div className="flex items-center justify-between" style={{ color: 'var(--warning)' }}>
            <span>{fmt(rf.payFeeCheckoutLine, { rate: paymentFeeRatePct })}</span>
            <span className="font-mono-num font-semibold">+{formatMoneyFixed(paymentFeeAmount)}</span>
          </div>
        )}
        <div
          className="pt-1.5 border-t flex items-center justify-between font-semibold"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-primary)' }}
        >
          <span>{sf.payableAmountLabel}</span>
          <span className="font-mono-num text-base" style={{ color: 'var(--accent)' }}>
            {formatMoneyFixed(finalPayAmount)}
          </span>
        </div>
        {paymentMethod === 'balance' && user && (
          <div
            className="text-[11px] font-mono-num pt-0.5"
            style={{ color: balanceInsufficient ? 'var(--danger)' : 'var(--ink-muted)' }}
          >
            {balanceInsufficient
              ? fmt(sf.balanceShortfall, { diff: formatMoneyFixed(totalAmount - user.balance) })
              : fmt(sf.balanceAfterEst, { remain: formatMoneyFixed(user.balance - totalAmount) })}
          </div>
        )}
      </div>

      {activeSpecStock <= 0 ? (
        <div
          className="p-4 rounded-xl border space-y-2.5 text-xs"
          style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--warning-soft)' }}
        >
          <div className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--warning)' }}>
            <BellRing className="w-4 h-4 shrink-0" />
            {sf.restockTitle}
          </div>
          {restockDoneMsg ? (
            <div style={{ color: 'var(--success)' }}>{restockDoneMsg}</div>
          ) : (
            <div className="flex gap-2">
              <input
                type="email"
                value={restockEmail}
                onChange={(e) => onRestockEmailChange(e.target.value)}
                placeholder={sf.restockPlaceholder}
                className="acct-input h-9 text-xs flex-1"
              />
              <button
                type="button"
                disabled={restockLoading || !restockEmail.trim()}
                onClick={onRestockSubscribe}
                className="h-9 px-3.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {restockLoading ? sf.restockLoading : sf.restockBtn}
              </button>
            </div>
          )}
        </div>
      ) : guestRequiresLogin ? (
        <div className="space-y-2.5">
          <div
            className="p-3 rounded-xl border text-xs leading-relaxed"
            style={{
              borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--border-color))',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--ink-primary)',
            }}
          >
            {guestLoginReason || sf.guestLoginRequiredNotice}
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-2 transition-opacity"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <LogIn className="w-4 h-4" />
            {sf.guestLoginRequiredBtn}
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={
            submitting ||
            balanceInsufficient ||
            !availablePayments.some((method) => method.id === paymentMethod)
          }
          className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {balanceInsufficient
            ? sf.insufficientBalanceBtn
            : `${sf.checkoutBtnPrefix} · ${formatMoneyFixed(finalPayAmount)}`}
        </button>
      )}
    </>
  );
}

function PaymentMethodIcon({ id }: { id: string }) {
  if (id === 'balance') return <Wallet className="w-3.5 h-3.5" />;
  if (id === 'alipay_f2f') return <QrCode className="w-3.5 h-3.5" />;
  if (id.startsWith('usdt_')) return <Coins className="w-3.5 h-3.5" />;
  if (id === 'epay' || id === 'demo_instant') return <Zap className="w-3.5 h-3.5" />;
  return <CreditCard className="w-3.5 h-3.5" />;
}
