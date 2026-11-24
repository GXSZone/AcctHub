/**
 * 商品图文详情、购前风控须知、自定义下单收集字段与常见问题 FAQ 编辑分区
 */

import { Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { RichTextEditor } from '../../../components/editor/RichTextEditor';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import type { EditableProduct } from './product-editor.types';

interface ProductContentSectionProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
}

export function ProductContentSection({ draft, setDraft }: ProductContentSectionProps) {
  const ape = useAdminProductEditorI18n();
  return (
    <div className="space-y-4">
      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peRiskNoticeLabel}</div>
        <textarea
          rows={3}
          value={draft.risk_notice}
          onChange={(e) => setDraft({ ...draft, risk_notice: e.target.value })}
          placeholder={ape.peRiskNoticePh}
          className="acct-input"
        />
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peSummaryLabel}</div>
        <textarea
          rows={2}
          value={draft.summary_markdown}
          onChange={(e) => setDraft({ ...draft, summary_markdown: e.target.value })}
          placeholder={ape.peSummaryPh}
          className="acct-input"
        />
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1.5">{ape.peDetailLabel}</div>
        <RichTextEditor
          value={draft.detail_markdown}
          onChange={(html) => setDraft({ ...draft, detail_markdown: html })}
          minHeight={300}
        />
      </div>
    </div>
  );
}

export function ProductFormsFaqSection({ draft, setDraft }: ProductContentSectionProps) {
  const ape = useAdminProductEditorI18n();
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">{ape.peCustomFieldsTitle}</div>
            <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {ape.peCustomFieldsDesc}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                custom_fields: [
                  ...draft.custom_fields,
                  {
                    key: `field_${Date.now().toString(36)}`,
                    label: ape.peCustomDefaultLabel,
                    placeholder: 'name@example.com',
                    required: false,
                    type: 'text',
                  },
                ],
              })
            }
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer border"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {ape.peAddFieldBtn}
          </button>
        </div>

        {draft.custom_fields.map((cf, idx) => (
          <div
            key={cf.key + idx}
            className="p-3.5 rounded-xl border grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <input
              placeholder={ape.peFieldLabelPh}
              value={cf.label}
              onChange={(e) => {
                const next = [...draft.custom_fields];
                next[idx] = { ...cf, label: e.target.value };
                setDraft({ ...draft, custom_fields: next });
              }}
              className="acct-input sm:col-span-5"
            />
            <input
              placeholder={ape.peFieldPlaceholderPh}
              value={cf.placeholder || ''}
              onChange={(e) => {
                const next = [...draft.custom_fields];
                next[idx] = { ...cf, placeholder: e.target.value };
                setDraft({ ...draft, custom_fields: next });
              }}
              className="acct-input sm:col-span-4"
            />
            <label className="sm:col-span-2 inline-flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={Boolean(cf.required)}
                onChange={(e) => {
                  const next = [...draft.custom_fields];
                  next[idx] = { ...cf, required: e.target.checked };
                  setDraft({ ...draft, custom_fields: next });
                }}
              />
              {ape.peFieldRequired}
            </label>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  custom_fields: draft.custom_fields.filter((_, i) => i !== idx),
                })
              }
              className="sm:col-span-1 p-1.5 cursor-pointer justify-self-end"
              style={{ color: 'var(--danger)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold">{ape.peFaqTitle}</div>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                faq: [...draft.faq, { q: ape.peFaqDefaultQ, a: ape.peFaqDefaultA }],
              })
            }
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer border"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {ape.peAddFaqBtn}
          </button>
        </div>

        {draft.faq.map((f, idx) => (
          <div
            key={idx}
            className="p-3.5 rounded-xl border space-y-2"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div className="flex items-center gap-2">
              <input
                placeholder={ape.peFaqQPh}
                value={f.q}
                onChange={(e) => {
                  const next = [...draft.faq];
                  next[idx] = { ...f, q: e.target.value };
                  setDraft({ ...draft, faq: next });
                }}
                className="acct-input flex-1"
              />
              <button
                type="button"
                onClick={() => setDraft({ ...draft, faq: draft.faq.filter((_, i) => i !== idx) })}
                className="p-1.5 cursor-pointer"
                style={{ color: 'var(--danger)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={2}
              placeholder={ape.peFaqAPh}
              value={f.a}
              onChange={(e) => {
                const next = [...draft.faq];
                next[idx] = { ...f, a: e.target.value };
                setDraft({ ...draft, faq: next });
              }}
              className="acct-input text-xs"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
