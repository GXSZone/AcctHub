/**
 * AI 商品文案实时试写沙盒与一键回写面板（总控后台右栏）
 */

import { CheckCircle2, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { type AiOptimizeSuggestion, aiApi } from '../../api/ai.api';
import { fmt } from '../../i18n';
import { useAdminAiI18n } from '../../i18n/namespaces/admin-ai';

export interface AdminAiProductSample {
  id: number;
  title: string;
  subtitle: string;
  delivery_type: string;
  base_price: number;
  tags: string[];
  summary_markdown: string;
  detail_markdown: string;
  risk_notice: string;
}

interface AdminAiSandboxProps {
  products: AdminAiProductSample[];
  onAppliedToProduct: () => void;
  showToast: (msg: string) => void;
}

export function AdminAiSandbox({ products, onAppliedToProduct, showToast }: AdminAiSandboxProps) {
  const aai = useAdminAiI18n();
  const [sampleProductId, setSampleProductId] = useState<number>(products[0]?.id || 0);
  const [sampleTone, setSampleTone] = useState<'editorial' | 'conversion' | 'technical'>('editorial');
  const [sampleInstruction, setSampleInstruction] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    productId: number;
    provider: string;
    model: string;
    duration_ms: number;
    suggestion: AiOptimizeSuggestion;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const selectionRevision = useRef(0);
  const selectedProduct = products.find((p) => p.id === sampleProductId);
  const preview = selectedProduct && previewResult?.productId === selectedProduct.id ? previewResult : null;

  useEffect(() => {
    if (!products.some((p) => p.id === sampleProductId) && products.length > 0) {
      setSampleProductId(products[0].id);
    }
  }, [products, sampleProductId]);

  const handleQuickOptimize = async () => {
    const prod = products.find((p) => p.id === sampleProductId);
    if (!prod) return;
    const revision = selectionRevision.current;
    setOptimizing(true);
    setPreviewResult(null);
    try {
      const res = await aiApi.optimizeProduct({
        scope: 'all',
        tone: sampleTone,
        instruction: sampleInstruction.trim() || undefined,
        product: {
          title: prod.title,
          subtitle: prod.subtitle,
          delivery_type: prod.delivery_type,
          base_price: prod.base_price,
          tags: prod.tags,
          summary_markdown: prod.summary_markdown,
          detail_markdown: prod.detail_markdown,
          risk_notice: prod.risk_notice,
        },
      });
      if (revision !== selectionRevision.current) return;
      setPreviewResult({
        productId: prod.id,
        provider: res.provider,
        model: res.model,
        duration_ms: res.duration_ms,
        suggestion: res.suggestion,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : aai.aiSbGenFailErr);
    } finally {
      setOptimizing(false);
    }
  };

  const fields = preview
    ? (
        [
          ['title', aai.aiSbPreviewTitleLabel],
          ['title_en', aai.aiSbPreviewTitleEnLabel],
          ['subtitle', aai.aiSbPreviewSubtitleLabel],
          ['subtitle_en', aai.aiSbPreviewSubtitleEnLabel],
          ['tags', aai.aiSbPreviewTagsLabel],
          ['summary_markdown', aai.aiSbPreviewSummaryLabel],
          ['detail_markdown', aai.aiSbPreviewDetailLabel],
          ['risk_notice', aai.aiSbPreviewRiskLabel],
          ['faq', aai.aiSbPreviewFaqLabel],
        ] as const
      ).flatMap(([key, label]) => {
        const value = preview.suggestion[key];
        return value ? [{ key, label, value }] : [];
      })
    : [];

  const handleApplyPreview = async () => {
    if (!preview || fields.length === 0) return;
    setApplying(true);
    try {
      await adminApi.updateProduct(
        preview.productId,
        Object.fromEntries(fields.map(({ key, value }) => [key, value]))
      );
      showToast(aai.aiSbAppliedToast);
      setPreviewResult(null);
      onAppliedToProduct();
    } catch (err) {
      showToast(err instanceof Error ? err.message : aai.aiSbApplyFailErr);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="lg:col-span-5 paper-card rounded-2xl p-6 space-y-4 text-xs">
      <div className="flex items-center gap-2 pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <Wand2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        <h2 className="font-editorial text-xl font-semibold">{aai.aiSbTitle}</h2>
      </div>

      <p className="leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
        {aai.aiSbSubtitle}
      </p>

      <div className="space-y-3">
        <div>
          <div className="block font-semibold mb-1">{aai.aiSbPickProdLabel}</div>
          <select
            value={sampleProductId}
            onChange={(e) => {
              selectionRevision.current += 1;
              setPreviewResult(null);
              setSampleProductId(Number(e.target.value));
            }}
            disabled={applying}
            className="acct-input"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id} · {p.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="block font-semibold mb-1">{aai.aiSbToneLabel}</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ['editorial', aai.aiSbToneEditorial],
                ['conversion', aai.aiSbToneConversion],
                ['technical', aai.aiSbToneTechnical],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSampleTone(k)}
                className="py-1.5 px-2 rounded-lg border font-medium cursor-pointer text-[11px]"
                style={{
                  borderColor: sampleTone === k ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: sampleTone === k ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                  color: sampleTone === k ? 'var(--accent)' : 'var(--ink-secondary)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="block font-semibold mb-1">{aai.aiSbInstLabel}</div>
          <input
            value={sampleInstruction}
            onChange={(e) => setSampleInstruction(e.target.value)}
            placeholder={aai.aiSbInstPh}
            className="acct-input"
          />
        </div>

        <button
          type="button"
          disabled={optimizing || !sampleProductId}
          onClick={() => void handleQuickOptimize()}
          className="w-full py-2.5 rounded-xl font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--ink-primary)', color: 'var(--bg-canvas)' }}
        >
          {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {optimizing ? aai.aiSbGenLoading : aai.aiSbGenBtn}
        </button>
      </div>

      {preview && (
        <div
          className="p-4 rounded-2xl border space-y-3"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold" style={{ color: 'var(--accent)' }}>
              {fmt(aai.aiSbPreviewReady, {
                model: preview.model,
                ms: preview.duration_ms,
              })}
            </span>
          </div>
          {preview.suggestion.reasoning && (
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {preview.suggestion.reasoning}
            </div>
          )}
          <div className="font-semibold">
            #{selectedProduct?.id} · {selectedProduct?.title}
          </div>
          <dl className="space-y-2">
            {fields.map(({ key, label, value }) => (
              <div key={key}>
                <dt className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                  {label}
                </dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words">
                  {typeof value === 'string'
                    ? value
                    : value.length === 0
                      ? '—'
                      : value.map((entry, index) =>
                          typeof entry === 'string' ? (
                            <div key={`${entry}-${index}`}>{entry}</div>
                          ) : (
                            <div key={`${entry.q}-${index}`}>
                              <strong>{entry.q}</strong>
                              <div>{entry.a}</div>
                            </div>
                          )
                        )}
                </dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            disabled={applying || fields.length === 0}
            onClick={() => void handleApplyPreview()}
            className="w-full py-2 rounded-xl font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {applying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            {aai.aiSbApplyBtn}
          </button>
        </div>
      )}
    </div>
  );
}
