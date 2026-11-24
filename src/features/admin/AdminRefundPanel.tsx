import { ChevronDown, ChevronUp, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
  adminRefundApi,
  type RefundCommand,
  type RefundMode,
  type RefundRoute,
  type RefundStatus,
  type RefundView,
} from '../../api/admin-refund.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';

type AdminCopyKey = keyof ReturnType<typeof useAdminCoreI18n>;

const modeKeys: Record<RefundMode, AdminCopyKey> = {
  manual: 'refModeManual',
  automatic: 'refModeAutomatic',
};
const routeKeys: Record<RefundRoute, AdminCopyKey> = {
  original_payment: 'refRouteOriginal',
  wallet: 'refRouteWallet',
  wallet_compensation: 'refRouteCompensation',
};
const statusKeys: Record<RefundStatus, AdminCopyKey> = {
  ready: 'refStatusReady',
  manual_required: 'refStatusManual',
  submitting: 'refStatusSubmitting',
  pending: 'refStatusPending',
  unknown: 'refStatusUnknown',
  failed: 'refStatusFailed',
  succeeded: 'refStatusSucceeded',
};

export function AdminRefundPolicyButton({ title, subtitle }: { title?: string; subtitle?: string } = {}) {
  const ac = useAdminCoreI18n();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<RefundMode>('manual');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setBusy(true);
    setMessage('');
    try {
      const result = await adminRefundApi.getRefundPolicy();
      setMode(result.mode);
      setExpanded(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ac.refPolicyLoadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 space-y-3">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-3.5 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {title && (
          <div>
            <h2 className="font-editorial text-xl font-semibold">{title}</h2>
            {subtitle && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium cursor-pointer transition-colors shrink-0 disabled:opacity-50"
          style={{
            borderColor: expanded ? 'var(--accent)' : 'var(--border-strong)',
            backgroundColor: expanded ? 'var(--accent-soft)' : 'var(--bg-canvas)',
            color: expanded ? 'var(--accent)' : 'var(--ink-primary)',
          }}
          disabled={busy}
          onClick={() => {
            if (expanded) setExpanded(false);
            else void load();
          }}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
          <span>{expanded ? ac.refPolicyHide : ac.refPolicyShow}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>
      {expanded && (
        <form
          className="p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              const saved = await adminRefundApi.saveRefundPolicy(mode);
              setMode(saved.mode);
              setMessage(ac.refPolicySaved);
            } catch (error) {
              setMessage(error instanceof Error ? error.message : ac.refPolicySaveFailed);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="space-y-1 text-xs">
            <legend>{ac.refPolicyMode}</legend>
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="refund-mode"
                  checked={mode === 'manual'}
                  onChange={() => setMode('manual')}
                />
                {ac.refModeManual}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="refund-mode"
                  checked={mode === 'automatic'}
                  onChange={() => setMode('automatic')}
                />
                {ac.refPolicyAutomatic}
              </label>
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {ac.refPolicySave}
          </button>
          <p className="w-full text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {ac.refPolicyHint}
          </p>
        </form>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </div>
  );
}

interface RefundPanelProps {
  orderNo: string;
  view: RefundView;
  onUpdate: (view: RefundView) => void;
  onClose: () => void;
  onComplete: () => Promise<void>;
}

export function AdminRefundPanel({ orderNo, view, onUpdate, onClose, onComplete }: RefundPanelProps) {
  const ac = useAdminCoreI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [originalPayment, setOriginalPayment] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [reference, setReference] = useState('');
  const refund = view.refund;
  const route = refund?.route ?? view.route;
  const title = fmt(ac.refOrderTitle, { orderNo });
  const canQuery = refund && ['submitting', 'pending', 'unknown'].includes(refund.status);
  const canConfirm = refund?.route === 'original_payment' && !['ready', 'succeeded'].includes(refund.status);

  async function execute(command: RefundCommand) {
    setBusy(true);
    setMessage('');
    try {
      const result = await adminRefundApi.refundOrder(orderNo, command);
      onUpdate({ ...view, refund: result.refund });
      if (result.refund.status === 'succeeded') await onComplete();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : ac.refActionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="my-4 space-y-3 rounded-xl border p-4 text-xs" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <button type="button" className="rounded-lg border px-3 py-1.5" onClick={onClose}>
          {ac.refClose}
        </button>
      </div>
      <p>
        {ac[routeKeys[route]]} · {ac[modeKeys[refund?.mode ?? view.mode]]}
        {refund && ` · ${ac[statusKeys[refund.status]]}`}
      </p>
      {refund && (
        <p>
          {fmt(ac.refDetails, {
            amount: refund.amount,
            currency: refund.currency,
            payment: refund.originalPayment,
          })}
          {refund.proofReference && ` · ${fmt(ac.refProof, { reference: refund.proofReference })}`}
        </p>
      )}
      {(!refund || refund.status === 'ready') && (
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border px-3 py-1.5"
          onClick={async () => {
            const ok = await openConfirm({
              title: ac[routeKeys[route]],
              description: ac.refRequestConfirm,
              detail: orderNo,
              confirmLabel: ac.refRequest,
              tone: 'danger',
            });
            if (ok) await execute({ action: 'request' });
          }}
        >
          {ac.refRequest}
        </button>
      )}
      {canQuery && (
        <button
          type="button"
          disabled={busy}
          className="rounded-lg border px-3 py-1.5"
          onClick={() => {
            void execute({ action: 'query' });
          }}
        >
          {ac.refQueryGateway}
        </button>
      )}
      {canConfirm && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void execute({
              action: 'confirm',
              evidence: {
                originalPayment: originalPayment.trim(),
                amount: Number(amount),
                currency: currency.trim().toUpperCase(),
                reference: reference.trim(),
              },
            });
          }}
        >
          <label className="space-y-1">
            <span className="block">{ac.refProofOriginal}</span>
            <input
              className="acct-input"
              value={originalPayment}
              onChange={(event) => setOriginalPayment(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="block">{ac.refAmount}</span>
            <input
              className="acct-input"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="block">{ac.refCurrency}</span>
            <input
              className="acct-input"
              maxLength={4}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="block">{ac.refProofReference}</span>
            <input
              className="acct-input"
              maxLength={128}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy} className="rounded-lg border px-3 py-1.5">
            {ac.refConfirm}
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
