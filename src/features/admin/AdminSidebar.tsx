/**
 * 总控后台桌面端可折叠侧边导航栏与移动端抽屉导航
 */

import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type React from 'react';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import type { AdminTab } from './admin.types';

export interface AdminNavItem<TTab extends string = AdminTab> {
  id: TTab;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeTone?: 'danger' | 'warning';
}

export interface AdminNavGroup<TTab extends string = AdminTab> {
  groupLabel: string;
  items: Array<AdminNavItem<TTab>>;
}

interface AdminSidebarProps<TTab extends string = AdminTab> {
  navGroups: Array<AdminNavGroup<TTab>>;
  activeTab: TTab;
  collapsed: boolean;
  mobileOpen: boolean;
  eyebrow?: string;
  title?: string;
  mobileTitle?: string;
  footerSlot?: React.ReactNode;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onSelectTab: (tab: TTab) => void;
}

export function AdminSidebar<TTab extends string = AdminTab>({
  navGroups,
  activeTab,
  collapsed,
  mobileOpen,
  eyebrow = 'ADMIN CONSOLE',
  title,
  mobileTitle,
  footerSlot,
  onToggleCollapse,
  onCloseMobile,
  onSelectTab,
}: AdminSidebarProps<TTab>) {
  const ac = useAdminCoreI18n();
  const renderNav = (isMobile = false) => {
    const isCollapsed = collapsed && !isMobile;
    return (
      <nav className="space-y-3" aria-label={ac.sidebarNavAria}>
        {navGroups.map((grp, gIdx) => (
          <div key={grp.groupLabel} className="space-y-1">
            <div className="h-5 px-2.5 flex items-center relative overflow-hidden">
              <span
                className={`text-[10.5px] font-semibold uppercase tracking-wider whitespace-nowrap transition-opacity duration-150 ${
                  isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
                style={{ color: 'var(--ink-muted)' }}
              >
                {grp.groupLabel}
              </span>
              {gIdx > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-2.5 w-4 h-px transition-opacity duration-150 ${
                    isCollapsed ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                  style={{ backgroundColor: 'var(--border-strong)' }}
                />
              )}
            </div>
            {grp.items.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              const hasBadge = Boolean(item.badge && item.badge > 0);
              return (
                <button
                  key={item.id}
                  type="button"
                  title={isCollapsed ? item.label : undefined}
                  onClick={() => {
                    onSelectTab(item.id);
                    if (isMobile) onCloseMobile();
                  }}
                  className="w-full h-9 px-2.5 flex items-center rounded-xl text-xs font-medium transition-colors cursor-pointer overflow-hidden"
                  style={{
                    backgroundColor: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#FAF9F5' : 'var(--ink-secondary)',
                  }}
                >
                  <span className="relative shrink-0 inline-flex items-center justify-center w-4 h-4">
                    <Icon className="w-4 h-4" />
                    {isCollapsed && hasBadge && (
                      <span
                        className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: active
                            ? '#FAF9F5'
                            : item.badgeTone === 'danger'
                              ? 'var(--danger)'
                              : 'var(--warning)',
                        }}
                      />
                    )}
                  </span>
                  <span
                    className={`ml-2.5 flex-1 text-left truncate whitespace-nowrap transition-opacity duration-150 ${
                      isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                    }`}
                  >
                    {item.label}
                  </span>
                  {hasBadge && (
                    <span
                      className={`ml-1.5 text-[10.5px] font-mono-num font-semibold px-1.5 py-0.5 rounded-full leading-none shrink-0 transition-opacity duration-150 ${
                        isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                      }`}
                      style={{
                        backgroundColor: active
                          ? 'rgba(255,255,255,0.22)'
                          : item.badgeTone === 'danger'
                            ? 'var(--danger-soft)'
                            : 'var(--warning-soft)',
                        color: active
                          ? '#FAF9F5'
                          : item.badgeTone === 'danger'
                            ? 'var(--danger)'
                            : 'var(--warning)',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    );
  };

  return (
    <>
      <aside
        className={`hidden lg:flex flex-col paper-card rounded-2xl p-3 sticky top-[81px] max-h-[calc(100dvh-97px)] shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
          collapsed ? 'w-[62px]' : 'w-[236px]'
        }`}
      >
        <div
          className="h-11 pb-2.5 mb-2.5 border-b flex items-center overflow-hidden shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-9 h-9 rounded-xl inline-flex items-center justify-center shrink-0 cursor-pointer hover:bg-black/5 transition-colors"
            style={{ color: 'var(--ink-secondary)' }}
            title={collapsed ? ac.sidebarExpand : ac.sidebarCollapse}
            aria-label={collapsed ? ac.sidebarExpand : ac.sidebarCollapse}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
          <div
            className={`ml-2 min-w-0 whitespace-nowrap transition-opacity duration-150 ${
              collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <div
              className="text-[10px] font-mono-num uppercase tracking-widest leading-tight"
              style={{ color: 'var(--accent)' }}
            >
              {eyebrow}
            </div>
            <div className="font-editorial text-sm font-semibold leading-tight mt-0.5 truncate max-w-[155px]">
              {title || ac.sidebarTitle}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{renderNav(false)}</div>
        {!collapsed && footerSlot && (
          <div className="pt-2.5 mt-2.5 border-t shrink-0" style={{ borderColor: 'var(--border-color)' }}>
            {footerSlot}
          </div>
        )}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <button
            type="button"
            aria-label={ac.sidebarCloseAria}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] border-0 cursor-default"
            onClick={onCloseMobile}
          />
          <div
            className="relative w-72 max-w-[85vw] h-full overflow-y-auto p-4 shadow-2xl border-r"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
          >
            <div
              className="flex items-center justify-between pb-3 mb-3 border-b"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <span className="font-editorial text-lg font-semibold truncate">
                {mobileTitle || title || ac.sidebarMobileTitle}
              </span>
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 rounded-full cursor-pointer"
                style={{ backgroundColor: 'var(--bg-subtle)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderNav(true)}
            {footerSlot && (
              <div className="pt-3 mt-3 border-t" style={{ borderColor: 'var(--border-color)' }}>
                {footerSlot}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
