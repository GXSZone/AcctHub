/**
 * 上游货源原始商品目录浏览、锁价保护与一键采纳上架列表
 */

import { Eye, EyeOff, Loader2, Lock, PackageX, RefreshCw, Search, Unlock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type UpstreamItemRecord, type UpstreamSourceRecord, upstreamApi } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import { previewCalculatedPrice } from './upstream-constants';

interface UpstreamItemsTableProps {
  sources: UpstreamSourceRecord[];
  selectedSourceId: number | null;
  items: UpstreamItemRecord[];
  itemsLoading: boolean;
  syncingId: number | null;
  hasLocalProducts: boolean;
  onSelectSource: (id: number) => void;
  onSyncSource: (src: UpstreamSourceRecord) => Promise<void>;
  onInspectItem: (item: UpstreamItemRecord) => void;
  onOpenBindModal: (item: UpstreamItemRecord) => void;
  onReloadAfterItemUpdate: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function UpstreamItemsTable({
  sources,
  selectedSourceId,
  items,
  itemsLoading,
  syncingId,
  hasLocalProducts,
  onSelectSource,
  onSyncSource,
  onInspectItem,
  onOpenBindModal,
  onReloadAfterItemUpdate,
  onStorefrontUpdated,
  showToast,
}: UpstreamItemsTableProps) {
  const au = useAdminUpstreamI18n();
  const [itemFilter, setItemFilter] = useState<'all' | 'pending' | 'collected' | 'ignored' | 'sold_out'>(
    'all'
  );
  const [itemQuery, setItemQuery] = useState('');
  const [busyItemId, setBusyItemId] = useState<number | null>(null);

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (itemFilter === 'pending' && item.collect_status !== 'pending') return false;
      if (itemFilter === 'collected' && item.collect_status !== 'collected') return false;
      if (itemFilter === 'ignored' && item.collect_status !== 'ignored') return false;
      if (itemFilter === 'sold_out' && !(item.raw_stock <= 0 || item.raw_status !== 'active')) return false;
      if (
        q &&
        !`${item.upstream_item_id} ${item.raw_title} ${item.raw_category} ${item.local_title || ''}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, itemFilter, itemQuery]);

  const handleItemUpdate = async (
    item: UpstreamItemRecord,
    patch: {
      action?: 'collect' | 'ignore' | 'reset_pending';
      target_category_id?: number;
      lock_local_price?: boolean;
      lock_local_content?: boolean;
      fulfillment_mode?: 'upstream_only' | 'local_first';
    },
    successMsg: string
  ) => {
    setBusyItemId(item.id);
    try {
      const res = await upstreamApi.updateItem(item.id, patch);
      if (res.alerts && res.alerts.length > 0) showToast(res.alerts[0]);
      else showToast(successMsg);
      await onReloadAfterItemUpdate();
      onStorefrontUpdated();
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.opFailedFallback);
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="paper-card rounded-2xl p-5 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedSourceId || ''}
            onChange={(e) => onSelectSource(Number(e.target.value))}
            className="acct-input h-9 py-0 text-xs w-auto min-w-[220px]"
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {fmt(au.sourceItemOption, { name: s.name, count: s.total_items })}
              </option>
            ))}
          </select>
          {selectedSource && (
            <button
              type="button"
              disabled={syncingId === selectedSource.id}
              onClick={() => void onSyncSource(selectedSource)}
              className="h-9 inline-flex items-center gap-1 px-3 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingId === selectedSource.id ? 'animate-spin' : ''}`} />
              {au.refreshCatalogBtn}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
              placeholder={au.searchItemPlaceholder}
              className="acct-input h-8 pl-8 pr-2.5 py-0 text-xs w-44"
            />
          </div>
          {(
            [
              { id: 'all', label: au.filterAll },
              { id: 'pending', label: au.filterPending },
              { id: 'collected', label: au.filterCollected },
              { id: 'sold_out', label: au.filterSoldOut },
              { id: 'ignored', label: au.filterIgnored },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setItemFilter(f.id)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer"
              style={{
                backgroundColor: itemFilter === f.id ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                color: itemFilter === f.id ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {itemsLoading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" />
          {au.itemsLoading}
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
          {au.itemsEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-3">{au.colUpItemSpecs}</th>
                <th className="py-2 pr-3">{au.colCostToPrice}</th>
                <th className="py-2 pr-3">{au.colUpStock}</th>
                <th className="py-2 pr-3">{au.colProtectionLock}</th>
                <th className="py-2 text-right">{au.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const estSell = previewCalculatedPrice(item.raw_price, selectedSource?.pricing_rules);
                const isOos = item.raw_stock <= 0 || item.raw_status !== 'active';
                return (
                  <tr
                    key={item.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <td className="py-2.5 pr-3 max-w-md">
                      <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                        <span>{item.raw_title}</span>
                        {item.raw_specs && item.raw_specs.length > 0 && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-mono-num"
                            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {fmt(au.specsCountBadge, { count: item.raw_specs.length })}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {item.upstream_item_id} · {item.raw_category}
                        {item.local_product_id
                          ? fmt(au.linkedLocalSuffix, { id: item.local_product_id })
                          : ''}
                      </div>
                      {item.raw_specs && item.raw_specs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {item.raw_specs.map((sp) => (
                            <span
                              key={sp.id}
                              className="text-[10px] px-1.5 py-0.5 rounded font-mono-num"
                              style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-secondary)' }}
                            >
                              {sp.name}: ¥{sp.price} ({sp.stock ?? '-'})
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 font-mono-num whitespace-nowrap">
                      <div>
                        {fmt(au.costPrefix, { price: item.raw_price })}
                        <strong style={{ color: 'var(--accent)' }}>¥{item.local_price ?? estSell}</strong>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 font-mono-num whitespace-nowrap">
                      {isOos ? (
                        <span className="inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                          <PackageX className="w-3.5 h-3.5" /> {au.stockOut}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--success)' }}>{item.raw_stock}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busyItemId === item.id}
                        onClick={() =>
                          void handleItemUpdate(
                            item,
                            { lock_local_price: !item.lock_local_price },
                            item.lock_local_price ? au.unlockPriceToast : au.lockPriceToast
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] cursor-pointer"
                        style={{
                          backgroundColor: item.lock_local_price ? 'var(--warning-soft)' : 'var(--bg-canvas)',
                          color: item.lock_local_price ? 'var(--warning)' : 'var(--ink-muted)',
                        }}
                        title={au.lockPriceTooltip}
                      >
                        {item.lock_local_price ? (
                          <Lock className="w-3 h-3" />
                        ) : (
                          <Unlock className="w-3 h-3" />
                        )}
                        {item.lock_local_price ? au.lockedBadge : au.followPriceBadge}
                      </button>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap space-x-1">
                      <button
                        type="button"
                        onClick={() => onInspectItem(item)}
                        className="p-1.5 rounded-lg border cursor-pointer align-middle"
                        style={{ borderColor: 'var(--border-color)' }}
                        title={au.inspectJsonTooltip}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {hasLocalProducts && (
                        <button
                          type="button"
                          onClick={() => onOpenBindModal(item)}
                          className="px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                          style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
                        >
                          {au.bindExistingSkuBtn}
                        </button>
                      )}
                      {item.collect_status !== 'collected' ? (
                        <button
                          type="button"
                          disabled={busyItemId === item.id}
                          onClick={() =>
                            void handleItemUpdate(
                              item,
                              { action: 'collect' },
                              fmt(au.adoptSuccessToast, { title: item.raw_title })
                            )
                          }
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer"
                          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                        >
                          {au.adoptBtn}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyItemId === item.id}
                          onClick={() =>
                            void handleItemUpdate(
                              item,
                              { action: 'ignore' },
                              fmt(au.ignoreSuccessToast, { title: item.raw_title })
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] cursor-pointer"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                        >
                          <EyeOff className="w-3 h-3" />
                          {au.ignoreBtn}
                        </button>
                      )}
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
