import { Check, Megaphone, Sparkles, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';
import { RichContentRenderer } from './RichContentRenderer';

interface WelcomePopupModalProps {
  open: boolean;
  title: string;
  content: string;
  badge?: string;
  showDismissToday?: boolean;
  onClose: () => void;
  onDismissToday?: () => void;
}

export function WelcomePopupModal({
  open,
  title,
  content,
  badge,
  showDismissToday = true,
  onClose,
  onDismissToday,
}: WelcomePopupModalProps) {
  const m = useCommonModalsI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  const handleDismissToday = () => {
    void closeDialogSmoothly(dialogRef.current).then(() => {
      onDismissToday?.();
      onClose();
    });
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="welcome-popup-title"
      className="acct-dialog acct-dialog-wide"
    >
      <div className="p-6 sm:p-7 space-y-5">
        <div
          className="flex items-start justify-between gap-3 pb-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full mb-2"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Megaphone className="w-3 h-3" />
              {badge || m.ntcPopupBadgeDefault}
            </span>
            <h2 id="welcome-popup-title" className="font-editorial text-2xl font-semibold leading-snug">
              {title || m.ntcDrawerTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={m.ntcPopupCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[54vh] overflow-y-auto pr-1">
          <RichContentRenderer content={content} />
        </div>

        <div
          className="pt-4 border-t flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-color)' }}
        >
          {showDismissToday && onDismissToday ? (
            <button
              type="button"
              onClick={handleDismissToday}
              className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer underline underline-offset-4"
              style={{ color: 'var(--ink-muted)' }}
            >
              <Check className="w-3.5 h-3.5" />
              {m.ntcDismissToday}
            </button>
          ) : (
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {m.ntcEscHint}
            </span>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {m.ntcConfirmExplore}
          </button>
        </div>
      </div>
    </dialog>
  );
}
