/**
 * 商品售后质保规则配置卡片组件
 */

import { buildWarrantySummaryTemplate } from '@shared/index';
import { ShieldCheck } from 'lucide-react';
import type React from 'react';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import type { WarrantyType } from '../../../types';
import type { EditableProduct } from './product-editor.types';

interface ProductWarrantyBoxProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
}

export function ProductWarrantyBox({ draft, setDraft }: ProductWarrantyBoxProps) {
  const ape = useAdminProductEditorI18n();

  return (
    <div
      className="sm:col-span-2 p-4 rounded-xl border space-y-3"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        {ape.peWarrantyTitle}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--ink-secondary)' }}>
            {ape.peWarrantyTypeLabel}
          </div>
          <select
            value={draft.warranty_type || 'full_period'}
            onChange={(e) => {
              const nextType = e.target.value as WarrantyType;
              let nextDays = 30;
              if (nextType === 'none') nextDays = 0;
              else if (nextType === 'first_login') {
                nextDays =
                  draft.warranty_type === 'first_login' && draft.warranty_days > 0 ? draft.warranty_days : 24;
              } else if (
                draft.warranty_type === 'first_login' ||
                draft.warranty_type === 'none' ||
                draft.warranty_days <= 0
              ) {
                nextDays = nextType === 'days' ? 7 : 30;
              } else {
                nextDays = draft.warranty_days;
              }
              setDraft({
                ...draft,
                warranty_type: nextType,
                warranty_days: nextDays,
                warranty_summary: buildWarrantySummaryTemplate(nextType, nextDays),
              });
            }}
            className="acct-input text-xs"
          >
            <option value="full_period">{ape.peWarrantyFullPeriod}</option>
            <option value="days">{ape.peWarrantyDays}</option>
            <option value="first_login">{ape.peWarrantyFirstLogin}</option>
            <option value="none">{ape.peWarrantyNone}</option>
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--ink-secondary)' }}>
            {draft.warranty_type === 'first_login'
              ? ape.peWarrantyDurFirstLogin
              : draft.warranty_type === 'none'
                ? ape.peWarrantyDurNone
                : ape.peWarrantyDurDays}
          </div>
          <input
            type="number"
            min={draft.warranty_type === 'none' ? 0 : 1}
            max={3650}
            disabled={draft.warranty_type === 'none'}
            value={draft.warranty_type === 'none' ? 0 : draft.warranty_days}
            onChange={(e) => {
              const nextVal = Math.max(0, Number(e.target.value) || 0);
              const currentType = draft.warranty_type || 'full_period';
              const prevAuto = buildWarrantySummaryTemplate(currentType, draft.warranty_days);
              const curSummary = (draft.warranty_summary || '').trim();
              const shouldAutoUpdate = !curSummary || curSummary === prevAuto;
              setDraft({
                ...draft,
                warranty_days: nextVal,
                ...(shouldAutoUpdate && nextVal > 0
                  ? { warranty_summary: buildWarrantySummaryTemplate(currentType, nextVal) }
                  : {}),
              });
            }}
            className="acct-input font-mono-num text-xs disabled:opacity-50"
          />
        </div>
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="block text-[11px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
              {ape.peWarrantySummaryLabel}
            </div>
            {(draft.warranty_summary || '').trim() !==
              buildWarrantySummaryTemplate(draft.warranty_type || 'full_period', draft.warranty_days) && (
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    warranty_summary: buildWarrantySummaryTemplate(
                      draft.warranty_type || 'full_period',
                      draft.warranty_days
                    ),
                  })
                }
                className="text-[11px] font-medium cursor-pointer hover:underline whitespace-nowrap shrink-0"
                style={{ color: 'var(--accent)' }}
              >
                {ape.peWarrantyRegenBtn}
              </button>
            )}
          </div>
          <input
            type="text"
            value={draft.warranty_summary || ''}
            onChange={(e) => setDraft({ ...draft, warranty_summary: e.target.value })}
            placeholder={buildWarrantySummaryTemplate(
              draft.warranty_type || 'full_period',
              draft.warranty_days || (draft.warranty_type === 'first_login' ? 24 : 30)
            )}
            className="acct-input text-xs"
          />
        </div>
      </div>
    </div>
  );
}
