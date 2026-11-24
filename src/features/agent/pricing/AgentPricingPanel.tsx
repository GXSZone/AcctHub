/**
 * 分站选品、多 SKU 自主定价与独立文案改写主面板（基于 TanStack Query v5）
 */

import { discountDisplay } from '@shared/domain/money';
import { ChevronsUpDown, Loader2, Save, Tag } from 'lucide-react';
import { PaginationBar } from '../../../components/ui/PaginationBar';
import { fmt } from '../../../i18n';
import { useAgentPricingI18n } from '../../../i18n/namespaces/agent-pricing';
import { AgentContentOverrideDrawer } from './AgentContentOverrideDrawer';
import { AgentPricingBatchBar } from './AgentPricingBatchBar';
import { AgentPricingProductCard } from './AgentPricingProductCard';
import { useAgentPricingState } from './useAgentPricingState';

interface AgentPricingPanelProps {
  tenantSlug?: string;
  storeName?: string;
}

export function AgentPricingPanel({ tenantSlug, storeName }: AgentPricingPanelProps = {}) {
  const ap = useAgentPricingI18n();
  const s = useAgentPricingState();

  return (
    <section className="space-y-4">
      <div className="paper-card rounded-2xl p-5 sm:p-6 space-y-4">
        <div
          className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="font-editorial text-xl font-semibold">{ap.panelTitle}</h2>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ap.panelDescPrefix}{' '}
              <strong>
                {fmt(ap.panelDescTier, {
                  name: s.tierName,
                  ...discountDisplay(s.discountRate),
                })}
              </strong>{' '}
              {ap.panelDescSuffix}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {s.dirtySpecList.length > 0 && (
              <button
                type="button"
                disabled={s.savingAllDirty}
                onClick={() => void s.handleSaveAllDirty()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {s.savingAllDirty ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {fmt(ap.saveAllChangesBtn, { count: s.dirtySpecList.length })}
              </button>
            )}
          </div>
        </div>

        <AgentPricingBatchBar
          batchScopeLabel={s.batchScopeLabel}
          totalItemsCount={s.items.length}
          listedCount={s.listedCount}
          hiddenCount={s.items.length - s.listedCount}
          batchTargetCount={s.batchTargetCount}
          listingFilter={s.listingFilter}
          query={s.query}
          batchMode={s.batchMode}
          batchValue={s.batchValue}
          batchRounding={s.batchRounding}
          batchApplying={s.batchApplying}
          onListingFilterChange={s.setListingFilter}
          onQueryChange={s.setQuery}
          onBatchModeChange={s.setBatchMode}
          onBatchValueChange={s.setBatchValue}
          onBatchRoundingChange={s.setBatchRounding}
          onBatchApply={() => void s.handleBatchApply()}
          onBatchReset={() => void s.handleBatchReset()}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs px-1">
          <label
            className="inline-flex items-center gap-2 cursor-pointer font-medium"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <input type="checkbox" checked={s.allFilteredSelected} onChange={s.toggleSelectAllFiltered} />
            <span>
              {fmt(ap.selectAllFiltered, {
                prodCount: s.filteredProducts.length,
                skuCount: s.filteredSpecEntries.length,
              })}
            </span>
          </label>
          <button
            type="button"
            onClick={s.toggleExpandAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
            style={{
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--ink-secondary)',
            }}
          >
            <ChevronsUpDown className="w-3.5 h-3.5" />
            {s.anyExpanded ? ap.collapseAllSpecs : ap.expandAllSpecs}
          </button>
        </div>

        {s.pricingQuery.isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : s.filteredProducts.length === 0 ? (
          <div
            className="py-12 text-center text-xs rounded-xl border"
            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
          >
            {ap.noMatchingProducts}
          </div>
        ) : (
          <div className="space-y-3">
            {s.pagedProducts.map((p) => (
              <AgentPricingProductCard
                key={p.product_id}
                product={p}
                isExpanded={s.expandedIds.has(p.product_id)}
                selectedKeys={s.selectedKeys}
                drafts={s.drafts}
                savingKey={s.savingKey}
                savingProductId={s.savingProductId}
                togglingProductId={s.togglingProductId}
                onToggleExpand={() =>
                  s.setExpandedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.product_id)) next.delete(p.product_id);
                    else next.add(p.product_id);
                    return next;
                  })
                }
                onToggleSelectProduct={() => s.toggleSelectProduct(p)}
                onToggleSelectSpec={(key) =>
                  s.setSelectedKeys((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onDraftChange={(key, val) => s.setDrafts((prev) => ({ ...prev, [key]: val }))}
                onSaveSpec={(specId) => void s.handleSaveSpec(p.product_id, specId)}
                onResetSpec={(specId) => void s.handleResetSpec(p.product_id, specId)}
                onSaveProductDirty={() => void s.handleSaveProductDirty(p)}
                onOpenContentDrawer={() => s.setEditingProd(p)}
                onToggleListing={() => void s.handleToggleListing(p)}
              />
            ))}
            <PaginationBar
              page={s.page}
              totalPages={s.totalPages}
              totalItems={s.filteredProducts.length}
              onPageChange={s.setPage}
            />
          </div>
        )}
      </div>

      <AgentContentOverrideDrawer
        product={s.editingProd}
        drafts={s.drafts}
        tenantSlug={tenantSlug}
        storeName={storeName}
        onClose={() => s.setEditingProd(null)}
        onSaved={async (msg) => {
          await s.pricingQuery.refetch();
          s.showToast(msg);
        }}
        onError={s.setError}
      />
    </section>
  );
}
