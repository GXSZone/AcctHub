import type { PublicGroupBuySessionDto } from '@shared/contracts/commerce.contract';
import type { GroupBuyConfigSnapshot } from '@shared/domain/commerce-modes';
import { Copy, PackageCheck, Users } from 'lucide-react';
import { fmt } from '../../i18n';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';
import { useDisplayCurrency } from '../../lib/currency';
import { toast } from '../../lib/toast';

export interface ProductBundleDisplayItem {
  product_id: number;
  spec_id: string;
  quantity: number;
  title: string;
  available_stock: number;
}

export function BundleItemsBox({ items }: { items?: ProductBundleDisplayItem[] }) {
  const cm = useCommerceI18n();
  if (!items || items.length === 0) return null;

  return (
    <div
      className="mt-5 p-4 rounded-2xl border space-y-3"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-start gap-2">
        <PackageCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div>
          <div className="text-xs font-semibold">{cm.bundleCardTitle}</div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {cm.bundleCardDesc}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={`${item.product_id}:${item.spec_id}`}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
          >
            <div className="min-w-0">
              <span className="font-medium truncate block">{item.title}</span>
              <span className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                #{item.product_id} · {item.spec_id}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0 font-mono-num">
              <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                {fmt(cm.bundleItemQty, { qty: item.quantity })}
              </span>
              <span
                className="text-[10.5px] px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor:
                    item.available_stock >= item.quantity ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: item.available_stock >= item.quantity ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {fmt(cm.bundleItemStock, { stock: item.available_stock })}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GroupBuySelectorProps {
  config?: GroupBuyConfigSnapshot;
  openSessions: PublicGroupBuySessionDto[];
  mode: 'regular' | 'start' | 'join';
  selectedCode: string;
  isSignedIn: boolean;
  onSelectMode: (mode: 'regular' | 'start' | 'join', code?: string) => void;
}

export function GroupBuySelector({
  config,
  openSessions,
  mode,
  selectedCode,
  isSignedIn,
  onSelectMode,
}: GroupBuySelectorProps) {
  const cm = useCommerceI18n();
  const { formatMoneyFixed } = useDisplayCurrency();
  if (!config?.enabled || !config.price) return null;

  const copyShareLink = async (code: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('gb', code);
      await navigator.clipboard.writeText(url.toString());
      toast.success(cm.groupBuyCopiedLinkToast);
    } catch {
      // 忽略无剪贴板环境
    }
  };

  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-start gap-2">
        <Users className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div>
          <div className="text-xs font-semibold">{cm.groupBuyCardTitle}</div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            {fmt(cm.groupBuyCardDesc, {
              size: config.size,
              price: formatMoneyFixed(config.price),
              hours: config.hours,
            })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onSelectMode('regular')}
          className="px-3 py-2 rounded-xl border text-xs font-medium cursor-pointer text-center"
          style={{
            borderColor: mode === 'regular' ? 'var(--accent)' : 'var(--border-color)',
            backgroundColor: mode === 'regular' ? 'var(--accent-soft)' : 'var(--bg-surface)',
            color: mode === 'regular' ? 'var(--accent)' : 'var(--ink-primary)',
          }}
        >
          {cm.groupBuyModeRegular}
        </button>
        <button
          type="button"
          onClick={() => onSelectMode('start')}
          className="px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer text-center"
          style={{
            borderColor: mode === 'start' ? 'var(--accent)' : 'var(--border-color)',
            backgroundColor: mode === 'start' ? 'var(--accent-soft)' : 'var(--bg-surface)',
            color: mode === 'start' ? 'var(--accent)' : 'var(--ink-primary)',
          }}
        >
          {fmt(cm.groupBuyModeStart, { price: formatMoneyFixed(config.price) })}
        </button>
      </div>

      {!isSignedIn && mode !== 'regular' && (
        <div className="text-[11px]" style={{ color: 'var(--warning)' }}>
          {cm.groupBuyLoginHint}
        </div>
      )}

      <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--ink-secondary)' }}>
          {cm.groupBuyOpenListTitle}
        </div>
        {openSessions.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {cm.groupBuyOpenEmpty}
          </p>
        ) : (
          <div className="space-y-1.5">
            {openSessions.map((s) => {
              const isSelected = mode === 'join' && selectedCode === s.code;
              return (
                <div
                  key={s.code}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs"
                  style={{
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border-color)',
                    backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                  }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {s.leader_name} · <span className="font-mono-num">#{s.code}</span>
                    </div>
                    <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(cm.groupBuySlotsLeft, { left: s.remaining_slots })} ({s.current_size}/
                      {s.required_size})
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void copyShareLink(s.code)}
                      className="p-1.5 rounded-lg border cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                      title={cm.groupBuyCopyLinkBtn}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectMode('join', s.code)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                      style={{
                        backgroundColor: isSelected ? 'var(--success)' : 'var(--accent)',
                        color: '#FAF9F5',
                      }}
                    >
                      {isSelected ? cm.groupBuySelectedBadge : cm.groupBuyJoinBtn}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
