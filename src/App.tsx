import { resolveLocalizedField } from '@shared/domain/i18n';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom';
import {
  AccountCenterPage,
  AdminPage,
  AgentPortalPage,
  AnnouncementDrawer,
  ApiDocsPage,
  AuthModal,
  FloatingSupport,
  HelpCenterPage,
  LegalPage,
  OAuthCallbackPage,
  OrdersPage,
  ProductDetailPage,
  RouteLoadingFallback,
  SetupPage,
  SmartSearchModal,
  SsoCallbackPage,
  TwoFactorPage,
  WelcomePopupModal,
} from './AppLazyViews';
import { PrivateSession } from './app/PrivateSession';
import { TenantProvider } from './app/TenantContext';
import { useAppSession } from './app/use-app-session';
import { useStorefrontEffects, type WelcomePopupState } from './app/use-storefront-effects';
import { ConfirmDialogHost } from './components/ConfirmDialog';
import { DownlineGlobalPopupHost } from './components/DownlineGlobalPopupHost';
import { FormValidationHost } from './components/FormValidationHost';
import { Header } from './components/Header';
import { NotFoundView } from './components/NotFoundView';
import { ToastHost } from './components/ToastHost';
import { I18nProvider, useI18n } from './i18n';
import { useCommonModalsI18n } from './i18n/namespaces/common-modals';
import { useRiskControlI18n } from './i18n/namespaces/risk-control';
import { initThemeSync } from './lib/theme';
import { toast } from './lib/toast';
import { initDeferredValidationSync } from './lib/uiHelpers';
import { CatalogPage } from './pages/CatalogPage';
import { useAgentNoticesQuery } from './queries/agent.queries';
import { useBootstrapQuery } from './queries/storefront.queries';
import type { Announcement } from './types';

