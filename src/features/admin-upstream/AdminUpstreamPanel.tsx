/**
 * 上游直采与多源智能路由中枢主面板（基于 TanStack Query v5，仅总管理员可见）
 */

import {
  ArrowRightLeft,
  FileText,
  GitBranch,
  Loader2,
  PlugZap,
  Plus,
  Server,
  ShieldAlert,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type UpstreamItemRecord, type UpstreamSourceRecord, upstreamApi } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import {
  useUpstreamBindingsQuery,
  useUpstreamItemsQuery,
  useUpstreamLedgerQuery,
  useUpstreamSourcesQuery,
} from '../../queries/admin.queries';
import { UpstreamBindingsTable } from './UpstreamBindingsTable';
import { type AdminProductBrief, UpstreamBindSkuCard } from './UpstreamBindSkuCard';
import { UpstreamItemsTable } from './UpstreamItemsTable';
import { UpstreamJsonDrawer } from './UpstreamJsonDrawer';
import { UpstreamLedgerTab } from './UpstreamLedgerTab';
import { UpstreamLogsTab } from './UpstreamLogsTab';
import { UpstreamSourceDrawer } from './UpstreamSourceDrawer';
import { UpstreamSourcesTab } from './UpstreamSourcesTab';

interface AdminUpstreamPanelProps {
  categories: Array<{ id: number; name: string }>;
  products?: AdminProductBrief[];
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

type PanelView = 'sources' | 'catalog' | 'ledger' | 'logs';

export function AdminUpstreamPanel({
  categories,
  products = [],
  onStorefrontUpdated,
  showToast,
}: AdminUpstreamPanelProps) {
  const au = useAdminUpstreamI18n();
  const [view, setView] = useState<PanelView>('sources');
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [inspectItem, setInspectItem] = useState<UpstreamItemRecord | null>(null);
  const [bindModalItem, setBindModalItem] = useState<UpstreamItemRecord | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<number | 'new' | null>(null);
  const [editingSourceMeta, setEditingSourceMeta] = useState<UpstreamSourceRecord | null>(null);

  const sourcesQuery = useUpstreamSourcesQuery(true);
  const bindingsQuery = useUpstreamBindingsQuery(undefined, true);
  const itemsQuery = useUpstreamItemsQuery(selectedSourceId);
  const ledgerQuery = useUpstreamLedgerQuery(true);

  const sources = sourcesQuery.data?.sources ?? [];
  const logs = sourcesQuery.data?.logs ?? [];
  const summary = sourcesQuery.data?.summary ?? { pending_orders: 0, failed_orders: 0 };
  const bindings = bindingsQuery.data?.bindings ?? [];
  const items = itemsQuery.data?.items ?? [];

  useEffect(() => {
    if (sources.length === 0) {
      setSelectedSourceId(null);
      return;
    }
    if (!selectedSourceId || !sources.some((s) => s.id === selectedSourceId)) {
      setSelectedSourceId(sources[0].id);
    }
  }, [sources, selectedSourceId]);

  const reloadSourcesAndBindings = async () => {
    await Promise.all([sourcesQuery.refetch(), bindingsQuery.refetch()]);
  };

  const reloadAll = async () => {
    await Promise.all([
      sourcesQuery.refetch(),
      bindingsQuery.refetch(),
      ledgerQuery.refetch(),
      selectedSourceId ? itemsQuery.refetch() : Promise.resolve(),
    ]);
  };

  const handleSyncSource = async (src: UpstreamSourceRecord) => {
    setSyncingId(src.id);
    try {
      const res = await upstreamApi.syncSource(src.id);
      showToast(
        res.alerts?.length
          ? `${res.message}${fmt(au.syncAlertsSuffix, { count: res.alerts.length })}`
          : res.message
      );
      setSelectedSourceId(src.id);
      await reloadAll();
      onStorefrontUpdated();
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.syncFailedFallback);
    } finally {
      setSyncingId(null);
    }
  };

  if (sourcesQuery.isLoading && sources.length === 0) {
    return (
      <div className="paper-card rounded-2xl p-12 flex items-center justify-center gap-2 text-xs">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
        {au.loadingText}
      </div>
    );
  }

  if (sourcesQuery.error) {
    return (
      <div
        className="paper-card rounded-2xl p-6 border flex items-start gap-3 text-xs"
        style={{
          borderColor: 'var(--danger)',
          backgroundColor: 'var(--danger-soft)',
          color: 'var(--danger)',
        }}
      >
        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-sm">{au.errTitle}</div>
          <p className="mt-1">
            {sourcesQuery.error instanceof Error ? sourcesQuery.error.message : au.errFallback}
          </p>
        </div>
      </div>
    );
  }

