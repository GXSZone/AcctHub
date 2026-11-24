/**
 * 后台商品编辑器：高转化营销形态分区（隐藏/口令、限时秒杀、组合套餐、拼团合租）
 */

import { Flame, ListFilter, Lock, PackageCheck, Plus, Trash2, Users } from 'lucide-react';
import type React from 'react';
import { useCommerceI18n } from '../../../i18n/namespaces/commerce';
import { useExtensionsI18n } from '../../../i18n/namespaces/extensions';
import type { EditableProduct } from './product-editor.types';

interface ProductMarketingSectionProps {
  draft: EditableProduct;
  setDraft: React.Dispatch<React.SetStateAction<EditableProduct | null>>;
}

/** 将 SQLite UTC 时间或 ISO 时间安全转为 `<input type="datetime-local">` 所需的 YYYY-MM-DDTHH:MM */
function toDateTimeLocalValue(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // 若已经是 YYYY-MM-DDTHH:MM（无时区后缀），直接保留
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  // SQLite datetime() 格式如 "2026-11-22 19:00:00" 按 UTC 解析后转本地时间
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) {
    return trimmed.replace(' ', 'T').slice(0, 16);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function ProductMarketingSection({ draft, setDraft }: ProductMarketingSectionProps) {
  const cm = useCommerceI18n();
  const pc = useExtensionsI18n();
  const bundleItems = draft.bundle_items ?? [];

  const updateBundleItem = (
    idx: number,
    patch: Partial<{ product_id: number; spec_id: string; quantity: number }>
  ) => {
    const next = bundleItems.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    setDraft({ ...draft, bundle_items: next });
  };

  return (
    <div className="space-y-5">
      {/* 1. 隐藏商品与口令专属访问 */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {cm.editorHiddenHeading}
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.is_hidden)}
            onChange={(e) => setDraft({ ...draft, is_hidden: e.target.checked })}
          />
          <span>{cm.editorIsHiddenLabel}</span>
        </label>
        <div>
          <div className="text-[11px] font-medium mb-1">{cm.editorAccessPwdLabel}</div>
          <input
            type="text"
            value={draft.access_password || ''}
            onChange={(e) => setDraft({ ...draft, access_password: e.target.value })}
            placeholder={cm.editorAccessPwdPlaceholder}
            className="acct-input text-xs font-mono-num"
          />
        </div>
      </div>

      {/* 2. 限时秒杀 / 闪购倒计时 */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <Flame className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {cm.editorFlashHeading}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-medium mb-1">{cm.editorFlashPriceLabel}</div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.flash_sale_price ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  flash_sale_price: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className="acct-input text-xs font-mono-num"
            />
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1">{cm.editorFlashLimitLabel}</div>
            <input
              type="number"
              min="0"
              value={draft.flash_sale_limit ?? 0}
              onChange={(e) => setDraft({ ...draft, flash_sale_limit: Math.max(0, Number(e.target.value)) })}
              className="acct-input text-xs font-mono-num"
            />
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1">{cm.editorFlashStartLabel}</div>
            <input
              type="datetime-local"
              value={toDateTimeLocalValue(draft.flash_sale_start_at)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  flash_sale_start_at: e.target.value ? new Date(e.target.value).toISOString() : '',
                })
              }
              className="acct-input text-xs font-mono-num"
            />
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1">{cm.editorFlashEndLabel}</div>
            <input
              type="datetime-local"
              value={toDateTimeLocalValue(draft.flash_sale_end_at)}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  flash_sale_end_at: e.target.value ? new Date(e.target.value).toISOString() : '',
                })
              }
              className="acct-input text-xs font-mono-num"
            />
          </div>
        </div>
      </div>

      {/* 3. 组合套餐 / 捆绑包 */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <PackageCheck className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {cm.editorBundleHeading}
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft({
                ...draft,
                bundle_items: [...bundleItems, { product_id: 1, spec_id: 'default', quantity: 1 }],
              })
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            <Plus className="w-3 h-3" />
            {cm.editorBundleAddBtn}
          </button>
        </div>

        {bundleItems.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {cm.editorBundleEmptyHint}
          </p>
        ) : (
          <div className="space-y-2">
            {bundleItems.map((item, idx) => (
              <div key={`${idx}-${item.product_id}`} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <div className="text-[10.5px] mb-0.5">{cm.editorBundleProductIdLabel}</div>
                  <input
                    type="number"
                    min={1}
                    value={item.product_id}
                    onChange={(e) =>
                      updateBundleItem(idx, { product_id: Math.max(1, Number(e.target.value)) })
                    }
                    className="acct-input text-xs font-mono-num"
                  />
                </div>
                <div className="col-span-4">
                  <div className="text-[10.5px] mb-0.5">{cm.editorBundleSpecIdLabel}</div>
                  <input
                    type="text"
                    value={item.spec_id}
                    onChange={(e) => updateBundleItem(idx, { spec_id: e.target.value })}
                    className="acct-input text-xs font-mono-num"
                  />
                </div>
                <div className="col-span-2">
                  <div className="text-[10.5px] mb-0.5">{cm.editorBundleQtyLabel}</div>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={item.quantity}
                    onChange={(e) => updateBundleItem(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                    className="acct-input text-xs font-mono-num"
                  />
                </div>
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({ ...draft, bundle_items: bundleItems.filter((_, i) => i !== idx) })
                    }
                    className="w-full py-2 rounded-xl border text-xs inline-flex items-center justify-center cursor-pointer"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    aria-label={cm.editorBundleRemoveBtn}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. 拼团合租 */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {cm.editorGroupBuyHeading}
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.group_buy_enabled)}
            onChange={(e) => setDraft({ ...draft, group_buy_enabled: e.target.checked })}
          />
          <span>{cm.editorGroupBuyEnableLabel}</span>
        </label>
        {draft.group_buy_enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] font-medium mb-1">{cm.editorGroupBuySizeLabel}</div>
              <input
                type="number"
                min={2}
                max={20}
                value={draft.group_buy_size ?? 2}
                onChange={(e) =>
                  setDraft({ ...draft, group_buy_size: Math.max(2, Math.min(20, Number(e.target.value))) })
                }
                className="acct-input text-xs font-mono-num"
              />
            </div>
            <div>
              <div className="text-[11px] font-medium mb-1">{cm.editorGroupBuyPriceLabel}</div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={draft.group_buy_price ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    group_buy_price: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="acct-input text-xs font-mono-num"
              />
            </div>
            <div>
              <div className="text-[11px] font-medium mb-1">{cm.editorGroupBuyHoursLabel}</div>
              <input
                type="number"
                min={1}
                max={168}
                value={draft.group_buy_hours ?? 24}
                onChange={(e) =>
                  setDraft({ ...draft, group_buy_hours: Math.max(1, Math.min(168, Number(e.target.value))) })
                }
                className="acct-input text-xs font-mono-num"
              />
            </div>
          </div>
        )}
      </div>

      {/* 5. 游客价 vs 会员价分离 & 卡密预选选号 */}
      <div
        className="rounded-2xl border p-4 space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="text-xs font-semibold flex items-center gap-1.5">
          <ListFilter className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {pc.editorMemberPriceHeading}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-medium mb-1">{pc.editorMemberPriceLabel}</div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.member_price ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  member_price: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className="acct-input text-xs font-mono-num"
            />
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1">{pc.editorCardSelectFeeLabel}</div>
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.card_select_fee ?? 0}
              onChange={(e) => setDraft({ ...draft, card_select_fee: Math.max(0, Number(e.target.value)) })}
              className="acct-input text-xs font-mono-num"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(draft.allow_card_selection)}
            onChange={(e) => setDraft({ ...draft, allow_card_selection: e.target.checked })}
          />
          <span>{pc.editorAllowCardSelectLabel}</span>
        </label>
      </div>
    </div>
  );
}
