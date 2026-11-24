/**
 * 商品多规格套餐编辑分区（含单规格成本防亏校验与 SKU 上游路由）
 */

import { roundUpCurrency as roundUp2 } from '@shared/index';
import { Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import type { UpstreamBindingRecord, UpstreamSourceRecord } from '../../../api/upstream.api';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import { ProductSkuBindingsBox } from './ProductSkuBindingsBox';
import { ProductTierPricingBox } from './ProductTierPricingBox';
import type { EditableProduct } from './product-editor.types';

interface ProductSpecsSectionProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
  lowestTier: { name: string; discount_rate: number };
  isSuperAdmin: boolean;
  skuBindings: UpstreamBindingRecord[];
  upSources: UpstreamSourceRecord[];
  onReloadBindings: (pid: number) => Promise<void>;
}

export function ProductSpecsSection({
  draft,
  setDraft,
  lowestTier,
  isSuperAdmin,
  skuBindings,
  upSources,
  onReloadBindings,
}: ProductSpecsSectionProps) {
  const ape = useAdminProductEditorI18n();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
          {ape.peSpecsDesc}
        </p>
        <button
          type="button"
          onClick={() =>
            setDraft({
              ...draft,
              specs: [
                ...draft.specs,
                {
                  id: `spec_${Date.now().toString(36)}`,
                  name: ape.peNewSpecName,
                  price: draft.base_price || 39,
                  badge: ape.peNewSpecBadge,
                  description: '',
                },
              ],
            })
          }
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {ape.peAddSpecBtn}
        </button>
      </div>

      {draft.specs.map((spec, idx) => {
        const d = Math.max(0.05, Number(lowestTier.discount_rate || 0.72));
        const specCost = Number(spec.cost_price || 0);
        const specAgentFloor = Number((Number(spec.price || 0) * d).toFixed(2));
        const specLoss =
          specCost > 0 && specAgentFloor + 0.001 < specCost
            ? Number((specCost - specAgentFloor).toFixed(2))
            : 0;
        const specSafePrice = specCost > 0 ? roundUp2(specCost / d) : 0;
        return (
          <div
            key={spec.id + idx}
            className="p-4 rounded-2xl border space-y-3"
            style={{
              borderColor: specLoss > 0 ? 'var(--danger)' : 'var(--border-color)',
              backgroundColor: 'var(--bg-canvas)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                {fmt(ape.peSpecHeader, {
                  index: idx + 1,
                  id: spec.id,
                  agentFloor: specAgentFloor.toFixed(2),
                })}
              </span>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, specs: draft.specs.filter((_, i) => i !== idx) })}
                className="p-1 rounded-lg cursor-pointer"
                style={{ color: 'var(--danger)' }}
                aria-label={ape.peDeleteSpecAria}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <input
                placeholder={ape.peSpecNamePh}
                value={spec.name}
                onChange={(e) => {
                  const next = [...draft.specs];
                  next[idx] = { ...spec, name: e.target.value };
                  setDraft({ ...draft, specs: next });
                }}
                className="acct-input sm:col-span-2"
              />
              <input
                type="number"
                step="0.01"
                placeholder={ape.peSpecPricePh}
                value={spec.price}
                onChange={(e) => {
                  const next = [...draft.specs];
                  next[idx] = { ...spec, price: Number(e.target.value) };
                  setDraft({ ...draft, specs: next });
                }}
                className="acct-input font-mono-num"
                style={{ borderColor: specLoss > 0 ? 'var(--danger)' : undefined }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder={ape.peSpecCostPh}
                value={spec.cost_price ?? ''}
                onChange={(e) => {
                  const next = [...draft.specs];
                  next[idx] = { ...spec, cost_price: e.target.value === '' ? null : Number(e.target.value) };
                  setDraft({ ...draft, specs: next });
                }}
                className="acct-input font-mono-num"
              />
              <input
                placeholder={ape.peSpecBadgePh}
                value={spec.badge || ''}
                onChange={(e) => {
                  const next = [...draft.specs];
                  next[idx] = { ...spec, badge: e.target.value };
                  setDraft({ ...draft, specs: next });
                }}
                className="acct-input"
              />
              <input
                placeholder={ape.peSpecDescPh}
                value={spec.description || ''}
                onChange={(e) => {
                  const next = [...draft.specs];
                  next[idx] = { ...spec, description: e.target.value };
                  setDraft({ ...draft, specs: next });
                }}
                className="acct-input sm:col-span-3"
              />
            </div>
            {specLoss > 0 && (
              <div
                className="p-2.5 rounded-xl text-[11.5px] flex items-center justify-between gap-2"
                style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
              >
                <span>
                  {fmt(ape.peSpecLossWarn, {
                    agentFloor: specAgentFloor.toFixed(2),
                    cost: specCost.toFixed(2),
                    loss: specLoss.toFixed(2),
                    safePrice: specSafePrice,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = [...draft.specs];
                    next[idx] = { ...spec, price: specSafePrice };
                    setDraft({ ...draft, specs: next });
                  }}
                  className="px-2.5 py-1 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0"
                  style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
                >
                  {fmt(ape.peSpecFixPriceBtn, { safePrice: specSafePrice })}
                </button>
              </div>
            )}
          </div>
        );
      })}

      <ProductTierPricingBox draft={draft} setDraft={setDraft} />

      {isSuperAdmin && draft.id && (
        <ProductSkuBindingsBox
          productId={draft.id}
          specs={draft.specs}
          skuBindings={skuBindings}
          upSources={upSources}
          onReloadBindings={onReloadBindings}
        />
      )}
    </div>
  );
}
