/**
 * 总控后台商品与卡密管理标签页
 */

import { AlertTriangle, ExternalLink, KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { BrandBadge } from '../../components/BrandIcon';
import { openConfirm } from '../../components/ConfirmDialog';
import { formatWarrantyTypeShort } from '../../components/TicketOrderCard';
import { PaginationBar } from '../../components/ui/PaginationBar';
import { fmt } from '../../i18n';
import { useAdminCatalogI18n } from '../../i18n/namespaces/admin-catalog';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { AdminCardLookupModal } from './AdminCardLookupModal';
import type { AdminProductRow } from './admin.types';

interface AdminProductsTabProps {
  products: AdminProductRow[];
  categories: Array<{ id: number; name: string }>;
  lowestAgentTier: { name: string; discount_rate: number };
  prodSearch: string;
  prodCatFilter: number;
  onSearchChange: (v: string) => void;
  onCatFilterChange: (id: number) => void;
  onCreateProduct: () => void;
  onEditProduct: (p: AdminProductRow) => void;
  onOpenCardVault: (p: { id: number; title: string; specs: Array<{ id: string; name: string }> }) => void;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function AdminProductsTab({
  products,
  categories,
  lowestAgentTier,
  prodSearch,
  prodCatFilter,
  onSearchChange,
  onCatFilterChange,
  onCreateProduct,
  onEditProduct,
  onOpenCardVault,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminProductsTabProps) {
  const act = useAdminCatalogI18n();
  const rf = useRiskControlI18n();
  const [lookupOpen, setLookupOpen] = useState(false);
  const filterKey = `${prodSearch}|${prodCatFilter}`;
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  const PAGE_SIZE = 12;
  const catNameMap = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (prodCatFilter && p.category_id !== prodCatFilter) return false;
      if (q && !`${p.title} ${p.subtitle} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [products, prodSearch, prodCatFilter]);

  const currentPage = pageState.key === filterKey ? pageState.page : 1;
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const setPage = (nextPage: number) => setPageState({ key: filterKey, page: nextPage });
  const pagedProducts = useMemo(
    () => filteredProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredProducts, safePage]
  );

  return (
    <div className="paper-card rounded-2xl overflow-hidden">
      <div
        className="p-5 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 min-w-0">
          <div className="relative w-full sm:w-72">
            <Search
              className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              type="text"
              value={prodSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={act.prodSearchPlaceholder}
              className="acct-input h-9 pl-9 pr-3 py-0 text-xs"
            />
          </div>
          <select
            value={prodCatFilter}
            onChange={(e) => onCatFilterChange(Number(e.target.value))}
            className="acct-input h-9 w-full sm:w-48 px-3 py-0 text-xs shrink-0"
          >
            <option value={0}>{fmt(act.prodAllCategoriesOpt, { count: products.length })}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setLookupOpen(true)}
            className="h-9 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-xl border text-xs font-medium cursor-pointer whitespace-nowrap"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Search className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {rf.cardLookupOpenBtn}
          </button>
          <button
            type="button"
            onClick={onCreateProduct}
            className="h-9 inline-flex items-center justify-center gap-1.5 px-4 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Plus className="w-4 h-4" />
            {act.prodCreateBtn}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr
              className="border-b"
              style={{
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--bg-canvas)',
                color: 'var(--ink-muted)',
              }}
            >
              <th className="py-3 pl-5 pr-4">{act.prodColTitleCat}</th>
              <th className="py-3 pr-4 whitespace-nowrap">{act.prodColPriceSpecs}</th>
              <th className="py-3 pr-4 whitespace-nowrap">{act.prodColStock}</th>
              <th className="py-3 pr-4 whitespace-nowrap">{act.prodColStatus}</th>
              <th className="py-3 pr-5 text-right whitespace-nowrap">{act.prodColActions}</th>
            </tr>
          </thead>
          <tbody>
            {pagedProducts.map((p) => {
              const cost = Number(p.cost_price ?? p.upstream_cost ?? 0);
              const minAgentPrice = Number((p.base_price * lowestAgentTier.discount_rate).toFixed(2));
              const isLoss = cost > 0 && minAgentPrice + 0.001 < cost;
              return (
                <tr
                  key={p.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-3.5 pl-5 pr-4 max-w-md">
                    <div className="flex items-center gap-3 min-w-0">
                      <BrandBadge icon={p.icon_key} accentColor={p.accent_color} size="sm" />
                      <div className="min-w-0">
                        <div className="font-semibold text-[13px] truncate">{p.title}</div>
                        <div
                          className="flex items-center gap-2 mt-1 text-[11px] flex-wrap"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          <span
                            className="px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--bg-subtle)' }}
                          >
                            {catNameMap.get(p.category_id) || act.prodUncategorized}
                          </span>
                          <span
                            className="px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor:
                                p.warranty_type === 'none' ? 'var(--bg-subtle)' : 'var(--success-soft)',
                              color: p.warranty_type === 'none' ? 'var(--ink-muted)' : 'var(--success)',
                            }}
                          >
                            {formatWarrantyTypeShort(p.warranty_type, p.warranty_days)}
                          </span>
                          <span>{fmt(act.prodSoldCount, { count: p.sales_count })}</span>
                          <span>{fmt(act.prodSortOrder, { order: p.sort_order })}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3.5 pr-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono-num font-semibold text-sm">¥{p.base_price}</span>
                      {cost > 0 &&
                        (isLoss ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10.5px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                            title={fmt(act.prodLossWarnTitle, {
                              tierName: lowestAgentTier.name,
                              agentPrice: minAgentPrice,
                              cost,
                            })}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {fmt(act.prodLossBadge, { loss: (cost - minAgentPrice).toFixed(2) })}
                          </span>
                        ) : (
                          <span className="font-mono-num text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {fmt(act.prodCostLabel, { cost })}
                          </span>
                        ))}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(act.prodSpecsMeta, { count: p.specs.length })}
                    </div>
                  </td>
                  <td className="py-3.5 pr-4 whitespace-nowrap font-mono-num">
                    <div>
                      {p.stock_mode === 'cards'
                        ? fmt(act.prodStockCards, { count: p.available_cards })
                        : p.stock_mode === 'seats'
                          ? fmt(act.prodStockSeats, {
                              avail: Math.max(0, p.seat_total - p.seat_used),
                              total: p.seat_total,
                            })
                          : fmt(act.prodStockManual, { count: p.manual_stock })}
                    </div>
                    {Number(p.upstream_binding_count || 0) > 0 && (
                      <div className="text-[10.5px] font-medium mt-0.5" style={{ color: 'var(--accent)' }}>
                        {fmt(act.prodUpstreamRouteMeta, {
                          stock: p.upstream_cached_stock || 0,
                          sources: Number(p.upstream_binding_count),
                        })}
                      </div>
                    )}
                    {Number(p.restock_waiting || 0) > 0 && (
                      <div className="text-[10.5px] font-medium mt-0.5" style={{ color: 'var(--warning)' }}>
                        {fmt(act.prodRestockWaiting, { count: Number(p.restock_waiting) })}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 pr-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.updateProduct(p.id, { is_featured: p.is_featured ? 0 : 1 });
                        await onReload();
                        onStorefrontUpdated();
                        showToast(act.prodFeaturedSyncedToast);
                      }}
                      className="px-2.5 py-1 rounded-full mr-1.5 cursor-pointer font-medium"
                      style={{
                        backgroundColor: p.is_featured ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        color: p.is_featured ? 'var(--accent)' : 'var(--ink-muted)',
                      }}
                    >
                      {p.is_featured ? act.prodFeaturedLabel : act.prodNormalLabel}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await adminApi.updateProduct(p.id, { is_active: p.is_active ? 0 : 1 });
                        await onReload();
                        onStorefrontUpdated();
                        showToast(act.prodActiveSyncedToast);
                      }}
                      className="px-2.5 py-1 rounded-full cursor-pointer font-medium"
                      style={{
                        backgroundColor: p.is_active ? 'var(--success-soft)' : 'var(--danger-soft)',
                        color: p.is_active ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      {p.is_active ? act.prodActiveLabel : act.prodInactiveLabel}
                    </button>
                  </td>
                  <td className="py-3.5 pr-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onEditProduct(p)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {act.prodEditBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenCardVault({ id: p.id, title: p.title, specs: p.specs })}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                        style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        {act.prodCardsBtn}
                      </button>
                      <a
                        href={`/item/${p.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-lg border inline-flex items-center justify-center"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                        title={act.prodPreviewLinkTitle}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await openConfirm({
                            title: act.prodDeleteTitle,
                            description: fmt(act.prodDeleteDesc, { title: p.title }),
                            confirmLabel: act.prodDeleteConfirm,
                            tone: 'danger',
                          });
                          if (!ok) return;
                          await adminApi.deleteProduct(p.id);
                          await onReload();
                          onStorefrontUpdated();
                          showToast(act.prodDeletedToast);
                        }}
                        className="p-1.5 rounded-lg cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                        title={act.prodDeleteTitleAttr}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 pb-4">
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          totalItems={filteredProducts.length}
          onPageChange={setPage}
        />
      </div>
      <AdminCardLookupModal open={lookupOpen} onClose={() => setLookupOpen(false)} showToast={showToast} />
    </div>
  );
}
