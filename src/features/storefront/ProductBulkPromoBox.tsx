/**
 * 结账表单内阶梯批发价提示条 + 不可提现推广消费金抵扣选择器
 */

import { discountDisplay } from '@shared/domain/money';
import type { ProductTierPricingRule } from '@shared/domain/pricing';
import { Gift, Layers } from 'lucide-react';
import { fmt } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useDisplayCurrency } from '../../lib/currency';
import type { UserProfile } from '../../types';

interface ProductBulkPromoBoxProps {
  tiers: ProductTierPricingRule[];
  maxBuyQty: number;
  quantity: number;
  appliedBulkTier: ProductTierPricingRule | null;
  nextBulkTier: {
    min_qty: number;
    discount_rate: number;
    remaining_qty: number;
    projected_unit_price: number;
  } | null;
  user: UserProfile | null;
  usePromoBalance: boolean;
  promoUsedPreview: number;
  onSelectQty: (qty: number) => void;
  onTogglePromoBalance: (checked: boolean) => void;
}

export function ProductBulkPromoBox({
  tiers,
  maxBuyQty,
  quantity,
  appliedBulkTier,
  nextBulkTier,
  user,
  usePromoBalance,
  promoUsedPreview,
  onSelectQty,
  onTogglePromoBalance,
}: ProductBulkPromoBoxProps) {
  const sf = useStorefrontI18n();
  const { formatMoneyFixed } = useDisplayCurrency();
  const userPromo = Number(user?.promo_balance || 0);
  const availableTiers = tiers.filter((tier) => tier.min_qty <= maxBuyQty);
  if (availableTiers.length === 0 && userPromo < 0.01) return null;

  return (
    <div className="space-y-2.5">
      {availableTiers.length > 0 && (
        <div
          className="p-3 rounded-xl border space-y-2 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {sf.bulkTierTitle}
            </span>
            {appliedBulkTier && (
              <span
                className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold font-mono-num"
                style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
              >
                {fmt(sf.bulkDiscountApplied, discountDisplay(appliedBulkTier.discount_rate))}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableTiers.map((rule) => {
              const active = quantity >= rule.min_qty && appliedBulkTier?.min_qty === rule.min_qty;
              return (
                <button
                  key={rule.min_qty}
                  type="button"
                  onClick={() => onSelectQty(rule.min_qty)}
                  className="px-2.5 py-1 rounded-lg border text-[11px] font-mono-num cursor-pointer transition-colors"
                  style={{
                    borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                    backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                  }}
                >
                  {fmt(sf.bulkRuleItem, {
                    minQty: rule.min_qty,
                    zhFold: (rule.discount_rate * 10).toFixed(1).replace(/\.0$/, ''),
                    offPct: Math.round((1 - rule.discount_rate) * 100),
                  })}
                </button>
              );
            })}
          </div>
          {nextBulkTier && nextBulkTier.min_qty <= maxBuyQty && (
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sf.bulkUpsellPrefix}
              <strong style={{ color: 'var(--accent)' }}>{nextBulkTier.remaining_qty}</strong>
              {sf.bulkUpsellMid}
              <strong className="font-mono-num" style={{ color: 'var(--accent)' }}>
                {formatMoneyFixed(nextBulkTier.projected_unit_price)}
                {sf.bulkUpsellUnit}
              </strong>
              {sf.bulkUpsellSuffix}
            </div>
          )}
        </div>
      )}

      {user && userPromo >= 0.01 && (
        <label
          className="flex items-center justify-between gap-2 p-3 rounded-xl border text-xs cursor-pointer"
          style={{
            borderColor: usePromoBalance ? 'var(--accent)' : 'var(--border-color)',
            backgroundColor: usePromoBalance ? 'var(--accent-soft)' : 'var(--bg-canvas)',
          }}
        >
          <span className="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              checked={usePromoBalance}
              onChange={(e) => onTogglePromoBalance(e.target.checked)}
              className="rounded cursor-pointer"
            />
            <Gift className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span className="truncate">
              {fmt(sf.usePromoCheckbox, { avail: formatMoneyFixed(userPromo) })}
            </span>
          </span>
          {usePromoBalance && promoUsedPreview > 0 && (
            <span className="font-mono-num font-semibold shrink-0" style={{ color: 'var(--success)' }}>
              -{formatMoneyFixed(promoUsedPreview)}
            </span>
          )}
        </label>
      )}
    </div>
  );
}
