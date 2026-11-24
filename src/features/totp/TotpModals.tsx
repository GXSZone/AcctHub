/**
 * 2FA 二维码放大弹窗与批量密钥解析导入弹窗
 */

import { Loader2, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef } from 'react';
import { useTotpI18n } from '../../i18n/namespaces/totp';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../lib/uiHelpers';

interface TotpModalsProps {
  qrZoomOpen: boolean;
  qrDataUrl: string;
  issuer: string;
  accountName: string;
  onCloseQrZoom: () => void;
  batchOpen: boolean;
  batchText: string;
  batchImporting: boolean;
  batchError: string;
  onBatchTextChange: (v: string) => void;
  onBatchSubmit: (e: React.FormEvent) => void;
  onCloseBatch: () => void;
}

export function TotpModals({
  qrZoomOpen,
  qrDataUrl,
  issuer,
  accountName,
  onCloseQrZoom,
  batchOpen,
  batchText,
  batchImporting,
  batchError,
  onBatchTextChange,
  onBatchSubmit,
  onCloseBatch,
}: TotpModalsProps) {
  const tp = useTotpI18n();
  const zoomDialogRef = useRef<HTMLDialogElement>(null);
  const batchDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = zoomDialogRef.current;
    if (!dlg) return;
    if (qrZoomOpen && !dlg.open) dlg.showModal();
    else if (!qrZoomOpen && dlg.open) void closeDialogSmoothly(dlg);
  }, [qrZoomOpen]);

  useEffect(() => {
    const dlg = zoomDialogRef.current;
    if (!dlg) return;
    return attachDialogLightDismissFallback(dlg, onCloseQrZoom);
  }, [onCloseQrZoom]);

  useEffect(() => {
    const dlg = batchDialogRef.current;
    if (!dlg) return;
    if (batchOpen && !dlg.open) dlg.showModal();
    else if (!batchOpen && dlg.open) void closeDialogSmoothly(dlg);
  }, [batchOpen]);

  useEffect(() => {
    const dlg = batchDialogRef.current;
    if (!dlg) return;
    return attachDialogLightDismissFallback(dlg, onCloseBatch);
  }, [onCloseBatch]);

  return (
    <>
      <dialog
        ref={zoomDialogRef}
        {...({ closedby: 'any' } as Record<string, string>)}
        className="acct-dialog"
        aria-label={tp.modalZoomAria}
      >
        <div className="p-6 text-center space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-editorial text-lg font-semibold">{tp.modalZoomTitle}</h3>
            <button
              type="button"
              onClick={() => void closeDialogSmoothly(zoomDialogRef.current).then(onCloseQrZoom)}
              className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={tp.modalZoomAlt}
              className="w-64 h-64 mx-auto rounded-2xl border p-2 bg-white"
            />
          )}
          <div className="text-xs font-mono-num" style={{ color: 'var(--ink-secondary)' }}>
            {issuer} · {accountName}
          </div>
        </div>
      </dialog>

      <dialog
        ref={batchDialogRef}
        {...({ closedby: 'any' } as Record<string, string>)}
        className="acct-dialog"
        aria-label={tp.modalBatchAria}
      >
        <form onSubmit={onBatchSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-editorial text-xl font-semibold">{tp.modalBatchTitle}</h3>
            <button
              type="button"
              onClick={() => void closeDialogSmoothly(batchDialogRef.current).then(onCloseBatch)}
              className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {tp.modalBatchDescPrefix}
            {tp.modalBatchDescFormat1}
            {tp.modalBatchDescMid}
            {tp.modalBatchDescFormat2}
            {tp.modalBatchDescSuffix}
          </p>
          <textarea
            rows={7}
            required
            value={batchText}
            onChange={(e) => onBatchTextChange(e.target.value)}
            placeholder={`Claude----alice@gmail.com----JBSWY3DPEHPK3PXP\notpauth://totp/OpenAI:bob@gmail.com?secret=NB2W45DFOIZA`}
            className="acct-input font-mono-num text-xs"
          />
          {batchError && (
            <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
              {batchError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void closeDialogSmoothly(batchDialogRef.current).then(onCloseBatch)}
              className="px-4 py-2 rounded-xl border text-xs cursor-pointer"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {tp.cancelBtn}
            </button>
            <button
              type="submit"
              disabled={batchImporting}
              className="px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {batchImporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tp.modalBatchSubmitBtn}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
