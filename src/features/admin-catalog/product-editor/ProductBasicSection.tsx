/**
 * 商品基础信息、品牌图标、价格成本防亏与售后质保配置分区
 */

import { discountDisplay } from '@shared/domain/money';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import type React from 'react';
import { BrandBadge, buildBrandIconOptions, resolveBrandTint } from '../../../components/BrandIcon';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import { useRiskControlI18n } from '../../../i18n/namespaces/risk-control';
import { useUiKitI18n } from '../../../i18n/namespaces/ui-kit';
import { ProductWarrantyBox } from './ProductWarrantyBox';
import type { EditableProduct, ProductMarginCheck } from './product-editor.types';

interface ProductBasicSectionProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
  tagsText: string;
  setTagsText: (v: string) => void;
  categories: Array<{ id: number; name: string }>;
  lowestTier: { name: string; discount_rate: number };
  marginCheck: ProductMarginCheck;
}

export function ProductBasicSection({
  draft,
  setDraft,
  tagsText,
  setTagsText,
  categories,
  lowestTier,
  marginCheck,
}: ProductBasicSectionProps) {
  const ape = useAdminProductEditorI18n();
  const rf = useRiskControlI18n();
  const ui = useUiKitI18n();
  const brandIconOptions = buildBrandIconOptions(ui);
  const tierDisplay = { tierName: lowestTier.name, ...discountDisplay(lowestTier.discount_rate) };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2">
        <div className="block text-xs font-semibold mb-1">{ape.peTitleLabel}</div>
        <input
          required
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder={ape.peTitlePlaceholder}
          className="acct-input"
        />
      </div>

      <div className="sm:col-span-2">
        <div className="block text-xs font-semibold mb-1">{ape.peSubtitleLabel}</div>
        <input
          value={draft.subtitle}
          onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
          placeholder={ape.peSubtitlePlaceholder}
          className="acct-input"
        />
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peCatLabel}</div>
        <select
          value={draft.category_id}
          onChange={(e) => setDraft({ ...draft, category_id: Number(e.target.value) })}
          className="acct-input"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peSortLabel}</div>
        <input
          type="number"
          value={draft.sort_order}
          onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
          className="acct-input font-mono-num"
        />
      </div>

      <div className="sm:col-span-2">
        <div className="block text-xs font-semibold mb-1.5">{ape.peIconLabel}</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {brandIconOptions.map((opt) => {
            const selected =
              draft.icon_key === opt.key ||
              (draft.icon_key === 'terminal' && opt.key === 'cursor') ||
              (draft.icon_key === 'palette' && opt.key === 'midjourney') ||
              (draft.icon_key === 'play' && opt.key === 'netflix') ||
              (draft.icon_key === 'globe' && opt.key === 'gmail');
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() =>
                  setDraft({ ...draft, icon_key: opt.key, accent_color: resolveBrandTint(opt.key) })
                }
                className="flex items-center gap-2 p-2 rounded-xl border text-left cursor-pointer transition-colors"
                style={{
                  borderColor: selected ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: selected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                }}
              >
                <BrandBadge icon={opt.key} size="sm" />
                <span className="text-[11px] font-medium truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peBasePriceLabel}</div>
        <input
          type="number"
          step="0.01"
          required
          value={draft.base_price}
          onChange={(e) => setDraft({ ...draft, base_price: Number(e.target.value) })}
          className="acct-input font-mono-num"
          style={{ borderColor: marginCheck.baseLoss > 0 ? 'var(--danger)' : undefined }}
        />
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peCostLabel}</div>
        <input
          type="number"
          step="0.01"
          min="0"
          value={draft.cost_price ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, cost_price: e.target.value === '' ? null : Number(e.target.value) })
          }
          placeholder={ape.peCostPlaceholder}
          className="acct-input font-mono-num"
        />
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peOrigPriceLabel}</div>
        <input
          type="number"
          step="0.01"
          value={draft.original_price ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, original_price: e.target.value === '' ? null : Number(e.target.value) })
          }
          className="acct-input font-mono-num"
        />
      </div>

      <div className="flex items-end">
        <div
          className="w-full text-[11px] px-3 py-2.5 rounded-xl leading-snug"
          style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-muted)' }}
        >
          {fmt(ape.peLowestAgentFloor, tierDisplay)}
          <strong className="font-mono-num ml-1" style={{ color: 'var(--ink-primary)' }}>
            ¥{marginCheck.baseAgentPrice.toFixed(2)}
          </strong>
        </div>
      </div>

      {Number(draft.cost_price || 0) > 0 && (
        <div
          className="sm:col-span-2 p-3.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{
            borderColor: marginCheck.baseLoss > 0 ? 'var(--danger)' : 'var(--success)',
            backgroundColor: marginCheck.baseLoss > 0 ? 'var(--danger-soft)' : 'var(--success-soft)',
            color: marginCheck.baseLoss > 0 ? 'var(--danger)' : 'var(--success)',
          }}
        >
          <div className="flex items-start gap-2">
            {marginCheck.baseLoss > 0 ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <div className="leading-relaxed">
              {marginCheck.baseLoss > 0 ? (
                <>
                  <strong>{ape.peLossAlertStrong}</strong>
                  {fmt(ape.peLossAlertBody, tierDisplay)}
                  <span className="font-mono-num font-semibold">
                    ¥{marginCheck.baseAgentPrice.toFixed(2)}
                  </span>
                  {ape.peLossBelowCost}
                  <span className="font-mono-num font-semibold">¥{Number(draft.cost_price).toFixed(2)}</span>
                  {ape.peLossPerOrder}
                  <span className="font-mono-num font-semibold">¥{marginCheck.baseLoss.toFixed(2)}</span>
                  {ape.peLossSuggestRetail}
                  <span className="font-mono-num font-semibold">
                    ¥{marginCheck.baseSafeRetail.toFixed(2)}
                  </span>
                  .
                </>
              ) : (
                <>
                  <strong>{ape.peSafeMarginStrong}</strong>
                  {fmt(ape.peSafeMarginBody, tierDisplay)}
                  <span className="font-mono-num font-semibold">
                    ¥{marginCheck.baseAgentPrice.toFixed(2)}
                  </span>
                  {ape.peSafeAfterCost}
                  <span className="font-mono-num font-semibold">¥{Number(draft.cost_price).toFixed(2)}</span>
                  {ape.peSafeMinNet}
                  <span className="font-mono-num font-semibold">
                    +¥{(marginCheck.baseAgentPrice - Number(draft.cost_price)).toFixed(2)}
                  </span>
                  .
                </>
              )}
            </div>
          </div>
          {marginCheck.baseLoss > 0 && (
            <button
              type="button"
              onClick={() =>
                setDraft((prev) => (prev ? { ...prev, base_price: marginCheck.baseSafeRetail } : prev))
              }
              className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
              style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
            >
              {fmt(ape.peLossSetSafeBtn, { price: marginCheck.baseSafeRetail })}
            </button>
          )}
        </div>
      )}

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peDeliveryLabel}</div>
        <select
          value={draft.delivery_type}
          onChange={(e) => setDraft({ ...draft, delivery_type: e.target.value })}
          className="acct-input"
        >
          <option value="auto">{ape.peDeliveryAuto}</option>
          {draft.delivery_type === 'api_key' && (
            <option value="api_key" disabled>
              {ape.peDeliveryApiKey}
            </option>
          )}
          <option value="manual">{ape.peDeliveryManual}</option>
          <option value="preorder">{ape.peDeliveryPreorder}</option>
        </select>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{ape.peStockModeLabel}</div>
        <select
          value={draft.stock_mode}
          onChange={(e) => setDraft({ ...draft, stock_mode: e.target.value })}
          className="acct-input"
        >
          <option value="cards">{ape.peStockModeCards}</option>
          <option value="seats">{ape.peStockModeSeats}</option>
          <option value="manual_stock">{ape.peStockModeManual}</option>
        </select>
      </div>

      {draft.stock_mode === 'manual_stock' && (
        <div>
          <div className="block text-xs font-semibold mb-1">{ape.peManualStockLabel}</div>
          <input
            type="number"
            min={0}
            value={draft.manual_stock}
            onChange={(e) => setDraft({ ...draft, manual_stock: Number(e.target.value) })}
            className="acct-input font-mono-num"
          />
        </div>
      )}

      {draft.stock_mode === 'seats' && (
        <>
          <div>
            <div className="block text-xs font-semibold mb-1">{ape.peSeatTotalLabel}</div>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.seat_total}
              onChange={(e) => setDraft({ ...draft, seat_total: Number(e.target.value) })}
              className="acct-input font-mono-num"
            />
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{ape.peSeatUsedLabel}</div>
            <input
              type="number"
              min={0}
              max={draft.seat_total}
              value={draft.seat_used}
              onChange={(e) => setDraft({ ...draft, seat_used: Number(e.target.value) })}
              className="acct-input font-mono-num"
            />
          </div>
        </>
      )}

      <ProductWarrantyBox draft={draft} setDraft={setDraft} />

      <div
        className="sm:col-span-2 p-4 rounded-xl border space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold">{rf.prodRulesHeading}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
              {rf.prodMinQtyLabel}
            </div>
            <input
              type="number"
              min={1}
              max={999}
              value={draft.min_quantity ?? 1}
              onChange={(e) => setDraft({ ...draft, min_quantity: Math.max(1, Number(e.target.value) || 1) })}
              className="acct-input font-mono-num text-xs"
            />
          </div>
          <div>
            <div className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
              {rf.prodMaxQtyLabel}
            </div>
            <input
              type="number"
              min={0}
              max={999}
              value={draft.max_quantity ?? 0}
              onChange={(e) => setDraft({ ...draft, max_quantity: Math.max(0, Number(e.target.value) || 0) })}
              className="acct-input font-mono-num text-xs"
            />
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.require_login)}
            onChange={(e) => setDraft({ ...draft, require_login: e.target.checked })}
          />
          {rf.prodRequireLoginLabel}
        </label>
      </div>

      <div className="sm:col-span-2">
        <div className="block text-xs font-semibold mb-1">{ape.peTagsLabel}</div>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder={ape.peTagsPlaceholder}
          className="acct-input"
        />
      </div>

      <div className="sm:col-span-2 flex items-center gap-6 pt-1">
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.is_featured)}
            onChange={(e) => setDraft({ ...draft, is_featured: e.target.checked ? 1 : 0 })}
          />
          {ape.peFeaturedCheckbox}
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.is_active)}
            onChange={(e) => setDraft({ ...draft, is_active: e.target.checked ? 1 : 0 })}
          />
          {ape.peActiveCheckbox}
        </label>
      </div>
    </div>
  );
}
