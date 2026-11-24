/**
 * 商品前台实时预览右侧规格选择与下单示意卡片
 */

import { ShoppingBag } from 'lucide-react';
import { fmt } from '../../i18n';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';
import type { ProductCustomField } from '../../types';
import type { ProductPreviewSpecItem } from './ProductPreviewView';

interface ProductPreviewAsideProps {
  priceHeaderLabel: string;
  displayPrice: number;
  displayOriginalPrice: number | null;
  specs: ProductPreviewSpecItem[];
  activeSpecId?: string;
  onSelectSpec: (specId: string) => void;
  customFields: ProductCustomField[];
}

export function ProductPreviewAside({
  priceHeaderLabel,
  displayPrice,
  displayOriginalPrice,
  specs,
  activeSpecId,
  onSelectSpec,
  customFields,
}: ProductPreviewAsideProps) {
  const ui = useUiKitI18n();
  const activeSpec = specs.find((s) => s.id === activeSpecId) || specs[0];

  return (
    <aside className="lg:col-span-5 xl:col-span-4 paper-card rounded-2xl p-5 space-y-4 lg:sticky lg:top-2">
      <div
        className="flex items-baseline justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {priceHeaderLabel}
          </div>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-3xl font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
              ¥{displayPrice.toFixed(2)}
            </span>
            {displayOriginalPrice && displayOriginalPrice > displayPrice && (
              <span className="text-xs font-mono-num line-through" style={{ color: 'var(--ink-muted)' }}>
                ¥{displayOriginalPrice.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <span
          className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
          style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
        >
          {ui.previewCustomerViewBadge}
        </span>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold">{ui.previewSelectSpecLabel}</div>
        <div className="space-y-2">
          {specs.map((s) => {
            const selected = activeSpec?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSpec(s.id)}
                className="w-full p-3 rounded-xl border text-left cursor-pointer transition-colors flex items-center justify-between gap-2"
                style={{
                  borderColor: selected ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: selected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold truncate">{s.name}</span>
                    {s.badge && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                      >
                        {s.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5 font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {fmt(ui.previewSpecStock, { stock: s.stock })}
                    {s.description ? ` · ${s.description}` : ''}
                  </div>
                </div>
                <div
                  className="text-sm font-mono-num font-bold shrink-0"
                  style={{ color: selected ? 'var(--accent)' : 'var(--ink-primary)' }}
                >
                  ¥{Number(s.price || 0).toFixed(2)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {customFields.length > 0 && (
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <div className="text-xs font-semibold">{ui.previewCustomFieldsLabel}</div>
          {customFields.map((cf) => (
            <div key={cf.key}>
              <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                {cf.label} {cf.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
              </div>
              <div
                className="h-9 px-3 rounded-xl border flex items-center text-xs truncate"
                style={{
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--bg-canvas)',
                  color: 'var(--ink-muted)',
                }}
              >
                {cf.placeholder || fmt(ui.previewCustomFieldPh, { label: cf.label })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2.5 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div>
          <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ui.previewEmailLabel}
          </div>
          <div
            className="h-9 px-3 rounded-xl border flex items-center text-xs"
            style={{
              borderColor: 'var(--border-color)',
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--ink-muted)',
            }}
          >
            buyer@example.com
          </div>
        </div>

        <button
          type="button"
          disabled
          className="w-full py-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 opacity-80 cursor-not-allowed"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <ShoppingBag className="w-4 h-4" />
          {fmt(ui.previewPayNowBtn, { price: displayPrice.toFixed(2) })}
        </button>
      </div>
    </aside>
  );
}
