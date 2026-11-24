/**
 * AcctHub 运营总控后台主壳容器（基于分域 API + 懒加载按需代码分割）
 */

import { Loader2, Menu } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { adminApi } from '../../api/admin.api';
import { AdminOverviewDashboard } from '../../components/AdminOverviewDashboard';
import { NotFoundView } from '../../components/NotFoundView';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { toast } from '../../lib/toast';
import { useAdminOverviewQuery } from '../../queries/admin.queries';
import type { UserProfile } from '../../types';
import type { EditableProduct } from '../admin-catalog/product-editor/product-editor.types';
import type { NoticeSubTab } from '../admin-notice/AdminNoticeCenter';
import { AdminMarketingPanel, AdminTicketsPanel } from '../admin-ops';
import { type AdminAgentsSubTab, AdminAgentsTab } from './AdminAgentsTab';
import { AdminOrdersTab } from './AdminOrdersTab';
import { AdminProductsTab } from './AdminProductsTab';
import { AdminSettingsTab } from './AdminSettingsTab';
import { AdminSidebar } from './AdminSidebar';
import { type AdminOverview, type AdminTab, buildNewProductDraft, toEditableProduct } from './admin.types';
import { buildAdminNavGroups } from './admin-nav';

const AdminAiPanel = lazy(() =>
  import('../admin-ai/AdminAiPanel').then((m) => ({ default: m.AdminAiPanel }))
);
const AdminAuditTab = lazy(() => import('./AdminAuditTab').then((m) => ({ default: m.AdminAuditTab })));
const AdminCategoryManager = lazy(() =>
  import('../admin-catalog/category/AdminCategoryManager').then((m) => ({
    default: m.AdminCategoryManager,
  }))
);
const AdminFinancePanel = lazy(() =>
  import('../../components/AdminFinancePanel').then((m) => ({ default: m.AdminFinancePanel }))
);
const AdminMembersTab = lazy(() => import('./AdminMembersTab').then((m) => ({ default: m.AdminMembersTab })));
const AdminNoticeCenter = lazy(() =>
  import('../admin-notice/AdminNoticeCenter').then((m) => ({ default: m.AdminNoticeCenter }))
);
const AdminUpstreamPanel = lazy(() =>
  import('../admin-upstream/AdminUpstreamPanel').then((m) => ({ default: m.AdminUpstreamPanel }))
);
const CardVaultModal = lazy(() =>
  import('../../components/CardVaultModal').then((m) => ({ default: m.CardVaultModal }))
);
const ProductEditorDrawer = lazy(() =>
  import('../admin-catalog/product-editor/ProductEditorDrawer').then((m) => ({
    default: m.ProductEditorDrawer,
  }))
);