function AppShell() {
  const { locale } = useI18n();
  const m = useCommonModalsI18n();
  const rf = useRiskControlI18n();
  const navigate = useNavigate();
  const bootstrapQuery = useBootstrapQuery();
  const bootstrap = bootstrapQuery.data ?? null;
  const { authScope, privateScope, privateClient, user, awaitingIdentity, actions } = useAppSession();

  const [searchOpen, setSearchOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [readNoticeIds, setReadNoticeIds] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem('accthub_read_notice_ids');
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  });

  const markNoticesRead = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setReadNoticeIds((prev) => {
      const merged = Array.from(new Set([...prev, ...ids]));
      try {
        localStorage.setItem('accthub_read_notice_ids', JSON.stringify(merged));
      } catch (err) {
        console.warn('Failed to persist read announcement ids:', err);
      }
      return merged;
    });
  }, []);

  const agentNoticesQuery = useAgentNoticesQuery(user?.role === 'agent', user?.id);
  const visibleAnnouncements = useMemo(() => {
    const base = bootstrap?.announcements || [];
    if (user?.role !== 'agent') return base;
    const dl = agentNoticesQuery.data?.upstream_notices || [];
    const seen = new Set(dl.map((a) => a.id));
    return [...dl, ...base.filter((a) => !seen.has(a.id))];
  }, [agentNoticesQuery.data?.upstream_notices, bootstrap?.announcements, user?.role]);

  const unreadAnnouncementCount = visibleAnnouncements.filter((a) => !readNoticeIds.includes(a.id)).length;
  const [popupState, setPopupState] = useState<WelcomePopupState>({
    open: false,
    title: '',
    content: '',
    badge: '',
    isWelcome: true,
  });

  useStorefrontEffects(bootstrap, setPopupState);

  const openWelcomePopup = useCallback(
    (settingsOverride?: Record<string, string>) => {
      const s = settingsOverride || bootstrap?.settings || {};
      setPopupState({
        open: true,
        title: s.popup_title || m.appDefaultPopupTitle,
        content: s.popup_content || m.appDefaultPopupContent,
        badge: m.ntcPopupBadgeWelcome,
        isWelcome: true,
      });
    },
    [bootstrap?.settings, m.appDefaultPopupContent, m.appDefaultPopupTitle, m.ntcPopupBadgeWelcome]
  );

  const openSingleAnnouncement = useCallback(
    (item: Announcement) => {
      markNoticesRead([item.id]);
      setPopupState({
        open: true,
        title: resolveLocalizedField({
          locale,
          baseZh: item.title,
          legacyEn: item.title_en,
          translationsJson: item.translations_json,
          field: 'title',
        }),
        content: resolveLocalizedField({
          locale,
          baseZh: item.content,
          legacyEn: item.content_en,
          translationsJson: item.translations_json,
          field: 'content',
        }),
        badge:
          item.level === 'highlight'
            ? m.ntcLevelHighlight
            : item.level === 'warning'
              ? m.ntcLevelWarning
              : m.ntcLevelInfo,
        isWelcome: false,
      });
    },
    [locale, markNoticesRead, m.ntcLevelHighlight, m.ntcLevelWarning, m.ntcLevelInfo]
  );

  const openAnnouncementsDrawer = useCallback(() => {
    const allIds = visibleAnnouncements.map((a) => a.id);
    markNoticesRead(allIds);
    setNoticeOpen(true);
  }, [visibleAnnouncements, markNoticesRead]);

  useEffect(() => {
    const cleanupTheme = initThemeSync();
    const cleanupValidation = initDeferredValidationSync();

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      cleanupTheme();
      cleanupValidation();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const isSubDomain = Boolean(bootstrap?.tenant?.isSubAgent);

  const handleLogout = () => {
    void actions
      .logout()
      .then(() => {
        const path = window.location.pathname;
        // 仅在私有工作区（会员中心 / 分站工作台 / 总控后台）退出时回到首页，公共工具页（如 /2fa）留原地清空私有态
        if (path.startsWith('/account') || path.startsWith('/agent') || path.startsWith('/admin')) {
          navigate('/', { replace: true });
        }
      })
      .catch((err: Error) => toast.error(err.message));
  };

  return (
    <TenantProvider bootstrap={bootstrap} isLoading={bootstrapQuery.isLoading} error={bootstrapQuery.error}>
      <div className="min-h-screen flex flex-col">
        <Header
          bootstrap={bootstrap}
          user={user}
          unreadAnnouncementCount={unreadAnnouncementCount}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenAnnouncements={openAnnouncementsDrawer}
          onLogout={handleLogout}
        />

        <div className="flex-1">
          <Suspense fallback={<RouteLoadingFallback />}>
            {awaitingIdentity ? (
              <RouteLoadingFallback />
            ) : (
              <PrivateSession key={privateScope} scope={privateScope} client={privateClient}>
                <Routes>
                  <Route
                    path="/"
                    element={
                      <CatalogPage
                        bootstrap={bootstrap}
                        user={user}
                        onOpenSearch={() => setSearchOpen(true)}
                        onOpenAnnouncements={openAnnouncementsDrawer}
                        onSelectAnnouncement={openSingleAnnouncement}
                        onOpenWelcomePopup={() => openWelcomePopup()}
                      />
                    }
                  />
                  <Route
                    path="/item/:id"
                    element={
                      <ProductDetailPage
                        bootstrap={bootstrap}
                        user={user}
                        onBalanceChange={actions.updateBalanceCache}
                        onRefreshUser={() => void actions.refreshMe()}
                        onOpenAuth={() => setAuthOpen(true)}
                      />
                    }
                  />
                  <Route path="/orders" element={<OrdersPage user={user} bootstrap={bootstrap} />} />
                  <Route path="/2fa" element={<TwoFactorPage user={user} />} />
                  <Route
                    path="/account"
                    element={
                      <AccountCenterPage
                        user={user}
                        bootstrap={bootstrap}
                        onOpenAuth={() => setAuthOpen(true)}
                        onRefreshUser={() => void actions.refreshMe()}
                        onStorefrontUpdated={() => void actions.refreshBootstrap()}
                      />
                    }
                  />
                  <Route
                    path="/account/:section"
                    element={
                      <AccountCenterPage
                        user={user}
                        bootstrap={bootstrap}
                        onOpenAuth={() => setAuthOpen(true)}
                        onRefreshUser={() => void actions.refreshMe()}
                        onStorefrontUpdated={() => void actions.refreshBootstrap()}
                      />
                    }
                  />
                  <Route
                    path="/agent"
                    element={
                      <AgentPortalPage
                        user={user}
                        bootstrap={bootstrap}
                        onOpenAuth={() => setAuthOpen(true)}
                        onRefreshUser={() => void actions.refreshMe()}
                        onStorefrontUpdated={() => void actions.refreshBootstrap()}
                      />
                    }
                  />
                  <Route path="/help" element={<HelpCenterPage />} />
                  <Route path="/legal/:type" element={<LegalPage />} />
                  <Route path="/docs" element={<ApiDocsPage user={user} />} />
                  <Route
                    path="/sso/callback"
                    element={<SsoCallbackPage onSuccess={actions.setUserCache} />}
                  />
                  <Route
                    path="/oauth/callback"
                    element={<OAuthCallbackPage onSuccess={actions.setUserCache} />}
                  />
                  <Route
                    path="/setup"
                    element={
                      <SetupPage
                        onInitialized={async () => {
                          await Promise.all([actions.refreshMe(), actions.refreshBootstrap()]);
                        }}
                      />
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      isSubDomain || user?.role !== 'admin' ? (
                        <NotFoundView homeTo="/" />
                      ) : (
                        <AdminPage
                          user={user}
                          onOpenAuth={() => setAuthOpen(true)}
                          onStorefrontUpdated={() => void actions.refreshBootstrap()}
                        />
                      )
                    }
                  />
                </Routes>
                <DownlineGlobalPopupHost user={user} welcomePopupOpen={popupState.open} />
              </PrivateSession>
            )}
          </Suspense>
        </div>

        <footer
          className="mt-12 border-t py-6 px-4 sm:px-6 text-xs"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
        >
          <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <div>
              <strong className="font-editorial text-sm" style={{ color: 'var(--ink-primary)' }}>
                {bootstrap?.settings?.brand_name || 'AcctHub'}
              </strong>{' '}
              · {bootstrap?.settings?.brand_tagline || m.appDefaultTagline}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span>{bootstrap?.tenant?.footerText || m.appDefaultFooter}</span>
              <span aria-hidden="true">·</span>
              <Link to="/legal/terms" className="hover:underline" style={{ color: 'var(--ink-secondary)' }}>
                {rf.legalTermsTitle}
              </Link>
              <Link to="/legal/privacy" className="hover:underline" style={{ color: 'var(--ink-secondary)' }}>
                {rf.legalPrivacyTitle}
              </Link>
              <Link to="/legal/refund" className="hover:underline" style={{ color: 'var(--ink-secondary)' }}>
                {rf.legalRefundTitle}
              </Link>
            </div>
          </div>
        </footer>

        <Suspense fallback={null}>
          {searchOpen && <SmartSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />}
          {authOpen && (
            <AuthModal
              key={authScope}
              open={authOpen}
              bootstrap={bootstrap}
              onClose={() => setAuthOpen(false)}
              onSuccess={actions.setUserCache}
            />
          )}
          {noticeOpen && (
            <AnnouncementDrawer
              open={noticeOpen}
              onClose={() => setNoticeOpen(false)}
              announcements={visibleAnnouncements}
            />
          )}
          {popupState.open && (
            <WelcomePopupModal
              open={popupState.open}
              title={popupState.title}
              content={popupState.content}
              badge={popupState.badge}
              showDismissToday={popupState.isWelcome}
              onClose={() => setPopupState((prev) => ({ ...prev, open: false }))}
              onDismissToday={() => {
                try {
                  const version = bootstrap?.settings?.popup_version || '1';
                  localStorage.setItem(
                    `accthub_popup_dismiss_${version}`,
                    new Date().toISOString().slice(0, 10)
                  );
                } catch (err) {
                  console.warn('Failed to persist popup dismiss state:', err);
                }
              }}
            />
          )}
          <FloatingSupport
            label={bootstrap?.settings?.support_label}
            url={bootstrap?.settings?.support_url}
            note={bootstrap?.settings?.support_note}
            mediaJson={bootstrap?.settings?.support_media_json}
            linksJson={bootstrap?.settings?.support_links_json}
          />
        </Suspense>
        <ConfirmDialogHost />
        <FormValidationHost />
        <ToastHost />
      </div>
    </TenantProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </I18nProvider>
  );
}
