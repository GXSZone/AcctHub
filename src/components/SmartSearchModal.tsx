import { ArrowRight, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storefrontApi } from '../api/storefront.api';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';
import type { Product } from '../types';
import { BrandBadge } from './BrandIcon';

interface SmartSearchModalProps {
  open: boolean;
  onClose: () => void;
}

export function SmartSearchModal({ open, onClose }: SmartSearchModalProps) {
  const m = useCommonModalsI18n();
  const presets = [m.srchPreset1, m.srchPreset2, m.srchPreset3, m.srchPreset4];
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [reasoning, setReasoning] = useState('');
  const [items, setItems] = useState<Product[]>([]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 40);
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const runMatch = async (q: string) => {
    const text = q.trim();
    if (!text) return;
    setPrompt(text);
    setLoading(true);
    try {
      const res = await storefrontApi.conciergeMatch(text);
      setReasoning(res.reasoning);
      setItems(res.items);
    } catch {
      setReasoning(m.srchOfflineErr);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="smart-search-title"
      className="acct-dialog acct-dialog-wide"
    >
      <div className="p-5 sm:p-6">
        <div
          className="flex items-center justify-between gap-3 pb-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 id="smart-search-title" className="font-editorial text-lg font-semibold">
              {m.srchTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={m.srchCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runMatch(prompt);
          }}
          className="mt-4"
        >
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="search"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={m.srchPlaceholder}
              className="acct-input flex-1"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-xl text-sm font-medium shrink-0 cursor-pointer inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {m.srchSubmitBtn}
            </button>
          </div>
        </form>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => void runMatch(preset)}
              className="text-xs px-3 py-1.5 rounded-full border cursor-pointer transition-colors"
              style={{
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--bg-canvas)',
                color: 'var(--ink-secondary)',
              }}
            >
              {preset}
            </button>
          ))}
        </div>

        {reasoning && (
          <div
            className="mt-4 p-3.5 rounded-xl text-xs leading-relaxed"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--ink-primary)' }}
          >
            {reasoning}
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 space-y-2 max-h-[340px] overflow-y-auto pr-1">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  handleClose();
                  navigate(`/item/${item.id}`);
                }}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left cursor-pointer transition-colors"
                style={{
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--bg-canvas)',
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <BrandBadge icon={item.icon_key} accentColor={item.accent_color} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{item.title}</div>
                    <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono-num font-semibold text-sm">¥{item.price}</span>
                  <ArrowRight className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
