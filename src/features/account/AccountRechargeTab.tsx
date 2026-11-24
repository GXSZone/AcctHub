/**
 * 会员中心充值中心 Tab（在线余额充值与 CDK 卡密兑换）
 */

import { ASYNC_PAYMENT_PROVIDERS, type AsyncPaymentProvider } from '@shared/constants/enums';
import { DEFAULT_MIN_TOPUP_AMOUNT, MAX_TOPUP_AMOUNT } from '@shared/domain/payment-plugin-settings';
import { ExternalLink, KeyRound, Loader2, Sparkles, Ticket, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { accountApi } from '../../api/account.api';
import { AsyncCashierModal } from '../../components/AsyncCashierModal';
import { TurnstileWidget } from '../../components/TurnstileWidget';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useAccountRechargeIntentMutation, useInvalidateAccount } from '../../queries/account.queries';
import type { BootstrapPayload, PaymentIntentInfo, UserProfile } from '../../types';

interface AccountRechargeTabProps {
  user: UserProfile;
  bootstrap?: BootstrapPayload | null;
  onRefreshUser: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AccountRechargeTab({
  user,
  bootstrap,
  onRefreshUser,
  onToast,
  onError,
}: AccountRechargeTabProps) {
  const acc = useAccountI18n();
  const invalidateAccount = useInvalidateAccount();
  const rechargeIntent = useAccountRechargeIntentMutation();
  const minTopup = bootstrap?.recharge?.min_topup ?? DEFAULT_MIN_TOPUP_AMOUNT;
  const maxTopup = bootstrap?.recharge?.max_topup ?? MAX_TOPUP_AMOUNT;
  const cdkPurchaseUrl = bootstrap?.recharge?.cdk_purchase_url || '';
  const cdkPurchaseLabel = bootstrap?.recharge?.cdk_purchase_label || acc.cdkBuyExternalDefaultBtn;
  const [rechargeAmt, setRechargeAmt] = useState(() => Math.max(100, minTopup));
  const quickAmounts = useMemo(() => {
    const base = [10, 50, 100, 200, 500, 1000].filter((v) => v >= minTopup && v <= maxTopup);
    if (!base.includes(minTopup) && minTopup <= maxTopup) {
      return [minTopup, ...base].slice(0, 6);
    }
    return base.slice(0, 6);
  }, [minTopup, maxTopup]);

  useEffect(() => {
    setRechargeAmt((prev) => Math.max(prev, minTopup));
  }, [minTopup]);
  const [selectedProvider, setSelectedProvider] = useState<AsyncPaymentProvider>();
  const [activeIntent, setActiveIntent] = useState<PaymentIntentInfo | null>(null);
  const [cdkInput, setCdkInput] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);
  const paymentMethods = ASYNC_PAYMENT_PROVIDERS.flatMap((id) => {
    const method = bootstrap?.payment_methods?.find((entry) => entry.id === id && entry.enabled);
    return method ? [{ ...method, id }] : [];
  });
  const provider =
    paymentMethods.find((method) => method.id === selectedProvider)?.id ?? paymentMethods[0]?.id;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.rechargeTitle}</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {acc.rechargeCurrBalance}
          <strong className="font-mono-num text-sm" style={{ color: 'var(--success)' }}>
            ¥{user.balance.toFixed(2)}
          </strong>
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!provider || rechargeIntent.isPending || activeIntent) return;
            onError('');
            try {
              const { payment_intent } = await rechargeIntent.mutateAsync({
                amount: rechargeAmt,
                payment_method: provider,
              });
              setActiveIntent(payment_intent);
            } catch (err) {
              onError(err instanceof Error ? err.message : acc.rechargeFailErr);
            }
          }}
          className="paper-card rounded-2xl p-6 space-y-4"
        >
          <div
            className="flex items-center gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Wallet className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{acc.rechargeOnlineTitle}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickAmounts.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setRechargeAmt(v)}
                className="px-3.5 py-1.5 rounded-xl border text-xs font-mono-num font-semibold cursor-pointer"
                style={{
                  borderColor: rechargeAmt === v ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: rechargeAmt === v ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                  color: rechargeAmt === v ? 'var(--accent)' : 'var(--ink-primary)',
                }}
              >
                ¥{v}
              </button>
            ))}
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.rechargeCustomAmtLabel}</div>
            <input
              type="number"
              min={minTopup}
              max={maxTopup}
              step={Number.isInteger(minTopup) ? '1' : '0.01'}
              required
              value={rechargeAmt}
              onChange={(e) => setRechargeAmt(Number(e.target.value))}
              className="acct-input font-mono-num"
            />
          </div>
          {paymentMethods.length > 0 ? (
            <label className="block space-y-1">
              <span className="block text-xs font-semibold">{acc.rechargePaymentLabel}</span>
              <select
                className="acct-input"
                value={provider}
                onChange={(e) => {
                  setSelectedProvider(paymentMethods.find((method) => method.id === e.target.value)?.id);
                }}
              >
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            bootstrap && (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                  {acc.rechargeNoPaymentMethods}
                </p>
                {cdkPurchaseUrl && (
                  <a
                    href={cdkPurchaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold no-underline"
                    style={{
                      borderColor: 'var(--accent)',
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent)',
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{cdkPurchaseLabel}</span>
                  </a>
                )}
              </div>
            )
          )}
          <button
            type="submit"
            disabled={rechargeIntent.isPending || !!activeIntent || !provider}
            className="w-full py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {rechargeIntent.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {fmt(acc.rechargeSubmitBtn, { amount: rechargeAmt })}
          </button>
        </form>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setRedeeming(true);
            onError('');
            try {
              const res = await accountApi.redeemCdk(cdkInput, turnstileToken || undefined);
              setCdkInput('');
              onRefreshUser();
              void invalidateAccount();
              onToast(
                fmt(acc.cdkSuccessToast, {
                  added: res.added.toFixed(2),
                  balance: res.balance.toFixed(2),
                })
              );
            } catch (err) {
              onError(err instanceof Error ? err.message : acc.cdkFailErr);
              setTurnstileReset((n) => n + 1);
            } finally {
              setRedeeming(false);
            }
          }}
          className="paper-card rounded-2xl p-6 space-y-4"
        >
          <div
            className="flex items-center gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Ticket className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{acc.cdkTitle}</h2>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {acc.cdkDesc}
          </p>
          {cdkPurchaseUrl && (
            <div
              className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <span className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                {acc.cdkBuyExternalHint}
              </span>
              <a
                href={cdkPurchaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold no-underline shrink-0"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{cdkPurchaseLabel}</span>
              </a>
            </div>
          )}
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.cdkInputLabel}</div>
            <input
              type="text"
              required
              value={cdkInput}
              onChange={(e) => setCdkInput(e.target.value.toUpperCase())}
              placeholder={acc.cdkPlaceholder}
              className="acct-input font-mono-num tracking-wider"
            />
          </div>
          <TurnstileWidget
            enabled={bootstrap?.security?.turnstile_enabled}
            siteKey={bootstrap?.security?.turnstile_site_key}
            action="redeem_cdk"
            resetSignal={turnstileReset}
            onToken={setTurnstileToken}
          />
          <button
            type="submit"
            disabled={redeeming}
            className="w-full py-2.5 rounded-xl border text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
            style={{
              borderColor: 'var(--accent)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            {redeeming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <KeyRound className="w-3.5 h-3.5" />
            )}
            {acc.cdkSubmitBtn}
          </button>
        </form>
      </div>
      <AsyncCashierModal
        intent={activeIntent}
        onClose={() => setActiveIntent(null)}
        onPaid={({ balance }) => {
          setActiveIntent(null);
          onRefreshUser();
          void invalidateAccount();
          if (activeIntent && typeof balance === 'number') {
            onToast(
              fmt(acc.rechargeSuccessToast, {
                added: activeIntent.amount_cny.toFixed(2),
                balance: balance.toFixed(2),
              })
            );
          }
        }}
      />
    </div>
  );
}
