/**
 * 会员中心 · 邀请有礼（Affiliate 推广消费金）面板
 */

import { Check, Copy, Gift, Link2, Loader2, ShieldAlert, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useAccountAffiliateQuery } from '../../queries/account.queries';
import type { BootstrapPayload, UserProfile } from '../../types';

interface AccountAffiliateTabProps {
  user?: UserProfile | null;
  bootstrap?: BootstrapPayload | null;
  onToast: (msg: string) => void;
}

function AffiliatePagination({
  history,
  next,
  fetching,
  onNavigate,
}: {
  history: number[];
  next: number | null;
  fetching: boolean;
  onNavigate: (history: number[]) => void;
}) {
  const acc = useAccountI18n();
  if (!history.length && next === null) return null;
  return (
    <div className="flex justify-end gap-2 text-xs">
      <button
        type="button"
        disabled={fetching || !history.length}
        onClick={() => onNavigate(history.slice(0, -1))}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
      >
        {acc.affPreviousPage}
      </button>
      <button
        type="button"
        disabled={fetching || next === null}
        onClick={() => next !== null && onNavigate([...history, next])}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-50"
      >
        {acc.affNextPage}
      </button>
    </div>
  );
}

export function AccountAffiliateTab({ onToast }: AccountAffiliateTabProps) {
  const acc = useAccountI18n();
  const txTypeLabel = useMemo<Record<string, string>>(
    () => ({
      reward: acc.affTxReward,
      spend: acc.affTxSpend,
      refund: acc.affTxRefund,
      clawback: acc.affTxClawback,
    }),
    [acc]
  );
  const [ledgerHistory, setLedgerHistory] = useState<number[]>([]);
  const [promoHistory, setPromoHistory] = useState<number[]>([]);
  const { data, isLoading, isFetching, isError, error, refetch } = useAccountAffiliateQuery(true, {
    ledger_before_id: ledgerHistory.at(-1),
    promo_before_id: promoHistory.at(-1),
  });
  const [copied, setCopied] = useState(false);

  const referralPath = data?.referral_path ?? null;
  const fullInviteUrl = useMemo(() => {
    if (!referralPath) return '';
    try {
      return new URL(referralPath, window.location.origin).toString();
    } catch {
      return `${window.location.origin}${referralPath}`;
    }
  }, [referralPath]);

  if (isError && !data) {
    return (
      <div className="space-y-2 text-xs">
        <p role="alert">{error.message}</p>
        <button type="button" onClick={() => void refetch()} className="rounded-lg border px-3 py-1.5">
          {acc.affRetryBtn}
        </button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  const handleCopy = async () => {
    if (!fullInviteUrl) return;
    try {
      await navigator.clipboard.writeText(fullInviteUrl);
      setCopied(true);
      onToast(acc.affLinkCopiedToast);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast(fullInviteUrl);
    }
  };

  if (!data.available_on_site) {
    return (
      <div className="paper-card rounded-2xl p-6 space-y-2 text-xs" style={{ color: 'var(--ink-secondary)' }}>
        <h2 className="font-editorial text-xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
          {acc.affUnavailableTitle}
        </h2>
        <p>{acc.affUnavailableDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.affTitle}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {fmt(acc.affDescPart1, { minAmt: data.min_order_amount })}{' '}
            <strong style={{ color: 'var(--accent)' }}>{(data.commission_rate * 100).toFixed(1)}%</strong>{' '}
            {fmt(acc.affDescPart2, { minAmt: data.min_order_amount })}
          </p>
        </div>
      </div>

      {!data.affiliate_enabled && (
        <div
          className="p-3.5 rounded-2xl border flex items-center gap-2 text-xs"
          style={{
            backgroundColor: 'var(--warning-soft)',
            borderColor: 'var(--warning)',
            color: 'var(--warning)',
          }}
        >
          <ShieldAlert className="w-4 h-4 shrink-0" />
          {acc.affPausedBanner}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="paper-card rounded-2xl p-5 space-y-1.5">
          <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
            <Gift className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {acc.affPromoLabel}
          </div>
          <div className="font-mono-num text-3xl font-bold" style={{ color: 'var(--accent)' }}>
            ¥{data.promo_balance.toFixed(2)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.affPromoHint}
          </div>
        </div>

        <div className="paper-card rounded-2xl p-5 space-y-1.5">
          <div className="text-xs flex items-center gap-1.5" style={{ color: 'var(--ink-muted)' }}>
            <Users className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
            {acc.affReferredLabel}
          </div>
          <div className="font-mono-num text-3xl font-bold">
            {fmt(acc.affReferredCount, { count: data.referred_count })}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.affReferredHint}
          </div>
        </div>

        <div className="paper-card rounded-2xl p-5 space-y-1.5">
          <div className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            {acc.affRewardLabel}
          </div>
          <div className="font-mono-num text-3xl font-bold" style={{ color: 'var(--success)' }}>
            ¥{data.settled_reward_total.toFixed(2)}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.affRewardHint}
          </div>
        </div>
      </div>

      {data.affiliate_enabled && data.referral_code && (
        <div className="paper-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold flex items-center gap-1.5">
              <Link2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              {fmt(acc.affInviteCardTitle, { code: data.referral_code || '-' })}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={fullInviteUrl}
              className="acct-input font-mono-num text-xs flex-1"
            />
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? acc.affCopiedBtn : acc.affCopyBtn}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="paper-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold">{acc.affLedgerTitle}</h3>
          {data.ledgers.length === 0 ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              {acc.affLedgerEmpty}
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {data.ledgers.map((l) => (
                <div
                  key={l.id}
                  className="p-3 rounded-xl border text-xs flex items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div>
                    <div className="font-mono-num font-semibold">{l.order_no}</div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(acc.affLedgerItemMeta, {
                        amount: l.order_amount.toFixed(2),
                        rate: (l.commission_rate * 100).toFixed(1),
                        time: l.created_at,
                      })}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className="font-mono-num font-bold"
                      style={{ color: l.status === 'clawed_back' ? 'var(--danger)' : 'var(--success)' }}
                    >
                      {l.status === 'clawed_back'
                        ? fmt(acc.affLedgerClawedBack, { amount: l.clawed_back_amount.toFixed(2) })
                        : `+¥${l.reward_amount.toFixed(2)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AffiliatePagination
            history={ledgerHistory}
            next={data.ledger_next_before_id}
            fetching={isFetching}
            onNavigate={setLedgerHistory}
          />
        </div>

        <div className="paper-card rounded-2xl p-5 space-y-3">
          <h3 className="text-sm font-semibold">{acc.affTxTitle}</h3>
          {data.promo_transactions.length === 0 ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              {acc.affTxEmpty}
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {data.promo_transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-xl border text-xs flex items-center justify-between gap-2"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{txTypeLabel[tx.type] || tx.type}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                      {tx.note}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono-num">
                    <div
                      className="font-bold"
                      style={{ color: tx.amount >= 0 ? 'var(--success)' : 'var(--ink-primary)' }}
                    >
                      {tx.amount >= 0 ? `+¥${tx.amount.toFixed(2)}` : `-¥${Math.abs(tx.amount).toFixed(2)}`}
                    </div>
                    <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(acc.affTxBalanceAfter, { amount: tx.balance_after.toFixed(2) })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AffiliatePagination
            history={promoHistory}
            next={data.promo_next_before_id}
            fetching={isFetching}
            onNavigate={setPromoHistory}
          />
        </div>
      </div>
    </div>
  );
}
