/**
 * 非首屏交互浮层、业务路由按需懒加载与统一加载占位组件
 */

import { lazy } from 'react';
import { useCommonModalsI18n } from './i18n/namespaces/common-modals';

export const SmartSearchModal = lazy(() =>
  import('./components/SmartSearchModal').then((m) => ({ default: m.SmartSearchModal }))
);
export const AuthModal = lazy(() => import('./components/AuthModal').then((m) => ({ default: m.AuthModal })));
export const AnnouncementDrawer = lazy(() =>
  import('./components/AnnouncementDrawer').then((m) => ({ default: m.AnnouncementDrawer }))
);
export const WelcomePopupModal = lazy(() =>
  import('./components/WelcomePopupModal').then((m) => ({ default: m.WelcomePopupModal }))
);
export const FloatingSupport = lazy(() =>
  import('./components/FloatingSupport').then((m) => ({ default: m.FloatingSupport }))
);

export const ProductDetailPage = lazy(() =>
  import('./features/storefront/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
export const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
export const TwoFactorPage = lazy(() =>
  import('./features/totp/TwoFactorPage').then((m) => ({ default: m.TwoFactorPage }))
);
export const AgentPortalPage = lazy(() =>
  import('./features/agent/AgentPortalPage').then((m) => ({ default: m.AgentPortalPage }))
);
export const AccountCenterPage = lazy(() =>
  import('./features/account/AccountCenterPage').then((m) => ({ default: m.AccountCenterPage }))
);
export const HelpCenterPage = lazy(() =>
  import('./pages/HelpCenterPage').then((m) => ({ default: m.HelpCenterPage }))
);
export const ApiDocsPage = lazy(() =>
  import('./features/docs/ApiDocsPage').then((m) => ({ default: m.ApiDocsPage }))
);
export const AdminPage = lazy(() =>
  import('./features/admin/AdminPage').then((m) => ({ default: m.AdminPage }))
);
export const SetupPage = lazy(() =>
  import('./features/setup/SetupPage').then((m) => ({ default: m.SetupPage }))
);
export const SsoCallbackPage = lazy(() =>
  import('./pages/SsoCallbackPage').then((m) => ({ default: m.SsoCallbackPage }))
);
export const OAuthCallbackPage = lazy(() =>
  import('./pages/OAuthCallbackPage').then((m) => ({ default: m.OAuthCallbackPage }))
);
export const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })));

export function RouteLoadingFallback() {
  const m = useCommonModalsI18n();
  return (
    <div
      className="max-w-5xl mx-auto px-4 py-24 flex flex-col items-center justify-center gap-3 text-xs"
      style={{ color: 'var(--ink-muted)' }}
    >
      <div
        className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
      <span>{m.appLoadingRoute}</span>
    </div>
  );
}
