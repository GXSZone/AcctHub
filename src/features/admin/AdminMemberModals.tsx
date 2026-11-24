/**
 * 运营总控后台会员管理弹窗组：人工余额调账弹窗 + 会员资金流水查验弹窗
 */

import type { AdminMemberItemDto } from '@shared/index';
import { Loader2, X } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { adminRiskApi } from '../../api/admin-risk.api';
import { fmt } from '../../i18n';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useAdminMemberTransactionsQuery } from '../../queries/admin.queries';

interface AdjustBalanceModalProps {
  target: AdminMemberItemDto | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminMemberAdjustModal({ target, onClose, onDone, showToast }: AdjustBalanceModalProps) {
  const ao = useAdminOpsI18n();
  const [mode, setMode] = useState<'add' | 'sub'>('add');
  const [amount, setAmount] = useState('50');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = Number(amount);
    if (!Number.isFinite(raw) || raw < 0.01) return;
    setSubmitting(true);
    try {
      const res = await adminApi.adjustMemberBalance(target.id, {
        amount: mode === 'add' ? raw : -raw,
        reason: reason.trim(),
      });
      setReason('');
      onClose();
      await onDone();
      showToast(fmt(ao.memAdjustOkToast, { refNo: res.ref_no, balance: res.balance.toFixed(2) }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : ao.finLoadError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="paper-card rounded-2xl w-full max-w-md p-6 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="font-editorial text-lg font-semibold">{ao.memAdjustTitle}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div
          className="p-3 rounded-xl border"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="font-semibold">
            {target.display_name} ({target.email})
          </div>
          <div className="font-mono-num mt-0.5" style={{ color: 'var(--success)' }}>
            ¥{target.balance.toFixed(2)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['add', ao.memAdjustTypeAdd],
              ['sub', ao.memAdjustTypeSub],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="py-2 rounded-xl border font-semibold cursor-pointer"
              style={{
                borderColor: mode === m ? 'var(--accent)' : 'var(--border-color)',
                backgroundColor: mode === m ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                color: mode === m ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <div className="font-semibold mb-1">{ao.memAdjustAmtLabel}</div>
          <input
            type="number"
            min={0.01}
            max={100000}
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="acct-input font-mono-num"
          />
        </div>

        <div>
          <div className="font-semibold mb-1">{ao.memAdjustReasonLabel}</div>
          <input
            type="text"
            required
            minLength={2}
            maxLength={180}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={ao.memAdjustReasonPlaceholder}
            className="acct-input"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-2.5 rounded-xl font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {ao.memAdjustConfirmBtn}
        </button>
      </form>
    </div>
  );
}

export function AdminMemberTxModal({ userId, onClose }: { userId: number | null; onClose: () => void }) {
  const ao = useAdminOpsI18n();
  const txQuery = useAdminMemberTransactionsQuery(userId);

  if (userId === null) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="paper-card rounded-2xl w-full max-w-2xl p-6 space-y-4 text-xs max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-editorial text-lg font-semibold">{ao.memTxModalTitle}</h3>
            {txQuery.data?.user && (
              <div className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {txQuery.data.user.email} · ¥{txQuery.data.user.balance.toFixed(2)}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg cursor-pointer"
            style={{ color: 'var(--ink-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {txQuery.isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : (txQuery.data?.transactions ?? []).length === 0 ? (
            <p className="py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
              {ao.memTxEmpty}
            </p>
          ) : (
            (txQuery.data?.transactions ?? []).map((tx) => (
              <div
                key={tx.id}
                className="p-3 rounded-xl border flex items-center justify-between gap-3"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="min-w-0">
                  <div className="font-medium">{tx.note || tx.type}</div>
                  <div className="font-mono-num text-[10.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {tx.type} {tx.ref_no ? `· ${tx.ref_no}` : ''} · {tx.created_at}
                  </div>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <div
                    className="font-semibold"
                    style={{ color: tx.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {tx.amount >= 0 ? `+¥${tx.amount.toFixed(2)}` : `-¥${Math.abs(tx.amount).toFixed(2)}`}
                  </div>
                  <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    ¥{tx.balance_after.toFixed(2)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminMemberResetPwdModal({
  target,
  onClose,
  showToast,
}: {
  target: AdminMemberItemDto | null;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  const rf = useRiskControlI18n();
  const [pwd, setPwd] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!target) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) return;
    setSubmitting(true);
    try {
      await adminRiskApi.resetMemberPassword(target.id, pwd);
      setPwd('');
      onClose();
      showToast(rf.memResetPwdToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="paper-card rounded-2xl w-full max-w-md p-6 space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="font-editorial text-lg font-semibold">{rf.memResetPwdTitle}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p style={{ color: 'var(--ink-secondary)' }}>{fmt(rf.memResetPwdDesc, { email: target.email })}</p>
        <input
          type="password"
          required
          minLength={8}
          maxLength={128}
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder={rf.memResetPwdPh}
          className="acct-input"
        />
        <button
          type="submit"
          disabled={submitting || pwd.length < 8}
          className="w-full py-2.5 rounded-xl font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {rf.memResetPwdConfirm}
        </button>
      </form>
    </div>
  );
}