export function AdminPage({
  user,
  onStorefrontUpdated,
}: {
  user: UserProfile | null;
  onOpenAuth?: () => void;
  onStorefrontUpdated: () => void;
}) {
  const ac = useAdminCoreI18n();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [agentsInitialSubTab, setAgentsInitialSubTab] = useState<AdminAgentsSubTab>('list');
  const [noticeInitialSubTab, setNoticeInitialSubTab] = useState<NoticeSubTab>('ticker');
  const [settingsInitialSubTab, setSettingsInitialSubTab] = useState<'brand' | 'risk'>('brand');
  const [ordersInitialStatus, setOrdersInitialStatus] = useState<string>('all');
  const [isTabPending, startTabTransition] = useTransition();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [prodSearch, setProdSearch] = useState('');
  const [prodCatFilter, setProdCatFilter] = useState<number>(0);
  const [editorProduct, setEditorProduct] = useState<EditableProduct | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [cardModalProduct, setCardModalProduct] = useState<{
    id: number;
    title: string;
    specs: Array<{ id: string; name: string }>;
  } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, string>>({});

  const isSuperAdmin = user?.role === 'admin';
  const overviewQuery = useAdminOverviewQuery(isSuperAdmin);
  const data = (overviewQuery.data ?? null) as AdminOverview | null;
  const authorized = isSuperAdmin && Boolean(data) && !overviewQuery.isError;
  const loading = isSuperAdmin && (overviewQuery.isPending || (overviewQuery.isFetching && !data));

  const switchTab = useCallback((nextTab: AdminTab) => {
    startTabTransition(() => {
      if (nextTab === 'help') {
        setNoticeInitialSubTab('help');
        setTab('announcements');
      } else {
        if (nextTab === 'agents') setAgentsInitialSubTab('list');
        if (nextTab === 'announcements') setNoticeInitialSubTab('ticker');
        setTab(nextTab);
      }
    });
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const showToast = useCallback((msg: string) => {
    toast.auto(msg);
  }, []);

  const { refetch: refetchOverview } = overviewQuery;
  const loadOverview = useCallback(async () => {
    await refetchOverview();
  }, [refetchOverview]);

  useEffect(() => {
    if (data?.settings) {
      setSettingsDraft(data.settings);
    }
  }, [data?.settings]);

  const userRole = user?.role;

  useEffect(() => {
    if (userRole !== 'admin' && (tab === 'upstreams' || tab === 'ai')) {
      setTab('products');
    }
  }, [userRole, tab]);

  const lowestAgentTier = useMemo(() => {
    const tiers = data?.agent_tiers || [];
    if (tiers.length === 0) return { name: ac.pageLowestTierFallback, discount_rate: 0.72 };
    return [...tiers].sort((a, b) => a.discount_rate - b.discount_rate)[0];
  }, [data?.agent_tiers, ac.pageLowestTierFallback]);

  const openCreateProduct = () => {
    setEditorProduct(buildNewProductDraft(data?.categories[0]?.id || 1, ac));
    setEditorOpen(true);
  };

  const handleSaveProduct = async (draft: EditableProduct) => {
    const payload = draft as unknown as Record<string, unknown>;
    if (draft.id) {
      await adminApi.updateProduct(draft.id, payload);
      showToast(fmt(ac.pageProdUpdatedToast, { title: draft.title }));
    } else {
      await adminApi.createProduct(payload);
      showToast(fmt(ac.pageProdCreatedToast, { title: draft.title }));
    }
    await loadOverview();
    onStorefrontUpdated();
  };

  if (loading && !data) {
    return (
      <div className="py-24 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (!authorized || !data) {
    return <NotFoundView />;
  }

  const pendingTicketsCount = (data.tickets || []).filter(
    (t) => t.status === 'open' || t.status === 'escalated'
  ).length;
  const upstreamExcCount = Number(data.stats.upstream_exceptions || 0);
  const pendingWithdrawalsCount = (data.withdrawals || []).filter((w) => w.status === 'pending').length;
  const pendingDomainsCount = 0;
  const agentTodoCount = pendingWithdrawalsCount + pendingDomainsCount;

  const lowStockProducts = (data.products || [])
    .filter((p) => p.is_active)
    .map((p) => {
      const stock =
        p.stock_mode === 'cards'
          ? p.available_cards + Number(p.upstream_cached_stock || 0)
          : p.stock_mode === 'seats'
            ? Math.max(0, p.seat_total - p.seat_used)
            : p.manual_stock;
      return { id: p.id, title: p.title, stock };
    })
    .filter((p) => p.stock <= 3)
    .sort((a, b) => a.stock - b.stock);

  const navGroups = buildAdminNavGroups({
    isSuperAdmin,
    pendingTicketsCount,
    upstreamExcCount,
    agentTodoCount,
    dict: ac,
  });
  const allNavItems = navGroups.flatMap((g) => g.items);
  const currentNav = allNavItems.find((i) => i.id === tab) || allNavItems[0];

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 pt-4 pb-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <AdminSidebar
          navGroups={navGroups}
          activeTab={tab}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          onCloseMobile={() => setMobileNavOpen(false)}
          onSelectTab={switchTab}
        />

        <main className="flex-1 min-w-0 w-full min-h-[calc(100dvh-7rem)] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="lg:hidden p-2 rounded-xl border cursor-pointer shrink-0"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
                aria-label={ac.pageOpenNavAria}
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="font-editorial text-2xl font-semibold truncate">{currentNav.label}</h1>
                  {isTabPending && (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
                  )}
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>
                  {currentNav.desc}
                </p>
              </div>
            </div>
          </div>

          <Suspense
            fallback={
              <div
                className="paper-card rounded-2xl p-12 min-h-[60vh] flex items-center justify-center gap-2 text-xs"
                style={{ color: 'var(--ink-muted)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                {ac.pageLazyLoading}
              </div>
            }
          >
            {tab === 'overview' && (
              <AdminOverviewDashboard
                stats={data.stats}
                securityWarnings={data.security_warnings}
                pendingTicketsCount={pendingTicketsCount}
                pendingWithdrawalsCount={pendingWithdrawalsCount}
                pendingDomainsCount={pendingDomainsCount}
                lowStockProducts={lowStockProducts}
                recentOrders={data.orders}
                isSuperAdmin={isSuperAdmin}
                onNavigate={(nextTab) => {
                  if (nextTab === 'agents:withdrawals') {
                    setAgentsInitialSubTab('withdrawals');
                    startTabTransition(() => setTab('agents'));
                    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
                    return;
                  }
                  if (nextTab === 'settings:risk') {
                    setSettingsInitialSubTab('risk');
                    startTabTransition(() => setTab('settings'));
                    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
                    return;
                  }
                  if (nextTab === 'orders:risk_review') {
                    setOrdersInitialStatus('risk_review');
                    startTabTransition(() => setTab('orders'));
                    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
                    return;
                  }
                  setSettingsInitialSubTab('brand');
                  setOrdersInitialStatus('all');
                  switchTab(nextTab as AdminTab);
                }}
                onQuickCreateProduct={() => {
                  switchTab('products');
                  openCreateProduct();
                }}
              />
            )}

            {tab === 'products' && (
              <AdminProductsTab
                products={data.products}
                categories={data.categories}
                lowestAgentTier={lowestAgentTier}
                prodSearch={prodSearch}
                prodCatFilter={prodCatFilter}
                onSearchChange={setProdSearch}
                onCatFilterChange={setProdCatFilter}
                onCreateProduct={openCreateProduct}
                onEditProduct={(p) => {
                  setEditorProduct(toEditableProduct(p));
                  setEditorOpen(true);
                }}
                onOpenCardVault={setCardModalProduct}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                showToast={showToast}
              />
            )}

            {tab === 'categories' && (
              <AdminCategoryManager
                groups={data.groups}
                categories={data.categories}
                products={data.products}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                onJumpToCategoryProducts={(catId) => {
                  setProdCatFilter(catId);
                  setTab('products');
                }}
                showToast={showToast}
              />
            )}

            {tab === 'settings' && (
              <AdminSettingsTab
                initialSubTab={settingsInitialSubTab}
                settingsDraft={settingsDraft}
                setSettingsDraft={setSettingsDraft}
                notifyConfig={data.notify_config}
                paymentPlugins={data.payment_plugins}
                fxSnapshot={data.fx_snapshot}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                showToast={showToast}
              />
            )}

            {tab === 'orders' && (
              <AdminOrdersTab
                initialStatusFilter={ordersInitialStatus}
                orders={data.orders}
                isSuperAdmin={isSuperAdmin}
                onJumpToUpstreams={() => setTab('upstreams')}
                onEditProductById={(productId) => {
                  const found = data.products.find((p) => p.id === productId);
                  if (!found) {
                    showToast(ac.ordStatusException);
                    return;
                  }
                  setTab('products');
                  setEditorProduct(toEditableProduct(found));
                  setEditorOpen(true);
                }}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                showToast={showToast}
              />
            )}

            {tab === 'tickets' && (
              <AdminTicketsPanel tickets={data.tickets || []} onReload={loadOverview} showToast={showToast} />
            )}

            {tab === 'marketing' && (
              <AdminMarketingPanel
                coupons={data.coupons || []}
                cdks={data.cdks || []}
                settingsDraft={settingsDraft}
                setSettingsDraft={setSettingsDraft}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                showToast={showToast}
              />
            )}

            {tab === 'agents' && (
              <AdminAgentsTab
                agents={data.agents}
                agentTiers={data.agent_tiers || []}
                products={data.products}
                saasConfig={data.saas_config}
                withdrawals={data.withdrawals || []}
                initialSubTab={agentsInitialSubTab}
                onReload={loadOverview}
                showToast={showToast}
              />
            )}

            {tab === 'members' && <AdminMembersTab showToast={showToast} />}

            {tab === 'announcements' && (
              <AdminNoticeCenter
                initialSubTab={noticeInitialSubTab}
                settingsDraft={settingsDraft}
                setSettingsDraft={setSettingsDraft}
                announcements={data.announcements}
                helpArticles={data.help_articles}
                onReload={loadOverview}
                onStorefrontUpdated={onStorefrontUpdated}
                showToast={showToast}
              />
            )}

            {tab === 'finance' && <AdminFinancePanel showToast={showToast} />}

            {tab === 'audit' && <AdminAuditTab showToast={showToast} />}

            {tab === 'upstreams' && isSuperAdmin && (
              <AdminUpstreamPanel
                categories={data.categories}
                products={data.products}
                onStorefrontUpdated={() => {
                  void loadOverview();
                  onStorefrontUpdated();
                }}
                showToast={showToast}
              />
            )}

            {tab === 'ai' && isSuperAdmin && (
              <AdminAiPanel
                products={data.products}
                onAppliedToProduct={() => {
                  void loadOverview();
                  onStorefrontUpdated();
                }}
                showToast={showToast}
              />
            )}

            <ProductEditorDrawer
              open={editorOpen}
              product={editorProduct}
              categories={data.categories}
              agentTiers={data.agent_tiers}
              isSuperAdmin={isSuperAdmin}
              onClose={() => setEditorOpen(false)}
              onSave={handleSaveProduct}
            />

            <CardVaultModal
              open={Boolean(cardModalProduct)}
              product={cardModalProduct}
              onClose={() => setCardModalProduct(null)}
              onChanged={() => {
                void loadOverview();
                onStorefrontUpdated();
              }}
            />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
