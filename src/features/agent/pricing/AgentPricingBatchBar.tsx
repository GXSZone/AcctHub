/**
 * 分站批量定价、在售筛选与关键词检索工具栏
 */

import { Loader2, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { fmt } from '../../../i18n';
import { useAgentPricingI18n } from '../../../i18n/namespaces/agent-pricing';

interface AgentPricingBatchBarProps {
  batchScopeLabel: string;
  totalItemsCount: number;
  listedCount: number;
  hiddenCount: number;
  batchTargetCount: number;
  listingFilter: 'all' | 'listed' | 'hidden';
  query: string;
  batchMode: 'markup_cost_pct' | 'markup_main_pct' | 'markup_cost_fixed';
  batchValue: number;
  batchRounding: 'none' | 'integer' | 'point9';
  batchApplying: boolean;
  onListingFilterChange: (f: 'all' | 'listed' | 'hidden') => void;
  onQueryChange: (q: string) => void;
  onBatchModeChange: (m: 'markup_cost_pct' | 'markup_main_pct' | 'markup_cost_fixed') => void;
  onBatchValueChange: (v: number) => void;
  onBatchRoundingChange: (r: 'none' | 'integer' | 'point9') => void;
  onBatchApply: () => void;
  onBatchReset: () => void;
}

export function AgentPricingBatchBar({
  batchScopeLabel,
  totalItemsCount,
  listedCount,
  hiddenCount,
  batchTargetCount,
  listingFilter,
  query,
  batchMode,
  batchValue,
  batchRounding,
  batchApplying,
  onListingFilterChange,
  onQueryChange,
  onBatchModeChange,
  onBatchValueChange,
  onBatchRoundingChange,
  onBatchApply,
  onBatchReset,
}: AgentPricingBatchBarProps) {
  const ap = useAgentPricingI18n();
  return (
    <div
      className="p-4 rounded-2xl border space-y-3 text-xs"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1.5 font-semibold flex-wrap"
          style={{ color: 'var(--ink-primary)' }}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {ap.batchToolTitle}
          <span
            className="ml-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {fmt(ap.batchScopePrefix, { label: batchScopeLabel })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border p-0.5 text-[11px]"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
          >
            {[
              { id: 'all' as const, label: fmt(ap.batchFilterAll, { count: totalItemsCount }) },
              { id: 'listed' as const, label: fmt(ap.batchFilterListed, { count: listedCount }) },
              { id: 'hidden' as const, label: fmt(ap.batchFilterHidden, { count: hiddenCount }) },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onListingFilterChange(f.id)}
                className="px-2.5 py-1 rounded-lg cursor-pointer font-medium"
                style={{
                  backgroundColor: listingFilter === f.id ? 'var(--accent-soft)' : 'transparent',
                  color: listingFilter === f.id ? 'var(--accent)' : 'var(--ink-muted)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-52">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={ap.batchSearchPlaceholder}
              className="acct-input h-8 pl-8 pr-2.5 py-0 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
        <div className="sm:col-span-4">
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ap.batchModeLabel}
          </div>
          <select
            value={batchMode}
            onChange={(e) =>
              onBatchModeChange(e.target.value as 'markup_cost_pct' | 'markup_main_pct' | 'markup_cost_fixed')
            }
            className="acct-input h-9 py-0 px-3 text-xs"
          >
            <option value="markup_cost_pct">{ap.batchModeCostPct}</option>
            <option value="markup_main_pct">{ap.batchModeMainPct}</option>
            <option value="markup_cost_fixed">{ap.batchModeCostFixed}</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {batchMode === 'markup_cost_fixed' ? ap.batchValueLabelFixed : ap.batchValueLabelPct}
          </div>
          <input
            type="number"
            step="1"
            value={batchValue}
            onChange={(e) => onBatchValueChange(Number(e.target.value))}
            className="acct-input h-9 py-0 px-3 text-xs font-mono-num"
          />
        </div>

        <div className="sm:col-span-3">
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ap.batchRoundLabel}
          </div>
          <select
            value={batchRounding}
            onChange={(e) => onBatchRoundingChange(e.target.value as 'none' | 'integer' | 'point9')}
            className="acct-input h-9 py-0 px-3 text-xs"
          >
            <option value="point9">{ap.batchRoundPoint9}</option>
            <option value="integer">{ap.batchRoundInteger}</option>
            <option value="none">{ap.batchRoundNone}</option>
          </select>
        </div>

        <div className="sm:col-span-3 flex items-center gap-1.5">
          <button
            type="button"
            disabled={batchApplying || batchTargetCount === 0}
            onClick={onBatchApply}
            className="flex-1 h-9 px-3 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {batchApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {ap.batchApplyBtn}
          </button>
          <button
            type="button"
            disabled={batchApplying || batchTargetCount === 0}
            onClick={onBatchReset}
            className="h-9 px-2.5 rounded-xl border text-xs font-medium cursor-pointer whitespace-nowrap disabled:opacity-50"
            style={{
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--ink-secondary)',
            }}
            title={ap.batchResetTitle}
          >
            {ap.batchResetBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
