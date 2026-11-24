/**
 * 代理开通 / 补差升级收银弹窗（方案 A：首次开通在支付前自选店铺名与二级域名前缀并实时查重，付款即永久锁定）
 */

import { ASYNC_PAYMENT_PROVIDERS } from '@shared/constants/enums';
import { discountDisplay } from '@shared/domain/money';
import { AlertTriangle, CheckCircle2, CreditCard, Loader2, Lock, ShieldCheck, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { agentApi } from '../../api/agent.api';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../lib/uiHelpers';
import type { AgentTierInfo, PaymentMethod } from '../../types';

export interface TierPayConfirmPayload {
  paymentMethod: string;
  desiredSlug?: string;
  desiredBrandName?: string;
}

interface AgentTierPayModalProps {
  open: boolean;
  tier: AgentTierInfo | null;
  isUpgrade: boolean;
  amountDue: number;
  userBalance: number;
  neutralBaseDomain?: string;
  paymentMethods: PaymentMethod[];
  submitting: boolean;
  onClose: () => void;
  onConfirmPay: (payload: TierPayConfirmPayload) => void;
}

type SlugStatus = {
  state: 'idle' | 'checking' | 'available' | 'conflict';
  reason: string;
  suggestions: string[];
};

export function AgentTierPayModal({
  open,
  tier,
  isUpgrade,
  amountDue,
  userBalance,
  neutralBaseDomain = '',
  paymentMethods,
  submitting,
  onClose,
  onConfirmPay,
}: AgentTierPayModalProps) {
  const ag = useAgentI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [desiredBrand, setDesiredBrand] = useState('');
  const [desiredSlug, setDesiredSlug] = useState('');
  const [slugCheck, setSlugCheck] = useState<SlugStatus>({ state: 'idle', reason: '', suggestions: [] });

  const options = useMemo(() => {
    const asyncList = paymentMethods.filter(
      (m) => m.enabled && (ASYNC_PAYMENT_PROVIDERS as readonly string[]).includes(m.id)
    );
    const hasBalance = paymentMethods.some((m) => m.id === 'balance' && m.enabled);
    return [
      ...asyncList.map((m) => ({
        id: m.id,
        name: m.name,
        desc: m.description,
        isBalance: false,
      })),
      ...(hasBalance
        ? [
            {
              id: 'balance',
              name: ag.payModalBalanceName,
              desc: fmt(ag.payModalBalanceHint, { balance: userBalance.toFixed(2) }),
              isBalance: true,
            },
          ]
        : []),
    ];
  }, [ag.payModalBalanceHint, ag.payModalBalanceName, paymentMethods, userBalance]);

  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected((prev) => {
      if (prev && options.some((o) => o.id === prev)) return prev;
      const firstOnline = options.find((o) => !o.isBalance);
      if (firstOnline) return firstOnline.id;
      return options[0]?.id || '';
    });
  }, [open, options]);

  // 首次开通时对用户输入的二级域名前缀做防抖实时查重
  useEffect(() => {
    if (!open || isUpgrade) return;
    const cleaned = desiredSlug.trim().toLowerCase();
    if (!cleaned) {
      setSlugCheck({ state: 'idle', reason: '', suggestions: [] });
      return;
    }
    if (cleaned.length < 3) {
      setSlugCheck({ state: 'conflict', reason: ag.bdSlugMinErr, suggestions: [] });
      return;
    }
    setSlugCheck({ state: 'checking', reason: '', suggestions: [] });
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await agentApi.checkSlug(cleaned);
        if (cancelled) return;
        if (res.available) {
          setSlugCheck({ state: 'available', reason: '', suggestions: [] });
        } else {
          setSlugCheck({
            state: 'conflict',
            reason: res.reason || ag.bdSlugTakenErr,
            suggestions: res.suggestions || [],
          });
        }
      } catch {
        if (!cancelled) setSlugCheck({ state: 'idle', reason: '', suggestions: [] });
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ag.bdSlugMinErr, ag.bdSlugTakenErr, desiredSlug, isUpgrade, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) void closeDialogSmoothly(dialog);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    if (submitting) return;
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  const selectedOption = options.find((o) => o.id === selected);
  const balanceInsufficient = Boolean(selectedOption?.isBalance && userBalance < amountDue);
  const slugReady = isUpgrade || slugCheck.state === 'available';

  const portSuffix = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
  const suffixDomain = neutralBaseDomain ? `.${neutralBaseDomain}` : `.localhost${portSuffix}`;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="agent-tier-pay-title"
      className="acct-dialog"
    >
      {tier && (
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {ag.payModalStepBadge}
              </div>
              <h2 id="agent-tier-pay-title" className="font-editorial text-xl font-semibold">
                {isUpgrade
                  ? fmt(ag.upgradeConfirmTitle, { name: tier.name })
                  : fmt(ag.openConfirmTitle, { name: tier.name })}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
              aria-label={ag.payModalCancelBtn}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div
            className="p-3.5 rounded-xl border space-y-1.5"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--ink-muted)' }}>{ag.payModalDueLabel}</span>
              <span className="font-mono-num text-xl font-bold" style={{ color: 'var(--accent)' }}>
                ¥{amountDue.toFixed(2)}
              </span>
            </div>
            <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {fmt(ag.tierConfirmDesc, {
                diff: amountDue.toFixed(2),
                ...discountDisplay(tier.discount_rate),
              })}
            </p>
          </div>

          {!isUpgrade && (
            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold mb-1">{ag.payModalBrandLabel}</div>
                <input
                  type="text"
                  maxLength={64}
                  value={desiredBrand}
                  onChange={(e) => setDesiredBrand(e.target.value)}
                  placeholder={ag.payModalBrandPlaceholder}
                  className="acct-input text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1">
                    {ag.payModalSlugLabel}
                    <Lock className="w-3 h-3 opacity-60" />
                  </span>
                </div>
                <div
                  className="flex items-center rounded-xl border overflow-hidden"
                  style={{
                    borderColor:
                      slugCheck.state === 'conflict'
                        ? 'var(--danger)'
                        : slugCheck.state === 'available'
                          ? 'var(--success)'
                          : 'var(--border-strong)',
                    backgroundColor: 'var(--bg-canvas)',
                  }}
                >
                  <input
                    type="text"
                    value={desiredSlug}
                    onChange={(e) =>
                      setDesiredSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, '')
                          .slice(0, 24)
                      )
                    }
                    placeholder={ag.domSlugPlaceholder}
                    className="flex-1 min-w-0 px-3 py-2 text-xs font-mono-num bg-transparent outline-none"
                    style={{ color: 'var(--ink-primary)' }}
                  />
                  <span
                    className="px-2.5 py-2 text-[11px] font-mono-num shrink-0 select-none"
                    style={{ color: 'var(--ink-muted)', backgroundColor: 'var(--bg-subtle)' }}
                  >
                    {suffixDomain}
                  </span>
                </div>

                {slugCheck.state === 'checking' && (
                  <div
                    className="inline-flex items-center gap-1.5 text-[11px]"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {ag.domCheckingSlug}
                  </div>
                )}
                {slugCheck.state === 'available' && (
                  <div
                    className="inline-flex items-center gap-1 text-[11px] font-medium"
                    style={{ color: 'var(--success)' }}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {desiredSlug}
                    {suffixDomain}
                  </div>
                )}
                {slugCheck.state === 'conflict' && (
                  <div className="space-y-1">
                    <div
                      className="inline-flex items-center gap-1 text-[11px] font-medium"
                      style={{ color: 'var(--danger)' }}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {slugCheck.reason}
                    </div>
                    {slugCheck.suggestions.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                        <span style={{ color: 'var(--ink-muted)' }}>{ag.domAvailableSuggestions}</span>
                        {slugCheck.suggestions.map((sug) => (
                          <button
                            key={sug}
                            type="button"
                            onClick={() => setDesiredSlug(sug)}
                            className="px-2 py-0.5 rounded-md border font-mono-num cursor-pointer"
                            style={{
                              borderColor: 'var(--accent)',
                              backgroundColor: 'var(--accent-soft)',
                              color: 'var(--accent)',
                            }}
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
                  {ag.payModalSlugHint}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-xs font-semibold">{ag.payModalMethodLabel}</div>
            {options.length === 0 ? (
              <div
                className="p-3 rounded-xl text-xs"
                style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                {ag.payModalNoChannelErr}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {options.map((opt) => {
                  const active = selected === opt.id;
                  const lowBal = opt.isBalance && userBalance < amountDue;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSelected(opt.id)}
                      className="w-full p-2.5 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer transition-colors"
                      style={{
                        borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                        backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                          }}
                        >
                          {opt.isBalance ? (
                            <Wallet className="w-3.5 h-3.5" />
                          ) : (
                            <CreditCard className="w-3.5 h-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{opt.name}</div>
                          <div
                            className="text-[11px] truncate"
                            style={{ color: lowBal ? 'var(--danger)' : 'var(--ink-muted)' }}
                          >
                            {lowBal ? ag.payModalBalanceInsufficient : opt.desc}
                          </div>
                        </div>
                      </div>
                      <span
                        className="w-4 h-4 rounded-full border-2 shrink-0"
                        style={{
                          borderColor: active ? 'var(--accent)' : 'var(--border-strong)',
                          backgroundColor: active ? 'var(--accent)' : 'transparent',
                        }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border text-xs font-medium cursor-pointer"
              style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
            >
              {ag.payModalCancelBtn}
            </button>
            <button
              type="button"
              disabled={submitting || !selected || balanceInsufficient || !slugReady}
              onClick={() =>
                onConfirmPay({
                  paymentMethod: selected,
                  desiredSlug: isUpgrade ? undefined : desiredSlug.trim().toLowerCase(),
                  desiredBrandName: isUpgrade ? undefined : desiredBrand.trim() || undefined,
                })
              }
              className="px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {selectedOption?.isBalance
                ? fmt(ag.payModalBalanceSubmitBtn, { diff: amountDue.toFixed(2) })
                : fmt(ag.payModalOnlineSubmitBtn, { diff: amountDue.toFixed(2) })}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
