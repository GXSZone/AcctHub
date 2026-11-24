import { Check, Copy, Download, KeyRound, Loader2, Plus, Repeat, Trash2, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/admin.api';
import { adminRiskApi } from '../api/admin-risk.api';
import { fmt } from '../i18n';
import { useAdminCatalogI18n } from '../i18n/namespaces/admin-catalog';
import { useRiskControlI18n } from '../i18n/namespaces/risk-control';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';

interface CardVaultModalProps {
  open: boolean;
  product: { id: number; title: string; specs: Array<{ id: string; name: string }> } | null;
  onClose: () => void;
  onChanged: () => void;
}

export function CardVaultModal({ open, product, onClose, onChanged }: CardVaultModalProps) {
  const act = useAdminCatalogI18n();
  const rf = useRiskControlI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [specId, setSpecId] = useState('default');
  const [lines, setLines] = useState('');
  const [dedupe, setDedupe] = useState(true);
  const [isLoop, setIsLoop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState('');
  const [cards, setCards] = useState<
    Array<{
      id: number;
      spec_id: string;
      card_content: string;
      status: string;
      is_loop?: number;
      order_no: string | null;
      created_at: string;
    }>
  >([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const loadCards = useCallback(async (pid: number) => {
    setLoading(true);
    try {
      const res = await adminApi.listCards(pid);
      setCards(res.cards);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && product && !dialog.open) {
      setSpecId(product.specs?.[0]?.id || 'default');
      setLines('');
      setImportFeedback('');
      dialog.showModal();
      void loadCards(product.id);
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open, product, loadCards]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !lines.trim()) return;
    setImporting(true);
    try {
      const result = await adminApi.importCards(product.id, specId, lines, { is_loop: isLoop, dedupe });
      setImportFeedback(
        fmt(act.cvImportResult, {
          imported: result.imported,
          duplicates: result.duplicates,
          samples: result.rejected_samples,
        })
      );
      setLines('');
      await loadCards(product.id);
      onChanged();
    } finally {
      setImporting(false);
    }
  };

  const availableCount = cards.filter((c) => c.status === 'available').length;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="card-vault-title"
      className="acct-dialog acct-dialog-wide"
    >
      <div className="p-6 space-y-5 max-h-[86vh] flex flex-col">
        <div
          className="flex items-start justify-between gap-3 pb-4 border-b shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
              <KeyRound className="w-4 h-4" />
              {fmt(act.cvHeaderCount, { available: availableCount, total: cards.length })}
            </div>
            <h2 id="card-vault-title" className="font-editorial text-xl font-semibold mt-0.5">
              {product?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={act.cvCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Batch Import Form */}
        <form onSubmit={handleImport} className="space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">{act.cvSpecLabel}</span>
              <select
                value={specId}
                onChange={(e) => setSpecId(e.target.value)}
                className="acct-input py-1.5 text-xs w-auto"
              >
                {(product?.specs?.length
                  ? product.specs
                  : [{ id: 'default', name: act.cvDefaultSpecName }]
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {product && availableCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const blob = await adminRiskApi.exportCardsTxt(product.id, specId);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `product-${product.id}-${specId}-cards.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                  setImportFeedback(rf.cardExportDoneToast);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <Download className="w-3.5 h-3.5" />
                {rf.cardExportTxtBtn}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} />
              <span>{rf.cardDedupeLabel}</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={isLoop} onChange={(e) => setIsLoop(e.target.checked)} />
              <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>{rf.cardLoopLabel}</span>
            </label>
          </div>

          <textarea
            rows={4}
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            placeholder={act.cvTextareaPlaceholder}
            className="acct-input font-mono-num text-xs"
          />

          <button
            type="submit"
            disabled={importing || !lines.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {act.cvImportBtn}
          </button>
          {importFeedback && (
            <p role="status" className="text-xs">
              {importFeedback}
            </p>
          )}
        </form>

        {/* Live Card List */}
        <div
          className="border-t pt-4 overflow-y-auto flex-1 min-h-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="text-xs font-semibold mb-2">{act.cvListTitle}</div>
          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
              {act.cvEmpty}
            </p>
          ) : (
            <div className="space-y-1.5">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs"
                  style={{
                    borderColor: 'var(--border-color)',
                    backgroundColor: card.status === 'available' ? 'var(--bg-canvas)' : 'var(--bg-subtle)',
                    opacity: card.status === 'available' ? 1 : 0.72,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{
                          backgroundColor:
                            card.status === 'available' ? 'var(--success-soft)' : 'var(--bg-surface)',
                          color: card.status === 'available' ? 'var(--success)' : 'var(--ink-muted)',
                        }}
                      >
                        {card.status === 'available'
                          ? act.cvStatusAvailable
                          : fmt(act.cvStatusSold, { orderNo: card.order_no || '' })}
                      </span>
                      <span className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(act.cvSpecTag, { specId: card.spec_id })}
                      </span>
                      {Number(card.is_loop || 0) === 1 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium inline-flex items-center gap-0.5"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          <Repeat className="w-2.5 h-2.5" />
                          {rf.cardLoopBadge}
                        </span>
                      )}
                    </div>
                    <div className="font-mono-num text-[11.5px] truncate">{card.card_content}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(card.card_content);
                        setCopiedId(card.id);
                        setTimeout(() => setCopiedId(null), 1400);
                      }}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--ink-secondary)' }}
                      aria-label={act.cvCopyAria}
                    >
                      {copiedId === card.id ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.deleteCard(card.id);
                        if (product) await loadCards(product.id);
                        onChanged();
                      }}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--danger)' }}
                      aria-label={act.cvDeleteAria}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
