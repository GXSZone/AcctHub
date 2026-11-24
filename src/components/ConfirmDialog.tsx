import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';

export interface ConfirmOptions {
  title: string;
  description: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'accent';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
}

type ConfirmListener = (req: PendingConfirm | null) => void;
let activeListener: ConfirmListener | null = null;

/**
 * Open a Claude-editorial styled confirmation dialog anywhere in the app.
 * Replaces native browser window.confirm() with a themed native <dialog>.
 */
export function openConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (!activeListener) {
      resolve(false);
      return;
    }
    activeListener({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  useEffect(() => {
    activeListener = (req) => setPending(req);
    return () => {
      activeListener = null;
    };
  }, []);

  const settle = useCallback((accepted: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    void closeDialogSmoothly(dialogRef.current).then(() => {
      setPending(null);
      current.resolve(accepted);
    });
  }, []);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (pending) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
    return attachDialogLightDismissFallback(dlg, () => settle(false));
  }, [pending, settle]);

  const m = useCommonModalsI18n();
  const isDanger = (pending?.tone ?? 'danger') === 'danger';

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="acct-confirm-title"
      aria-describedby="acct-confirm-desc"
      className="acct-dialog"
      style={{ maxWidth: 'min(92vw, 27rem)' }}
    >
      {pending && (
        <div className="p-6 space-y-5">
          <div className="flex items-start gap-3.5">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: isDanger ? 'var(--danger-soft)' : 'var(--accent-soft)',
                color: isDanger ? 'var(--danger)' : 'var(--accent)',
              }}
            >
              {isDanger ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-start justify-between gap-2">
                <h2
                  id="acct-confirm-title"
                  className="font-editorial text-lg font-semibold leading-snug"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {pending.title}
                </h2>
                <button
                  type="button"
                  onClick={() => settle(false)}
                  className="w-7 h-7 -mt-1 -mr-1 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0"
                  style={{ color: 'var(--ink-muted)' }}
                  aria-label={m.dlgCloseAria}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p
                id="acct-confirm-desc"
                className="text-xs mt-1.5 leading-relaxed"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {pending.description}
              </p>
            </div>
          </div>

          {pending.detail && (
            <div
              className="px-3.5 py-2.5 rounded-xl border text-[11.5px] font-mono-num leading-relaxed"
              style={{
                backgroundColor: 'var(--bg-canvas)',
                borderColor: 'var(--border-color)',
                color: 'var(--ink-secondary)',
              }}
            >
              {pending.detail}
            </div>
          )}

          <div
            className="pt-3 border-t flex items-center justify-end gap-2"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <button
              type="button"
              onClick={() => settle(false)}
              className="px-4 py-2 rounded-xl border text-xs font-medium cursor-pointer transition-colors"
              style={{
                borderColor: 'var(--border-strong)',
                backgroundColor: 'var(--bg-canvas)',
                color: 'var(--ink-primary)',
              }}
            >
              {pending.cancelLabel || m.dlgDefaultCancel}
            </button>
            <button
              type="button"
              onClick={() => settle(true)}
              className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-opacity hover:opacity-90"
              style={{
                backgroundColor: isDanger ? 'var(--danger)' : 'var(--accent)',
                color: '#FAF9F5',
              }}
            >
              {pending.confirmLabel || m.dlgDefaultConfirm}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
