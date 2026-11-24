/**
 * 会员中心主壳页：侧栏导航与 7 大功能分栏容器
 */

import { Gift, Headphones, Home, ReceiptText, ScrollText, ShieldCheck, Store, Wallet } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { authApi } from '../../api/auth.api';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { toast } from '../../lib/toast';
import type { BootstrapPayload, UserProfile } from '../../types';
import { AgentPortalPage } from '../agent/AgentPortalPage';
import { AccountAffiliateTab } from './AccountAffiliateTab';
import { AccountBillingTab } from './AccountBillingTab';
import { AccountHomeTab } from './AccountHomeTab';
import { AccountOrdersTab } from './AccountOrdersTab';
import { AccountRechargeTab } from './AccountRechargeTab';
import { AccountSecurityTab } from './AccountSecurityTab';
import { AccountTicketsTab } from './AccountTicketsTab';

export type AccountSection =
  | 'home'
  | 'orders'
  | 'recharge'
  | 'billing'
  | 'tickets'
  | 'affiliate'
  | 'store'
  | 'security';

interface AccountCenterPageProps {
  user: UserProfile | null;
  bootstrap: BootstrapPayload | null;
  onOpenAuth: () => void;
  onRefreshUser: () => void;
  onStorefrontUpdated: () => void;
}

const VALID_SECTIONS: AccountSection[] = [
  'home',
  'orders',
  'recharge',
  'billing',
  'tickets',
  'affiliate',
  'store',
  'security',
];

