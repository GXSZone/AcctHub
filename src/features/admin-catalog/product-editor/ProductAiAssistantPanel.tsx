/**
 * 商品编辑器内联 AI 文案优化工作台（仅总管理员可见）
 */

import { CheckCircle2, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { useState } from 'react';
import { type AiOptimizeSuggestion, aiApi } from '../../../api/ai.api';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import type { EditableProduct } from './product-editor.types';

interface ProductAiAssistantPanelProps {
  draft: EditableProduct;
  tagsText: string;
  categories: Array<{ id: number; name: string }>;
  onClose: () => void;
  onApply: (nextDraft: EditableProduct, nextTagsText: string, appliedCount: number) => void;
}

export function ProductAiAssistantPanel({
  draft,
  tagsText,
  categories,
  onClose,
  onApply,
}: ProductAiAssistantPanelProps) {
  const ape = useAdminProductEditorI18n();
  const [aiScope, setAiScope] = useState<'all' | 'titles' | 'detail' | 'faq'>('all');
  const [aiTone, setAiTone] = useState<'editorial' | 'conversion' | 'technical'>('editorial');
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState<{
    model: string;
    duration_ms: number;
    data: AiOptimizeSuggestion;
  } | null>(null);
  const [aiSelectedFields, setAiSelectedFields] = useState<Record<string, boolean>>({});

  const runAiOptimize = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const catName = categories.find((c) => c.id === draft.category_id)?.name;
      const parsedTags = tagsText
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      const res = await aiApi.optimizeProduct({
        scope: aiScope,
        tone: aiTone,
        instruction: aiInstruction.trim() || undefined,
        product: {
          title: draft.title || ape.peAiDefaultProdTitle,
          title_en: draft.title_en,
          subtitle: draft.subtitle,
          subtitle_en: draft.subtitle_en,
          category_name: catName,
          delivery_type: draft.delivery_type,
          base_price: draft.base_price,
          tags: parsedTags,
          summary_markdown: draft.summary_markdown,
          detail_markdown: draft.detail_markdown,
          risk_notice: draft.risk_notice,
          faq: draft.faq,
        },
      });
      const s = res.suggestion;
      const defaults: Record<string, boolean> = {};
      if (s.title) defaults.title = true;
      if (s.subtitle) defaults.subtitle = true;
      if (s.tags && s.tags.length > 0) defaults.tags = true;
      if (s.summary_markdown) defaults.summary_markdown = true;
      if (s.detail_markdown) defaults.detail_markdown = true;
      if (s.risk_notice) defaults.risk_notice = true;
      if (s.faq && s.faq.length > 0) defaults.faq = true;
      setAiSelectedFields(defaults);
      setAiSuggestion({ model: res.model, duration_ms: res.duration_ms, data: s });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : ape.peAiFailErr);
    } finally {
      setAiLoading(false);
    }
  };

  const applySelectedAiFields = () => {
    if (!aiSuggestion) return;
    const s = aiSuggestion.data;
    const next = { ...draft };
    let nextTags = tagsText;
    let appliedCount = 0;

    if (aiSelectedFields.title && s.title) {
      next.title = s.title;
      if (s.title_en) next.title_en = s.title_en;
      appliedCount++;
    }
    if (aiSelectedFields.subtitle && s.subtitle) {
      next.subtitle = s.subtitle;
      if (s.subtitle_en) next.subtitle_en = s.subtitle_en;
      appliedCount++;
    }
    if (aiSelectedFields.tags && s.tags) {
      next.tags = s.tags;
      nextTags = s.tags.join(', ');
      appliedCount++;
    }
    if (aiSelectedFields.summary_markdown && s.summary_markdown) {
      next.summary_markdown = s.summary_markdown;
      appliedCount++;
    }
    if (aiSelectedFields.detail_markdown && s.detail_markdown) {
      next.detail_markdown = s.detail_markdown;
      appliedCount++;
    }
    if (aiSelectedFields.risk_notice && s.risk_notice) {
      next.risk_notice = s.risk_notice;
      appliedCount++;
    }
    if (aiSelectedFields.faq && s.faq) {
      next.faq = s.faq;
      appliedCount++;
    }

    setAiSuggestion(null);
    onApply(next, nextTags, appliedCount);
  };

  return (
    <div
      className="p-4 rounded-2xl border space-y-3.5 text-xs"
      style={{
        borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--border-color))',
        backgroundColor: 'var(--bg-canvas)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--accent)' }}>
          <Wand2 className="w-4 h-4" />
          {ape.peAiTitle}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded cursor-pointer"
          style={{ color: 'var(--ink-muted)' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="block text-[11px] font-semibold mb-1">{ape.peAiScopeLabel}</div>
          <select
            value={aiScope}
            onChange={(e) => setAiScope(e.target.value as 'all' | 'titles' | 'detail' | 'faq')}
            className="acct-input py-1.5 text-xs"
          >
            <option value="all">{ape.peAiScopeAll}</option>
            <option value="titles">{ape.peAiScopeTitles}</option>
            <option value="detail">{ape.peAiScopeDetail}</option>
            <option value="faq">{ape.peAiScopeFaq}</option>
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{ape.peAiToneLabel}</div>
          <select
            value={aiTone}
            onChange={(e) => setAiTone(e.target.value as 'editorial' | 'conversion' | 'technical')}
            className="acct-input py-1.5 text-xs"
          >
            <option value="editorial">{ape.peAiToneEditorial}</option>
            <option value="conversion">{ape.peAiToneConversion}</option>
            <option value="technical">{ape.peAiToneTechnical}</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={aiInstruction}
          onChange={(e) => setAiInstruction(e.target.value)}
          placeholder={ape.peAiInstructionPh}
          className="acct-input py-1.5 text-xs flex-1"
        />
        <button
          type="button"
          disabled={aiLoading}
          onClick={() => void runAiOptimize()}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {aiLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {aiLoading ? ape.peAiGenerating : ape.peAiGenerateBtn}
        </button>
      </div>

      {aiError && (
        <div
          className="p-2.5 rounded-xl text-[11.5px]"
          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          {aiError}
        </div>
      )}

      {aiSuggestion && (
        <div
          className="p-3.5 rounded-xl border space-y-2.5"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold" style={{ color: 'var(--success)' }}>
              {fmt(ape.peAiReadyHeadline, {
                model: aiSuggestion.model,
                ms: aiSuggestion.duration_ms,
              })}
            </span>
          </div>
          {aiSuggestion.data.reasoning && (
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {aiSuggestion.data.reasoning}
            </p>
          )}

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {(
              [
                ['title', ape.peAiFieldTitle, aiSuggestion.data.title],
                ['subtitle', ape.peAiFieldSubtitle, aiSuggestion.data.subtitle],
                ['summary_markdown', ape.peAiFieldSummary, aiSuggestion.data.summary_markdown],
                [
                  'detail_markdown',
                  ape.peAiFieldDetail,
                  aiSuggestion.data.detail_markdown?.replace(/<[^>]+>/g, ' '),
                ],
                ['risk_notice', ape.peAiFieldRisk, aiSuggestion.data.risk_notice],
              ] as const
            ).map(
              ([fieldKey, label, text]) =>
                text && (
                  <label
                    key={fieldKey}
                    className="flex items-start gap-2 p-2 rounded-lg border cursor-pointer"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(aiSelectedFields[fieldKey])}
                      onChange={(e) => setAiSelectedFields((p) => ({ ...p, [fieldKey]: e.target.checked }))}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {label}
                      </div>
                      <div className="mt-0.5 leading-relaxed line-clamp-3">{text}</div>
                    </div>
                  </label>
                )
            )}
            {aiSuggestion.data.tags && aiSuggestion.data.tags.length > 0 && (
              <label
                className="flex items-start gap-2 p-2 rounded-lg border cursor-pointer"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(aiSelectedFields.tags)}
                  onChange={(e) => setAiSelectedFields((p) => ({ ...p, tags: e.target.checked }))}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {ape.peAiFieldTags}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {aiSuggestion.data.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded text-[10.5px]"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </label>
            )}
            {aiSuggestion.data.faq && aiSuggestion.data.faq.length > 0 && (
              <label
                className="flex items-start gap-2 p-2 rounded-lg border cursor-pointer"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(aiSelectedFields.faq)}
                  onChange={(e) => setAiSelectedFields((p) => ({ ...p, faq: e.target.checked }))}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {fmt(ape.peAiFieldFaq, { count: aiSuggestion.data.faq.length })}
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                    {aiSuggestion.data.faq.map((f) => f.q).join(' · ')}
                  </div>
                </div>
              </label>
            )}
          </div>

          <div
            className="flex items-center justify-end gap-2 pt-2 border-t"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <button
              type="button"
              onClick={() => setAiSuggestion(null)}
              className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
              style={{ borderColor: 'var(--border-strong)' }}
            >
              {ape.peAiDiscardBtn}
            </button>
            <button
              type="button"
              onClick={applySelectedAiFields}
              className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {ape.peAiApplyBtn}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
