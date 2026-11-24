import {
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
  type FxDisplayRatesDto,
} from '@shared/contracts/extensions.contract';
import { parseHeaderNavEntries } from '@shared/domain/header-links';
import {
  Bell,
  ExternalLink,
  FileCode2,
  HelpCircle,
  KeyRound,
  Moon,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Sun,
} from 'lucide-react';
import type React from 'react';
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth.api';
import { fmt, LOCALE_OPTIONS, type SupportedLocale, useI18n } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { useExtensionsI18n } from '../i18n/namespaces/extensions';
import { CURRENCY_META, syncFxDisplayRates, useDisplayCurrency } from '../lib/currency';
import { toggleColorScheme } from '../lib/theme';
import { toast } from '../lib/toast';
import type { BootstrapPayload, UserProfile } from '../types';
import { BrandMark } from './BrandIcon';
import { HeaderAccountMenu } from './HeaderAccountMenu';
import { HeaderExternalLinks } from './HeaderExternalLinks';

interface HeaderProps {
  bootstrap: BootstrapPayload | null;
  user: UserProfile | null;
  unreadAnnouncementCount: number;
  onOpenSearch: () => void;
  onOpenAuth: () => void;
  onOpenAnnouncements: () => void;
  onLogout: () => void;
}

export function Header({
  bootstrap,
  user,
  unreadAnnouncementCount,
  onOpenSearch,
  onOpenAuth,
  onOpenAnnouncements,
  onLogout,
}: HeaderProps) {
  const { locale, messages: t, setLocale } = useI18n();
  const m = useCommonModalsI18n();
  const location = useLocation();
  const navigate = useNavigate();

  const tenant = bootstrap?.tenant;
  const brandName = bootstrap?.settings?.brand_name || 'AcctHub';
  const brandLogoUrl = tenant?.isSubAgent ? tenant.faviconUrl : bootstrap?.settings?.brand_logo_url;
  const isSubDomain = Boolean(tenant?.isSubAgent);
  const isOwnerAgent = Boolean(
    isSubDomain && user?.role === 'agent' && user.agent?.id && user.agent.id === tenant?.agentId
  );
  const isMainAgent = Boolean(!isSubDomain && user?.role === 'agent' && user.agent?.status === 'active');

  const isAdmin = user?.role === 'admin' && !isSubDomain;
  const showBackendEntry = isAdmin || isOwnerAgent || isMainAgent;
  const showOpenAgentEntry = !showBackendEntry;
  const showApiDocs = !isSubDomain || tenant?.capabilities?.show_api_docs !== false || isOwnerAgent;
  const customHeaderEntries = parseHeaderNavEntries(bootstrap?.settings?.header_links_json);

  const openBackendEntry = async () => {
    if (isAdmin) return navigate('/admin');
    if (isOwnerAgent) return navigate('/agent');
    if (!isMainAgent) return;
    try {
      window.location.assign((await authApi.issueSso('/agent')).redirect_url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open store workbench');
    }
  };

  const navLinks = [
    {
      to: '/',
      label: t.navShopShort,
      icon: ShoppingBag,
      match: (p: string) => p === '/' || p.startsWith('/item/'),
    },
    {
      to: '/orders',
      label: t.navOrdersShort,
      icon: ReceiptText,
      match: (p: string) => p.startsWith('/orders'),
    },
    {
      to: '/2fa',
      label: m.hdrTool2faShort,
      icon: KeyRound,
      match: (p: string) => p.startsWith('/2fa'),
    },
    {
      to: '/help',
      label: t.navHelp,
      icon: HelpCircle,
      match: (p: string) => p.startsWith('/help'),
    },
    ...(showApiDocs
      ? [
          {
            to: '/docs',
            label: t.navDocs,
            icon: FileCode2,
            match: (p: string) => p.startsWith('/docs'),
          },
        ]
      : []),
  ];

  const adminActive = isAdmin
    ? location.pathname.startsWith('/admin')
    : location.pathname.startsWith('/agent') || location.pathname.startsWith('/account/store');
  const backendNavStyle = {
    backgroundColor: adminActive ? 'var(--accent-soft)' : 'transparent',
    color: adminActive ? 'var(--accent)' : 'var(--ink-secondary)',
  } as const;
  const backendNavCls =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors';

  const utilBtnStyle = {
    borderColor: 'var(--border-color)',
    backgroundColor: 'var(--bg-surface)',
    color: 'var(--ink-secondary)',
  } as const;

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-md"
      style={{
        borderColor: 'var(--border-color)',
        backgroundColor: 'color-mix(in srgb, var(--bg-canvas) 90%, transparent)',
      }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Left: Clean Brand Seal (Exact Cap-to-Baseline Vertical Center Alignment) */}
        <Link to="/" className="inline-flex items-center gap-2.5 shrink-0 group no-underline h-8">
          <BrandMark
            logoUrl={brandLogoUrl}
            className="w-8 h-8 shrink-0 transition-transform duration-200 group-hover:scale-105"
          />
          <span
            className="font-editorial brand-wordmark text-[22px] font-semibold tracking-tight whitespace-nowrap"
            style={{ color: 'var(--ink-primary)' }}
          >
            {brandName}
          </span>
        </Link>

        {/* Center: Crisp Single-Line Navigation (Never Wraps) */}
        <nav className="hidden lg:flex items-center gap-0.5 xl:gap-1 min-w-0" aria-label="Primary Navigation">
          {navLinks.map((item) => {
            const Icon = item.icon;
            const active = item.match(location.pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors no-underline"
                style={{
                  backgroundColor: active ? 'var(--bg-subtle)' : 'transparent',
                  color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                }}
              >
                <Icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: active ? 'var(--accent)' : 'currentColor' }}
                />
                <span>{item.label}</span>
              </Link>
            );
          })}

          {showOpenAgentEntry && (
            <Link
              to="/agent"
              className={`${backendNavCls} no-underline`}
              style={{
                backgroundColor: location.pathname.startsWith('/agent')
                  ? 'var(--accent-soft)'
                  : 'transparent',
                color: location.pathname.startsWith('/agent') ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              <Store
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: location.pathname.startsWith('/agent') ? 'var(--accent)' : 'currentColor' }}
              />
              <span>{m.hdrOpenAgentShort}</span>
            </Link>
          )}

          {showBackendEntry &&
            (isAdmin || isOwnerAgent ? (
              <Link
                to={isAdmin ? '/admin' : '/agent'}
                className={`${backendNavCls} no-underline`}
                style={backendNavStyle}
              >
                {isAdmin ? (
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Store className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{isAdmin ? m.hdrAdminShort : m.hdrAgentOpsShort}</span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void openBackendEntry()}
                className={`${backendNavCls} cursor-pointer`}
                style={backendNavStyle}
              >
                <Store className="w-3.5 h-3.5 shrink-0" />
                <span>{m.hdrAgentOpsShort}</span>
              </button>
            ))}

          {/* 自定义外链与自定义分组置于所有 Header 导航项最后 */}
          <HeaderExternalLinks entries={customHeaderEntries} />
        </nav>

        {/* Right: Compact Utility Controls + Notification Bell Badge + Account Pill */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenSearch}
            className="h-9 px-3 rounded-full border inline-flex items-center gap-1.5 text-xs cursor-pointer transition-colors whitespace-nowrap shrink-0"
            style={utilBtnStyle}
            title={m.hdrSearchTitle}
            aria-label={m.hdrSearchAria}
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden 2xl:inline">{m.hdrSearchShort}</span>
            <kbd
              className="hidden sm:inline-block font-mono-num text-[10px] px-1.5 py-0.5 rounded leading-none"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
            >
              ⌘K
            </kbd>
          </button>

          <select
            data-testid="header-locale-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as SupportedLocale)}
            className="h-9 px-2.5 rounded-full border text-xs font-medium cursor-pointer transition-colors shrink-0"
            style={utilBtnStyle}
            aria-label={t.languageLabel}
          >
            {LOCALE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>

          <HeaderCurrencySelect utilBtnStyle={utilBtnStyle} fxRates={bootstrap?.fx_rates} />

          <button
            type="button"
            onClick={() => toggleColorScheme()}
            className="w-9 h-9 rounded-full border inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
            style={utilBtnStyle}
            aria-label={m.hdrThemeAria}
          >
            <span className="theme-icon-to-dark items-center justify-center">
              <Moon className="w-3.5 h-3.5" />
              <span className="visually-hidden">{m.hdrSwitchDark}</span>
            </span>
            <span className="theme-icon-to-light items-center justify-center">
              <Sun className="w-3.5 h-3.5" />
              <span className="visually-hidden">{m.hdrSwitchLight}</span>
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenAnnouncements}
            className="relative w-9 h-9 rounded-full border inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
            style={utilBtnStyle}
            title={t.navAnnouncements}
            aria-label={
              unreadAnnouncementCount > 0
                ? `${t.navAnnouncements} ${fmt(m.hdrUnreadSuffix, { count: unreadAnnouncementCount })}`
                : t.navAnnouncements
            }
          >
            <Bell className="w-3.5 h-3.5 shrink-0" />
            {unreadAnnouncementCount > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full font-mono-num text-[10px] font-semibold flex items-center justify-center leading-none border-2"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#FAF9F5',
                  borderColor: 'var(--bg-canvas)',
                }}
              >
                {unreadAnnouncementCount > 99 ? '99+' : unreadAnnouncementCount}
              </span>
            )}
          </button>

          {user ? (
            <HeaderAccountMenu
              user={user}
              isAdmin={isAdmin}
              showBackendEntry={showBackendEntry}
              onOpenBackend={() => void openBackendEntry()}
              onLogout={onLogout}
            />
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
              className="h-9 px-4 rounded-full text-xs font-medium cursor-pointer transition-colors whitespace-nowrap shrink-0"
              style={{
                backgroundColor: 'var(--ink-primary)',
                color: 'var(--bg-canvas)',
              }}
            >
              {t.login}
            </button>
          )}
        </div>
      </div>

      {/* Mobile / Tablet compact horizontal nav bar */}
      <div
        className="flex lg:hidden items-center gap-1 overflow-x-auto px-4 py-2 border-t text-xs"
        style={{ borderColor: 'var(--border-color)' }}
      >
        {navLinks.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="shrink-0 whitespace-nowrap px-3 py-1 rounded-full font-medium no-underline"
            style={{
              backgroundColor: item.match(location.pathname) ? 'var(--bg-subtle)' : 'transparent',
              color: item.match(location.pathname) ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={onOpenAnnouncements}
          className="shrink-0 whitespace-nowrap px-3 py-1 rounded-full font-medium cursor-pointer"
          style={{ color: 'var(--ink-secondary)' }}
        >
          {t.navAnnouncements}
        </button>
        {showOpenAgentEntry && (
          <Link
            to="/agent"
            className="shrink-0 whitespace-nowrap px-3 py-1 rounded-full font-medium no-underline"
            style={{
              backgroundColor: location.pathname.startsWith('/agent') ? 'var(--accent-soft)' : 'transparent',
              color: location.pathname.startsWith('/agent') ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            {m.hdrOpenAgentShort}
          </Link>
        )}
        {showBackendEntry && (
          <button
            type="button"
            onClick={() => void openBackendEntry()}
            className="shrink-0 whitespace-nowrap px-3 py-1 rounded-full font-medium cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            {isAdmin ? m.hdrAdminShort : m.hdrAgentOpsShort}
          </button>
        )}
        {customHeaderEntries.flatMap((entry, idx) =>
          entry.type === 'link'
            ? [
                <a
                  key={`mob-link-${entry.url}-${idx}`}
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium no-underline"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span>{entry.label}</span>
                </a>,
              ]
            : entry.items.map((sub, subIdx) => (
                <a
                  key={`mob-grp-${idx}-${sub.url}-${subIdx}`}
                  href={sub.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-3 py-1 rounded-full font-medium no-underline"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span>
                    {entry.label} · {sub.label}
                  </span>
                </a>
              ))
        )}
      </div>
    </header>
  );
}

function HeaderCurrencySelect({
  utilBtnStyle,
  fxRates,
}: {
  utilBtnStyle: React.CSSProperties;
  fxRates?: FxDisplayRatesDto;
}) {
  const pc = useExtensionsI18n();
  const { currency, setCurrency } = useDisplayCurrency();

  useEffect(() => {
    if (fxRates) syncFxDisplayRates(fxRates);
  }, [fxRates]);

  return (
    <select
      data-testid="header-currency-select"
      value={currency}
      onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
      className="h-9 px-2 rounded-full border text-xs font-mono-num font-medium cursor-pointer transition-colors shrink-0"
      style={utilBtnStyle}
      aria-label={pc.currencyAria}
      title={pc.currencySettlementHint}
    >
      {DISPLAY_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {CURRENCY_META[code].symbol} {code}
        </option>
      ))}
    </select>
  );
}
