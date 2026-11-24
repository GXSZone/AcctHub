/**
 * 合作代理与分站运营工作台主壳容器（严格分站域名自治：主站/异站一键 SSO 免登直达分站独立域名）
 */

import { ArrowLeft, Loader2, Menu } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useState, useTransition } from 'react';
import { Link } from 'react-router-dom';
import { WelcomePopupModal } from '../../components/WelcomePopupModal';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import { toast } from '../../lib/toast';
import {
  useAgentMeQuery,
  useAgentNoticesQuery,
  useAgentTicketsQuery,
  useAgentTiersQuery,
} from '../../queries/agent.queries';
import type { Announcement, BootstrapPayload, UserProfile } from '../../types';
import { AdminSidebar } from '../admin/AdminSidebar';
import { AgentApiTab } from './AgentApiTab';
import { AgentBrandDomainTab } from './AgentBrandDomainTab';
import { AgentDistributionTab } from './AgentDistributionTab';
import { AgentMarketingHelpTab } from './AgentMarketingHelpTab';
import { AgentOnboardingView, AgentSuperAdminGuard } from './AgentOnboardingView';
import { AgentOverviewTab } from './AgentOverviewTab';
import { AgentPortalHeader } from './AgentPortalHeader';
import { AgentPrivateCatalogTab } from './AgentPrivateCatalogTab';
import { AgentSsoRedirectCard } from './AgentSsoRedirectCard';
import { AgentStoreMembersTab, AgentStoreOrdersTab } from './AgentStoreOrdersMembersTabs';
import { AgentTicketsTab } from './AgentTicketsTab';
import { type AgentWorkbenchTab, buildAgentNavGroups } from './agent-nav';
import {
  isAgentTicketUnread,
  markAgentTicketSeen,
  readAgentTicketSeenMap,
  type TicketSeenMap,
} from './agent-ticket-unread';
import { useAgentTierPay } from './useAgentTierPay';

const AdminNoticeCenter = lazy(() =>
  import('../admin-notice/AdminNoticeCenter').then((m) => ({ default: m.AdminNoticeCenter }))
);
const AgentPricingPanel = lazy(() =>
  import('./pricing/AgentPricingPanel').then((m) => ({ default: m.AgentPricingPanel }))
);

interface AgentPortalPageProps {
  embedded?: boolean;
  user: UserProfile | null;
  bootstrap?: BootstrapPayload | null;
  onOpenAuth: () => void;
  onRefreshUser: () => void;
  onStorefrontUpdated?: () => void;
}

