/**
 * 上游配置抽屉 Tab 3（采集过滤）与 Tab 4（加价防亏与余额预警）
 */

import { X } from 'lucide-react';
import type React from 'react';
import { useAdminUpstreamDrawerI18n } from '../../i18n/namespaces/admin-upstream-drawer';
import type { SourceEditorDraft } from './upstream-constants';

interface FiltersTabProps {
  sourceDraft: SourceEditorDraft;
  setSourceDraft: React.Dispatch<React.SetStateAction<SourceEditorDraft>>;
  includeInput: string;
  setIncludeInput: (v: string) => void;
  excludeInput: string;
  setExcludeInput: (v: string) => void;
  onAddKeywords: (kind: 'include' | 'exclude', rawText: string) => void;
  onRemoveKeyword: (kind: 'include' | 'exclude', word: string) => void;
}

export function UpstreamDrawerFiltersTab({
  sourceDraft,
  setSourceDraft,
  includeInput,
  setIncludeInput,
  excludeInput,
  setExcludeInput,
  onAddKeywords,
  onRemoveKeyword,
}: FiltersTabProps) {
  const d = useAdminUpstreamDrawerI18n();

  return (
    <div className="space-y-4">
      <div>
        <div className="block font-semibold mb-1">{d.filterIncludeLabel}</div>
        <div className="flex gap-2">
          <input
            value={includeInput}
            onChange={(e) => setIncludeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddKeywords('include', includeInput);
              }
            }}
            placeholder={d.filterIncludePh}
            className="acct-input flex-1"
          />
          <button
            type="button"
            onClick={() => onAddKeywords('include', includeInput)}
            className="px-3 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {d.addBtn}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(sourceDraft.filter_rules.include_keywords || []).map((w) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
              style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
            >
              {w}
              <button type="button" onClick={() => onRemoveKeyword('include', w)} className="cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div>
        <div className="block font-semibold mb-1">{d.filterExcludeLabel}</div>
        <div className="flex gap-2">
          <input
            value={excludeInput}
            onChange={(e) => setExcludeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddKeywords('exclude', excludeInput);
              }
            }}
            placeholder={d.filterExcludePh}
            className="acct-input flex-1"
          />
          <button
            type="button"
            onClick={() => onAddKeywords('exclude', excludeInput)}
            className="px-3 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {d.addBtn}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(sourceDraft.filter_rules.exclude_keywords || []).map((w) => (
            <span
              key={w}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px]"
              style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              {w}
              <button type="button" onClick={() => onRemoveKeyword('exclude', w)} className="cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="block font-semibold mb-1">{d.filterMinCostLabel}</div>
          <input
            type="number"
            min={0}
            value={sourceDraft.filter_rules.min_cost_price || 0}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                filter_rules: { ...sourceDraft.filter_rules, min_cost_price: Number(e.target.value) || 0 },
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.filterMaxCostLabel}</div>
          <input
            type="number"
            min={0}
            value={sourceDraft.filter_rules.max_cost_price || 0}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                filter_rules: { ...sourceDraft.filter_rules, max_cost_price: Number(e.target.value) || 0 },
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
      </div>
    </div>
  );
}

interface PricingTabProps {
  sourceDraft: SourceEditorDraft;
  setSourceDraft: React.Dispatch<React.SetStateAction<SourceEditorDraft>>;
  categories: Array<{ id: number; name: string }>;
}

export function UpstreamDrawerPricingTab({ sourceDraft, setSourceDraft, categories }: PricingTabProps) {
  const d = useAdminUpstreamDrawerI18n();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <div className="block font-semibold mb-1">{d.pricingMarkupPctLabel}</div>
          <input
            type="number"
            value={sourceDraft.pricing_rules.markup_percent ?? 25}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                pricing_rules: { ...sourceDraft.pricing_rules, markup_percent: Number(e.target.value) },
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingMarkupFixedLabel}</div>
          <input
            type="number"
            step="0.1"
            value={sourceDraft.pricing_rules.markup_fixed ?? 0}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                pricing_rules: { ...sourceDraft.pricing_rules, markup_fixed: Number(e.target.value) },
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingRoundingLabel}</div>
          <select
            value={sourceDraft.pricing_rules.rounding || 'point9'}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                pricing_rules: {
                  ...sourceDraft.pricing_rules,
                  rounding: e.target.value as 'none' | 'integer' | 'point9',
                },
              })
            }
            className="acct-input"
          >
            <option value="point9">{d.pricingRoundPoint9}</option>
            <option value="integer">{d.pricingRoundInteger}</option>
            <option value="none">{d.pricingRoundNone}</option>
          </select>
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingSpikeGuardLabel}</div>
          <input
            type="number"
            min={0}
            value={sourceDraft.pricing_rules.price_spike_guard_pct ?? 35}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                pricing_rules: {
                  ...sourceDraft.pricing_rules,
                  price_spike_guard_pct: Number(e.target.value),
                },
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingLowBalLabel}</div>
          <input
            type="number"
            min={0}
            value={sourceDraft.low_balance_threshold ?? 100}
            onChange={(e) =>
              setSourceDraft({ ...sourceDraft, low_balance_threshold: Number(e.target.value) || 0 })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingDefaultCatLabel}</div>
          <select
            value={sourceDraft.default_category_id}
            onChange={(e) => setSourceDraft({ ...sourceDraft, default_category_id: Number(e.target.value) })}
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
          <div className="block font-semibold mb-1">{d.pricingOosActionLabel}</div>
          <select
            value={sourceDraft.out_of_stock_action}
            onChange={(e) => setSourceDraft({ ...sourceDraft, out_of_stock_action: e.target.value })}
            className="acct-input"
          >
            <option value="mark_sold_out">{d.pricingOosMarkSoldOut}</option>
            <option value="auto_unpublish">{d.pricingOosUnpublish}</option>
          </select>
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingSyncIntervalLabel}</div>
          <input
            type="number"
            min={1}
            value={sourceDraft.sync_interval_minutes}
            onChange={(e) =>
              setSourceDraft({
                ...sourceDraft,
                sync_interval_minutes: Math.max(1, Number(e.target.value) || 15),
              })
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block font-semibold mb-1">{d.pricingStatusLabel}</div>
          <select
            value={sourceDraft.status}
            onChange={(e) =>
              setSourceDraft({ ...sourceDraft, status: e.target.value === 'active' ? 'active' : 'paused' })
            }
            className="acct-input"
          >
            <option value="active">{d.pricingStatusActive}</option>
            <option value="paused">{d.pricingStatusDisabled}</option>
          </select>
        </div>
      </div>

      <div
        className="p-3.5 rounded-xl border text-[11.5px]"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--ink-secondary)',
        }}
      >
        <strong style={{ color: 'var(--ink-primary)' }}>{d.pricingAgentGuardStrong}</strong>
        {d.pricingAgentGuardDesc}
      </div>

      <div className="flex flex-wrap gap-5 pt-1">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sourceDraft.auto_sync_enabled}
            onChange={(e) => setSourceDraft({ ...sourceDraft, auto_sync_enabled: e.target.checked })}
          />
          {d.pricingAutoSyncLabel}
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sourceDraft.auto_republish_on_restock}
            onChange={(e) => setSourceDraft({ ...sourceDraft, auto_republish_on_restock: e.target.checked })}
          />
          {d.pricingAutoRepublishLabel}
        </label>
      </div>
    </div>
  );
}
