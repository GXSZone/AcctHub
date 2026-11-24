/**
 * 单个商品分组定价与多 SKU 利润试算卡片
 */

import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileEdit,
  Layers,
  Loader2,
  Lock,
  RotateCcw,
  Save,
} from 'lucide-react';
import type { AgentPricingProductRow } from '../../../api/agent.api';
import { fmt } from '../../../i18n';
import { useAgentPricingI18n } from '../../../i18n/namespaces/agent-pricing';

interface AgentPricingProductCardProps {
  product: AgentPricingProductRow;
  isExpanded: boolean;
  selectedKeys: Set<string>;
  drafts: Record<string, string>;
  savingKey: string | null;
  savingProductId: number | null;
  togglingProductId: number | null;
  onToggleExpand: () => void;
  onToggleSelectProduct: () => void;
  onToggleSelectSpec: (key: string) => void;
  onDraftChange: (key: string, val: string) => void;
  onSaveSpec: (specId: string) => void;
  onResetSpec: (specId: string) => void;
  onSaveProductDirty: () => void;
  onOpenContentDrawer: () => void;
  onToggleListing: () => void;
}

export function AgentPricingProductCard({
  product: p,
  isExpanded,
  selectedKeys,
  drafts,
  savingKey,
  savingProductId,
  togglingProductId,
  onToggleExpand,
  onToggleSelectProduct,
  onToggleSelectSpec,
  onDraftChange,
  onSaveSpec,
  onResetSpec,
  onSaveProductDirty,
  onOpenContentDrawer,
  onToggleListing,
}: AgentPricingProductCardProps) {
  const ap = useAgentPricingI18n();
  const isMultiSku = p.specs.length > 1;
  const specKeys = p.specs.map((s) => `${p.product_id}:${s.spec_id}`);
  const checkedCount = specKeys.filter((k) => selectedKeys.has(k)).length;
  const allProdChecked = specKeys.length > 0 && checkedCount === specKeys.length;

  const minCost = Math.min(...p.specs.map((s) => s.cost_price));
  const maxCost = Math.max(...p.specs.map((s) => s.cost_price));
  const minSell = Math.min(...p.specs.map((s) => s.effective_sell_price));
  const maxSell = Math.max(...p.specs.map((s) => s.effective_sell_price));

  const prodDirtyCount = p.specs.filter((s) => {
    const val = Number(drafts[`${p.product_id}:${s.spec_id}`]);
    return !Number.isNaN(val) && val >= s.cost_price && Math.abs(val - s.effective_sell_price) > 0.001;
  }).length;

  return (
    <div
      className="rounded-2xl border overflow-hidden transition-opacity"
      style={{
        borderColor: prodDirtyCount > 0 ? 'var(--accent)' : 'var(--border-color)',
        backgroundColor: 'var(--bg-surface)',
        opacity: p.is_listed ? 1 : 0.65,
      }}
    >
      <div
        className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          borderBottom: isExpanded ? '1px solid var(--border-color)' : 'none',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <input
            type="checkbox"
            checked={allProdChecked}
            onChange={onToggleSelectProduct}
            aria-label={fmt(ap.prodSelectAllAria, { title: p.title })}
          />
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-2 min-w-0 text-left cursor-pointer flex-1"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-muted)' }} />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className="text-xs sm:text-[13px] font-semibold truncate max-w-[340px]"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  {p.title}
                </span>
                <span
                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10.5px] font-mono-num font-medium"
                  style={{
                    backgroundColor: isMultiSku ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: isMultiSku ? 'var(--accent)' : 'var(--ink-secondary)',
                  }}
                >
                  <Layers className="w-2.5 h-2.5" />
                  {fmt(ap.prodSkuCount, { count: p.specs.length })}
                </span>
                {!p.is_listed && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
                  >
                    {ap.prodHiddenBadge}
                  </span>
                )}
                {p.has_content_override && (
                  <span
                    className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                    style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                  >
                    {ap.prodOverrideBadge}
                  </span>
                )}
                {checkedCount > 0 && checkedCount < specKeys.length && (
                  <span className="text-[10.5px] font-mono-num" style={{ color: 'var(--accent)' }}>
                    {fmt(ap.prodCheckedCount, { checked: checkedCount, total: specKeys.length })}
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                {ap.prodCostRangePrefix}
                {minCost === maxCost ? minCost.toFixed(2) : `${minCost.toFixed(2)}–${maxCost.toFixed(2)}`}
                {' · '}
                {ap.prodRetailPrefix}{' '}
                <strong style={{ color: 'var(--ink-primary)' }}>
                  ¥{minSell === maxSell ? minSell.toFixed(2) : `${minSell.toFixed(2)}–${maxSell.toFixed(2)}`}
                </strong>
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {prodDirtyCount > 0 && (
            <button
              type="button"
              disabled={savingProductId === p.product_id}
              onClick={onSaveProductDirty}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {savingProductId === p.product_id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              {fmt(ap.prodSaveBtn, { count: prodDirtyCount })}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenContentDrawer}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
            style={{
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--ink-primary)',
            }}
          >
            <FileEdit className="w-3 h-3" style={{ color: 'var(--accent)' }} />
            {ap.prodOverrideBtn}
          </button>
          <button
            type="button"
            disabled={togglingProductId === p.product_id}
            onClick={onToggleListing}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
            style={{
              borderColor: p.is_listed ? 'var(--border-color)' : 'var(--success)',
              backgroundColor: p.is_listed ? 'var(--bg-surface)' : 'var(--success-soft)',
              color: p.is_listed ? 'var(--ink-secondary)' : 'var(--success)',
            }}
          >
            {p.is_listed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            {p.is_listed ? ap.prodUnlistBtn : ap.prodRelistBtn}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr
                className="border-b text-[11px]"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pl-10 pr-2 w-10">{ap.prodColPick}</th>
                <th className="py-2 pr-3">{ap.prodColSku}</th>
                <th className="py-2 px-2.5 text-right whitespace-nowrap w-24">{ap.prodColGuidePrice}</th>
                <th className="py-2 px-2.5 text-right whitespace-nowrap w-24">
                  <span className="inline-flex items-center justify-end gap-1">
                    <Lock className="w-3 h-3" /> {ap.prodColCostFloor}
                  </span>
                </th>
                <th className="py-2 px-2.5 text-right whitespace-nowrap w-28">{ap.prodColRetailPrice}</th>
                <th className="py-2 px-2.5 text-right whitespace-nowrap w-28">{ap.prodColUnitProfit}</th>
                <th className="py-2 pl-2.5 pr-4 text-right whitespace-nowrap w-28">{ap.prodColActions}</th>
              </tr>
            </thead>
            <tbody>
              {p.specs.map((s) => {
                const key = `${p.product_id}:${s.spec_id}`;
                const currentVal = Number(drafts[key] ?? s.effective_sell_price);
                const liveProfit = Number.isNaN(currentVal)
                  ? 0
                  : Number((currentVal - s.cost_price).toFixed(2));
                const marginPct =
                  s.cost_price > 0 && liveProfit > 0 ? Math.round((liveProfit / s.cost_price) * 100) : 0;
                const isBelowCost = !Number.isNaN(currentVal) && currentVal < s.cost_price;
                const isDirty = Math.abs(currentVal - s.effective_sell_price) > 0.001;
                const checked = selectedKeys.has(key);

                return (
                  <tr
                    key={key}
                    className="border-b last:border-b-0 transition-colors"
                    style={{
                      borderColor: 'var(--border-color)',
                      backgroundColor: checked
                        ? 'color-mix(in srgb, var(--accent-soft) 50%, transparent)'
                        : isDirty
                          ? 'color-mix(in srgb, var(--warning-soft) 35%, transparent)'
                          : 'transparent',
                    }}
                  >
                    <td className="py-2.5 pl-10 pr-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleSelectSpec(key)}
                        aria-label={fmt(ap.prodPickSkuAria, { prodTitle: p.title, specName: s.spec_name })}
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                          {s.spec_name}
                        </span>
                        {s.custom_price !== null && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {ap.prodCustomPriceTag}
                          </span>
                        )}
                        {isDirty && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}
                          >
                            {ap.prodPendingSaveTag}
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className="py-2.5 px-2.5 text-right font-mono-num whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      ¥{s.main_price.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right font-mono-num font-semibold whitespace-nowrap">
                      ¥{s.cost_price.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                      <input
                        type="number"
                        step="0.1"
                        min={s.cost_price}
                        value={drafts[key] ?? ''}
                        onChange={(e) => onDraftChange(key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isBelowCost) {
                            e.preventDefault();
                            onSaveSpec(s.spec_id);
                          }
                        }}
                        className="acct-input py-1 px-2 w-24 text-right font-mono-num text-xs inline-block"
                        style={{
                          borderColor: isBelowCost ? 'var(--danger)' : isDirty ? 'var(--accent)' : undefined,
                        }}
                      />
                    </td>
                    <td
                      className="py-2.5 px-2.5 text-right font-mono-num font-semibold whitespace-nowrap"
                      style={{ color: isBelowCost ? 'var(--danger)' : 'var(--success)' }}
                    >
                      {isBelowCost ? (
                        ap.prodBelowCost
                      ) : (
                        <span>
                          +¥{liveProfit.toFixed(2)}
                          <span className="text-[10.5px] font-normal ml-1 opacity-75">(+{marginPct}%)</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2.5 pr-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          disabled={savingKey === key || isBelowCost}
                          onClick={() => onSaveSpec(s.spec_id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium cursor-pointer disabled:opacity-40"
                          style={{
                            backgroundColor: isDirty ? 'var(--accent)' : 'var(--accent-soft)',
                            color: isDirty ? '#FAF9F5' : 'var(--accent)',
                          }}
                        >
                          <Save className="w-3 h-3" />
                          {ap.prodSaveSingleBtn}
                        </button>
                        {s.custom_price !== null && (
                          <button
                            type="button"
                            disabled={savingKey === key}
                            onClick={() => onResetSpec(s.spec_id)}
                            className="inline-flex items-center justify-center p-1.5 rounded-lg border cursor-pointer"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                            title={ap.prodResetSingleTitle}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