export function AccountCenterPage({
  user,
  bootstrap,
  onOpenAuth,
  onRefreshUser,
  onStorefrontUpdated,
}: AccountCenterPageProps) {
  const acc = useAccountI18n();
  const params = useParams<{ section?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isSubDomain = Boolean(bootstrap?.tenant?.isSubAgent);
  const isOwnerAgent = Boolean(
    isSubDomain && user?.agent?.id && user.agent.id === bootstrap?.tenant?.agentId
  );

  const activeSection: AccountSection = VALID_SECTIONS.includes((params.section || 'home') as AccountSection)
    ? ((params.section || 'home') as AccountSection)
    : 'home';

  const goSection = useCallback(
    (sec: AccountSection) => {
      toast.clearErrors();
      if (sec === 'store' && user?.agent) {
        if (isOwnerAgent) {
          navigate('/agent');
        } else {
          void authApi
            .issueSso('/agent')
            .then((res) => {
              window.location.assign(res.redirect_url);
            })
            .catch((err: Error) => toast.error(err.message));
        }
        return;
      }
      navigate(`/account/${sec}`);
    },
    [isOwnerAgent, navigate, user?.agent]
  );

  const [presetTicket, setPresetTicket] = useState<{
    orderNo: string;
    category: string;
    subject: string;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    toast.auto(msg);
  }, []);

  const showError = useCallback((msg: string) => {
    if (msg) toast.error(msg);
  }, []);

  // 支持从订单页一键跳转 /account/tickets?order_no=AH...&category=after_sale
  useEffect(() => {
    if (!user || activeSection !== 'tickets') return;
    const preOrderNo = (searchParams.get('order_no') || '').trim();
    const preCategory = (searchParams.get('category') || '').trim();
    if (!preOrderNo) return;

    setPresetTicket({
      orderNo: preOrderNo,
      category: preCategory || 'after_sale',
      subject: fmt(acc.presetTicketSubject, { orderNo: preOrderNo }),
    });
    const nextSp = new URLSearchParams(searchParams);
    nextSp.delete('order_no');
    nextSp.delete('category');
    setSearchParams(nextSp, { replace: true });
  }, [user, activeSection, searchParams, setSearchParams, acc.presetTicketSubject]);

  const startOrderTicket = useCallback(
    (orderNo: string, productTitle: string) => {
      setPresetTicket({
        orderNo,
        category: 'after_sale',
        subject: fmt(acc.afterSaleSubject, { orderNo, productTitle: productTitle.slice(0, 22) }),
      });
      goSection('tickets');
    },
    [goSection, acc.afterSaleSubject]
  );

  if (!user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <div className="paper-card rounded-2xl p-8 space-y-4">
          <div
            className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Home className="w-6 h-6" />
          </div>
          <h1 className="font-editorial text-2xl font-semibold">{acc.loginGateTitle}</h1>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {acc.loginGateDesc}
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {acc.loginGateBtn}
          </button>
        </div>
      </div>
    );
  }

  const isSuperAdmin = user.role === 'admin';
  if (activeSection === 'store' && user.agent && !isSuperAdmin && isOwnerAgent) {
    return <Navigate to="/agent" replace />;
  }
  const navGroups: Array<{
    title: string;
    items: Array<{ id: AccountSection; label: string; icon: React.ComponentType<{ className?: string }> }>;
  }> = [
    { title: acc.navGroupHome, items: [{ id: 'home', label: acc.navHome, icon: Home }] },
    {
      title: acc.navGroupFinance,
      items: [
        { id: 'orders', label: acc.navOrders, icon: ReceiptText },
        { id: 'recharge', label: acc.navRecharge, icon: Wallet },
        { id: 'billing', label: acc.navBilling, icon: ScrollText },
      ],
    },
    { title: acc.navGroupSupport, items: [{ id: 'tickets', label: acc.navTickets, icon: Headphones }] },
    ...(!isSuperAdmin
      ? [
          {
            title: acc.navGroupChannel,
            items: [
              {
                id: 'affiliate' as AccountSection,
                label: acc.navAffiliate,
                icon: Gift,
              },
              {
                id: 'store' as AccountSection,
                label: user.agent ? acc.navMyStore : acc.navOpenStore,
                icon: Store,
              },
            ],
          },
        ]
      : []),
    { title: acc.navGroupAccount, items: [{ id: 'security', label: acc.navSecurity, icon: ShieldCheck }] },
  ];

  return (
    <div className="max-w-[1480px] mx-auto px-4 sm:px-6 pt-4 pb-6">
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <aside className="w-full lg:w-[236px] shrink-0 paper-card rounded-2xl p-3 lg:sticky lg:top-[81px] lg:max-h-[calc(100dvh-97px)] flex flex-col">
          <div
            className="h-11 pb-2.5 mb-2.5 px-1 border-b flex items-center gap-2.5 shrink-0"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {user.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold leading-tight truncate">{user.display_name}</div>
              <div
                className="text-[10.5px] font-mono-num leading-tight mt-0.5"
                style={{ color: 'var(--success)' }}
              >
                {acc.balancePrefix} ¥{user.balance.toFixed(2)}
              </div>
            </div>
          </div>

          <nav className="space-y-3 overflow-y-auto overscroll-contain" aria-label={acc.navAriaLabel}>
            {navGroups.map((grp) => (
              <div key={grp.title} className="space-y-1">
                <div className="h-5 px-2.5 flex items-center">
                  <span
                    className="text-[10.5px] font-semibold uppercase tracking-wider truncate"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {grp.title}
                  </span>
                </div>
                {grp.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goSection(item.id)}
                      className="w-full h-9 px-2.5 flex items-center gap-2.5 rounded-xl text-xs font-medium cursor-pointer transition-colors text-left"
                      style={{
                        backgroundColor: active ? 'var(--accent)' : 'transparent',
                        color: active ? '#FAF9F5' : 'var(--ink-secondary)',
                      }}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 w-full min-h-[calc(100dvh-7rem)] space-y-5">
          {activeSection === 'home' && (
            <AccountHomeTab
              user={user}
              isSuperAdmin={isSuperAdmin}
              onGoSection={goSection}
              onStartOrderTicket={startOrderTicket}
            />
          )}
          {activeSection === 'orders' && (
            <AccountOrdersTab user={user} onStartOrderTicket={startOrderTicket} />
          )}
          {activeSection === 'recharge' && (
            <AccountRechargeTab
              user={user}
              bootstrap={bootstrap}
              onRefreshUser={onRefreshUser}
              onToast={showToast}
              onError={showError}
            />
          )}
          {activeSection === 'billing' && <AccountBillingTab />}
          {activeSection === 'tickets' && (
            <AccountTicketsTab
              presetTicket={presetTicket}
              onClearPreset={() => setPresetTicket(null)}
              onToast={showToast}
              onError={showError}
            />
          )}
          {activeSection === 'affiliate' && !isSuperAdmin && (
            <AccountAffiliateTab user={user} bootstrap={bootstrap} onToast={showToast} />
          )}
          {activeSection === 'store' && !isSuperAdmin && (
            <AgentPortalPage
              embedded
              user={user}
              bootstrap={bootstrap}
              onOpenAuth={onOpenAuth}
              onRefreshUser={onRefreshUser}
              onStorefrontUpdated={onStorefrontUpdated}
            />
          )}
          {activeSection === 'security' && (
            <AccountSecurityTab
              user={user}
              onRefreshUser={onRefreshUser}
              onToast={showToast}
              onError={showError}
            />
          )}
        </main>
      </div>
    </div>
  );
}
