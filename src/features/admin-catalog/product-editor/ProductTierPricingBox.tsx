/**
 * 后台商品编辑器多规格分区内的「阶梯批发价配置」模块
 */

import { BUSINESS_LIMITS } from '@shared/constants/limits';
import { Layers, Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import type { EditableProduct } from './product-editor.types';

interface ProductTierPricingBoxProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
}

export function ProductTierPricingBox({ draft, setDraft }: ProductTierPricingBoxProps) {
  const ape = useAdminProductEditorI18n();
  const tiers = draft.tier_pricing || [];
  const samplePrice = Number(draft.specs[0]?.price ?? draft.base_price ?? 0);
  const baseCost = Number(draft.specs[0]?.cost_price ?? draft.cost_price ?? 0);

  return (
    <div
      className="p-4 rounded-2xl border space-y-3"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {ape.peTierTitle}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {ape.peTierSubtitle}
          </p>
        </div>
        <button
          type="button"
          disabled={
            tiers.length >= 10 || tiers.some((tier) => tier.min_qty === BUSINESS_LIMITS.MAX_ORDER_QUANTITY)
          }
          onClick={() =>
            setDraft({
              ...draft,
              tier_pricing: [
                ...tiers,
                {
                  min_qty:
                    tiers.length === 0
                      ? 5
                      : Math.min(
                          BUSINESS_LIMITS.MAX_ORDER_QUANTITY,
                          Math.max(...tiers.map((tier) => tier.min_qty)) + 5
                        ),
                  discount_rate: 0.9,
                },
              ],
            })
          }
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer shrink-0"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {ape.peTierAddBtn}
        </button>
      </div>

      {tiers.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {ape.peTierEmpty}
        </div>
      ) : (
        <div className="space-y-2">
          {tiers.map((tier, idx) => {
            const estUnit = Number((samplePrice * Number(tier.discount_rate || 1)).toFixed(2));
            const hitsCostFloor = baseCost > 0 && estUnit < baseCost;
            return (
              <div
                key={`tier-${idx}`}
                className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2.5 rounded-xl border text-xs"
                style={{
                  borderColor: hitsCostFloor ? 'var(--warning)' : 'var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              >
                {ape.peTierMinQtyPrefix && (
                  <span className="text-[11px] shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {ape.peTierMinQtyPrefix}
                  </span>
                )}
                <input
                  type="number"
                  min={2}
                  max={BUSINESS_LIMITS.MAX_ORDER_QUANTITY}
                  value={tier.min_qty}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[idx] = {
                      ...tier,
                      min_qty: Math.min(
                        BUSINESS_LIMITS.MAX_ORDER_QUANTITY,
                        Math.max(2, Math.floor(Number(e.target.value) || 2))
                      ),
                    };
                    setDraft({ ...draft, tier_pricing: next });
                  }}
                  className="acct-input w-20 font-mono-num text-xs"
                />
                <span className="text-[11px] shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  {ape.peTierRatePrefix}
                </span>
                <input
                  type="number"
                  min={0.1}
                  max={0.99}
                  step="0.01"
                  value={tier.discount_rate}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[idx] = {
                      ...tier,
                      discount_rate: Math.min(0.99, Math.max(0.1, Number(e.target.value) || 0.9)),
                    };
                    setDraft({ ...draft, tier_pricing: next });
                  }}
                  className="acct-input w-24 font-mono-num text-xs"
                />
                <span className="text-[11px] font-mono-num flex-1" style={{ color: 'var(--ink-secondary)' }}>
                  {fmt(ape.peTierRateSuffix, {
                    fold: (tier.discount_rate * 10).toFixed(1).replace(/\.0$/, ''),
                    pct: Math.round(tier.discount_rate * 100),
                  })}
                  {samplePrice > 0
                    ? fmt(ape.peTierSampleEst, { price: Math.max(baseCost || 0, estUnit).toFixed(2) })
                    : ''}
                  {hitsCostFloor ? ape.peTierCostClamped : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, tier_pricing: tiers.filter((_, i) => i !== idx) })}
                  className="p-1 rounded-lg cursor-pointer shrink-0"
                  style={{ color: 'var(--danger)' }}
                  aria-label={ape.peTierDeleteAria}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