  const totalExceptions = summary.pending_orders + summary.failed_orders;

  return (
    <div className="space-y-5">
      <div
        className="paper-card rounded-2xl p-5 border flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        style={{
          borderColor: 'color-mix(in srgb, var(--accent) 28%, var(--border-color))',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <PlugZap className="w-3.5 h-3.5" />
              {au.heroBadge}
            </span>
            <span className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
              {au.heroSub}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {(
              [
                { id: 'sources', label: fmt(au.tabSources, { count: sources.length }), icon: Server },
                { id: 'catalog', label: fmt(au.tabCatalog, { count: bindings.length }), icon: GitBranch },
                {
                  id: 'ledger',
                  label: `${au.tabLedger}${totalExceptions > 0 ? ` (${totalExceptions})` : ''}`,
                  icon: ArrowRightLeft,
                  alert: totalExceptions > 0,
                },
                { id: 'logs', label: fmt(au.tabLogs, { count: logs.length }), icon: FileText },
              ] as Array<{
                id: PanelView;
                label: string;
                icon: React.ComponentType<{ className?: string }>;
                alert?: boolean;
              }>
            ).map((t) => {
              const Icon = t.icon;
              const active = view === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setView(t.id);
                    if (t.id === 'ledger') void ledgerQuery.refetch();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active
                      ? 'var(--accent)'
                      : t.alert
                        ? 'var(--danger-soft)'
                        : 'var(--bg-canvas)',
                    color: active ? '#FAF9F5' : t.alert ? 'var(--danger)' : 'var(--ink-secondary)',
                    border: `1px solid ${active ? 'transparent' : t.alert ? 'var(--danger)' : 'var(--border-color)'}`,
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingSourceMeta(null);
            setEditingSourceId('new');
          }}
          className="h-9 inline-flex items-center justify-center gap-1.5 px-4 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Plus className="w-4 h-4" />
          {au.addSourceBtn}
        </button>
      </div>

      {view === 'sources' && (
        <UpstreamSourcesTab
          sources={sources}
          syncingId={syncingId}
          onEditSource={(src) => {
            setEditingSourceMeta(src);
            setEditingSourceId(src.id);
          }}
          onSyncSource={handleSyncSource}
          onReloadSources={reloadSourcesAndBindings}
          showToast={showToast}
        />
      )}

      {view === 'catalog' && (
        <div className="space-y-6">
          <UpstreamBindingsTable
            bindings={bindings}
            onReloadAll={reloadAll}
            onStorefrontUpdated={onStorefrontUpdated}
            showToast={showToast}
          />

          <UpstreamItemsTable
            sources={sources}
            selectedSourceId={selectedSourceId}
            items={items}
            itemsLoading={itemsQuery.isLoading}
            syncingId={syncingId}
            hasLocalProducts={products.length > 0}
            onSelectSource={setSelectedSourceId}
            onSyncSource={handleSyncSource}
            onInspectItem={setInspectItem}
            onOpenBindModal={setBindModalItem}
            onReloadAfterItemUpdate={reloadAll}
            onStorefrontUpdated={onStorefrontUpdated}
            showToast={showToast}
          />

          <UpstreamBindSkuCard
            item={bindModalItem}
            products={products}
            onClose={() => setBindModalItem(null)}
            onBound={reloadSourcesAndBindings}
            onStorefrontUpdated={onStorefrontUpdated}
            showToast={showToast}
          />
        </div>
      )}

      {view === 'ledger' && (
        <UpstreamLedgerTab
          profitSummary={
            ledgerQuery.data?.profit_summary ?? {
              delivered_count: 0,
              gross_revenue: 0,
              total_commission: 0,
              total_upstream_cost: 0,
              net_profit: 0,
            }
          }
          exceptionOrders={ledgerQuery.data?.exception_orders ?? []}
          upOrders={ledgerQuery.data?.upstream_orders ?? []}
          sources={sources}
          ledgerLoading={ledgerQuery.isFetching}
          onRefresh={reloadAll}
          showToast={showToast}
        />
      )}

      {view === 'logs' && <UpstreamLogsTab logs={logs} />}

      <UpstreamSourceDrawer
        editingSourceId={editingSourceId}
        editingSourceMeta={editingSourceMeta}
        categories={categories}
        onClose={() => setEditingSourceId(null)}
        onSaved={async (targetId) => {
          setSelectedSourceId(targetId);
          await reloadAll();
        }}
        onStorefrontUpdated={onStorefrontUpdated}
        showToast={showToast}
      />

      <UpstreamJsonDrawer inspectItem={inspectItem} onClose={() => setInspectItem(null)} />
    </div>
  );
}