export function AgentPortalPage({
  embedded,
  user,
  bootstrap,
  onOpenAuth,
  onRefreshUser,
  onStorefrontUpdated,
}: AgentPortalPageProps) {
  const ag = useAgentI18n();
  const ac = useAdminCoreI18n();
  const ss = useSaasI18n();
  const rf = useRiskControlI18n();
  const [activeTab, setActiveTab] = useState<AgentWorkbenchTab>('overview');
  const [isTabPending, startTabTransition] = useTransition();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const switchTab = useCallback((nextTab: AgentWorkbenchTab) => {
    startTabTransition(() => setActiveTab(nextTab));
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const [noticeSettingsDraft, setNoticeSettingsDraft] = useState<Record<string, string>>({});
  const [viewingUpstreamNotice, setViewingUpstreamNotice] = useState<Announcement | null>(null);

  const isSuperAdmin = user?.role === 'admin';
  const tiersQuery = useAgentTiersQuery();
  const meQuery = useAgentMeQuery(Boolean(user && !isSuperAdmin));
  const agent = meQuery.data?.agent ?? null;
  const isOnOwnStoreDomain = Boolean(
    bootstrap?.tenant?.isSubAgent && agent?.id && bootstrap.tenant.agentId === agent.id
  );
  const noticesQuery = useAgentNoticesQuery(Boolean(agent?.id && isOnOwnStoreDomain), user?.id);
  const ticketsQuery = useAgentTicketsQuery(Boolean(agent?.id && isOnOwnStoreDomain));
  const [ticketSeenMap, setTicketSeenMap] = useState<TicketSeenMap>({});

  useEffect(() => {
    if (!agent?.id) return;
    setTicketSeenMap(readAgentTicketSeenMap(agent.id));
  }, [agent?.id]);

  const handleMarkTicketSeen = useCallback(
    (ticketId: number, lastMessageId: number) => {
      if (!agent?.id) return;
      setTicketSeenMap(markAgentTicketSeen(agent.id, ticketId, lastMessageId));
    },
    [agent?.id]
  );
  const queryError =
    meQuery.error instanceof Error
      ? meQuery.error.message
      : tiersQuery.error instanceof Error
        ? tiersQuery.error.message
        : '';

  useEffect(() => {
    if (queryError) toast.error(queryError);
  }, [queryError]);

  const showToast = useCallback((msg: string) => {
    toast.auto(msg);
  }, []);

  const showError = useCallback((msg: string) => {
    if (msg) toast.error(msg);
  }, []);

  useEffect(() => {
    const res = noticesQuery.data;
    if (!res) return;
    setNoticeSettingsDraft(res.settings || {});
  }, [noticesQuery.data]);

  const totalRecharged = meQuery.data?.total_recharged ?? 0;
  const {
    recharging,
    openTierPay: handleJoinOrUpgrade,
    overlays: tierPayOverlays,
  } = useAgentTierPay({
    user,
    isSuperAdmin,
    agent,
    meLoading: meQuery.isLoading,
    totalRecharged,
    balance: meQuery.data?.balance ?? user?.balance ?? 0,
    neutralBaseDomain: meQuery.data?.domain_config?.neutral_base_domain || '',
    paymentMethods: bootstrap?.payment_methods ?? [],
    onOpenAuth,
    onRefetchMe: () => meQuery.refetch(),
    onRefreshUser,
    showToast,
  });

  if (isSuperAdmin) return <AgentSuperAdminGuard />;

  const loading = user ? meQuery.isLoading : tiersQuery.isLoading;
  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  const siteBrandName = bootstrap?.settings?.brand_name || ag.defaultSiteBrand;
  const tiers = user ? (meQuery.data?.all_tiers ?? []) : (tiersQuery.data?.tiers ?? []);

  if (!agent) {
    return (
      <>
        <AgentOnboardingView
          user={user}
          siteBrandName={siteBrandName}
          tiers={tiers}
          recharging={recharging}
          onJoinOrUpgrade={handleJoinOrUpgrade}
        />
        {tierPayOverlays}
      </>
    );
  }

  // 分站域名彻底自治：若当前位于主站或他人分站域名下，引导通过 60 秒一次性 SSO 票据直达自己分站域名
  if (!isOnOwnStoreDomain) {
    return (
      <AgentSsoRedirectCard
        agentSlug={agent.slug}
        neutralBaseDomain={meQuery.data?.domain_config?.neutral_base_domain}
        isOtherSub={Boolean(bootstrap?.tenant?.isSubAgent)}
      />
    );
  }

  const meData = meQuery.data;
  const currentTier = meData?.tier ?? null;
  const nextTier = meData?.next_tier ?? null;
  const myDownlineTiers = meData?.my_downline_tiers ?? [];
  const balance = meData?.balance ?? user?.balance ?? 0;
  const subAgents = meData?.sub_agents ?? [];
  const directSubCount = meData?.direct_sub_count ?? 0;
  const totalDownlineCount = meData?.total_downline_count ?? 0;
  const domainConfig = meData?.domain_config ?? {
    neutral_base_domain: '',
    saas_cname_target: '',
    cf_saas_enabled: false,
  };
  const myDiscountFloor = currentTier?.discount_rate ?? 0.9;
  const primaryHostname = bootstrap?.tenant?.primaryHostname;
  const storefrontPublicUrl = primaryHostname
    ? `https://${primaryHostname}`
    : domainConfig.neutral_base_domain
      ? `https://${agent.slug}.${domainConfig.neutral_base_domain}`
      : window.location.origin;
  const upstreamNotices = noticesQuery.data?.upstream_notices ?? [];
  const upstreamPopup = noticesQuery.data?.upstream_popup ?? null;
  const capabilities = bootstrap?.tenant?.capabilities;
  const unreadTicketsCount = (ticketsQuery.data?.tickets ?? []).filter((tk) =>
    isAgentTicketUnread(tk, ticketSeenMap)
  ).length;

  const navGroups = buildAgentNavGroups({
    directSubCount,
    unreadTicketsCount,
    dict: ag,
    saasDict: ss,
    rfDict: rf,
    allowPrivateProducts: Boolean(capabilities?.allow_private_products),
  });
  const allNavItems = navGroups.flatMap((g) => g.items);
  const currentNav = allNavItems.find((i) => i.id === activeTab) || allNavItems[0];
  const refreshMe = async () => {
    await meQuery.refetch();
  };
  const loadingFallback = (label: string) => (
    <div
      className="paper-card rounded-2xl p-10 flex items-center justify-center gap-2 text-xs"
      style={{ color: 'var(--ink-muted)' }}
    >
      <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
      {label}
    </div>
  );
  const sidebarBackLink = (
    <Link
      to="/account/home"
      className="w-full h-9 px-2.5 flex items-center gap-2 rounded-xl text-xs font-medium no-underline transition-colors hover:bg-[var(--bg-subtle)]"
      style={{ color: 'var(--ink-secondary)' }}
    >
      <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{ag.sidebarBackMember}</span>
    </Link>
  );

  return (
    <div className={embedded ? 'space-y-5' : 'max-w-[1480px] mx-auto px-4 sm:px-6 pt-4 pb-6'}>
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <AdminSidebar<AgentWorkbenchTab>
          navGroups={navGroups}
          activeTab={activeTab}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileNavOpen}
          eyebrow={ag.sidebarEyebrow}
          title={ag.sidebarTitle}
          mobileTitle={ag.sidebarTitle}
          footerSlot={sidebarBackLink}
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

          <AgentPortalHeader
            agent={agent}
            currentTier={currentTier}
            storefrontPublicUrl={storefrontPublicUrl}
            storefrontPreviewUrl={window.location.origin}
            upstreamNotices={upstreamNotices.filter((n) => Boolean(n.is_pinned))}
            upstreamPopup={upstreamPopup}
            onOpenUpstreamPopup={() => {
              if (!upstreamPopup) return;
              setViewingUpstreamNotice({
                id: 0,
                title: upstreamPopup.title || ag.upstreamPopupDefaultTitle,
                title_en: upstreamPopup.title || '',
                content: upstreamPopup.content || '',
                content_en: upstreamPopup.content || '',
                level: 'highlight',
                audience: 'direct_downlines',
                is_pinned: 1,
                created_at: '',
              });
            }}
            onViewUpstreamNotice={setViewingUpstreamNotice}
          />

          {activeTab === 'overview' && (
            <AgentOverviewTab
              agent={agent}
              balance={balance}
              totalRecharged={totalRecharged}
              nextTier={nextTier}
              directSubCount={directSubCount}
              totalDownlineCount={totalDownlineCount}
              withdrawals={meData?.withdrawals ?? []}
              ledger={meData?.commission_ledger ?? []}
              recentOrders={meData?.recent_orders ?? []}
              withdrawalFeePct={Number(meData?.withdrawal_fee_pct ?? 0)}
              recharging={recharging}
              onJoinOrUpgrade={(tier) => void handleJoinOrUpgrade(tier)}
              onRefresh={refreshMe}
              onRefreshUser={onRefreshUser}
              onToast={showToast}
              onError={showError}
            />
          )}

          {activeTab === 'store_orders' && <AgentStoreOrdersTab />}

          {activeTab === 'store_members' && <AgentStoreMembersTab />}

          {activeTab === 'products' && (
            <Suspense fallback={loadingFallback(ag.loadingProducts)}>
              <AgentPricingPanel tenantSlug={agent.slug} storeName={agent.brand_name} />
            </Suspense>
          )}

          {activeTab === 'private_catalog' && capabilities?.allow_private_products && (
            <AgentPrivateCatalogTab agentTiers={myDownlineTiers} onToast={showToast} onError={showError} />
          )}

          {activeTab === 'distribution' && (
            <AgentDistributionTab
              myDownlineTiers={myDownlineTiers}
              myDiscountFloor={myDiscountFloor}
              subAgents={subAgents}
              directSubCount={directSubCount}
              totalDownlineCount={totalDownlineCount}
              onRefresh={refreshMe}
              onToast={showToast}
              onError={showError}
            />
          )}

          {activeTab === 'tickets' && (
            <AgentTicketsTab
              seenMap={ticketSeenMap}
              onMarkTicketSeen={handleMarkTicketSeen}
              onToast={showToast}
            />
          )}

          {activeTab === 'marketing' && (
            <AgentMarketingHelpTab agentSlug={agent.slug} onToast={showToast} onError={showError} />
          )}

          {activeTab === 'notices' && (
            <Suspense fallback={loadingFallback(ag.loadingNotices)}>
              <AdminNoticeCenter
                mode="agent"
                settingsDraft={noticeSettingsDraft}
                setSettingsDraft={setNoticeSettingsDraft}
                announcements={noticesQuery.data?.announcements ?? []}
                onReload={async () => {
                  await noticesQuery.refetch();
                }}
                onStorefrontUpdated={() => onStorefrontUpdated?.()}
                showToast={showToast}
              />
            </Suspense>
          )}

          {activeTab === 'brand' && (
            <AgentBrandDomainTab
              agent={agent}
              domainConfig={domainConfig}
              allowOwnPayment={Boolean(capabilities?.allow_own_payment)}
              allowPrivateProducts={Boolean(capabilities?.allow_private_products)}
              onGoPrivateCatalog={() => switchTab('private_catalog')}
              onRefresh={refreshMe}
              onRefreshUser={onRefreshUser}
              onStorefrontUpdated={onStorefrontUpdated}
              onToast={showToast}
              onError={showError}
            />
          )}

          {activeTab === 'api' && (
            <AgentApiTab
              agent={agent}
              myDiscountFloor={myDiscountFloor}
              apiBaseOrigin={window.location.origin}
              onRefresh={refreshMe}
              onToast={showToast}
              onError={showError}
            />
          )}

          <WelcomePopupModal
            open={Boolean(viewingUpstreamNotice)}
            title={viewingUpstreamNotice?.title || ''}
            content={viewingUpstreamNotice?.content || ''}
            badge={fmt(ag.upstreamPopupDrawerBadge, {
              source: upstreamPopup?.source_name || ag.defaultMainBrand,
            })}
            showDismissToday={false}
            onClose={() => setViewingUpstreamNotice(null)}
          />
          {tierPayOverlays}
        </main>
      </div>
    </div>
  );
}
