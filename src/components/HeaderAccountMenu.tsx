/**
 * 顶部导航栏右侧登录账户胶囊与下拉菜单
 */

import { ChevronDown, LogOut, ReceiptText, ShieldCheck, Store, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import type { UserProfile } from '../types';

interface HeaderAccountMenuProps {
  user: UserProfile;
  isAdmin: boolean;
  showBackendEntry: boolean;
  onOpenBackend: () => void;
  onLogout: () => void;
}

const MENU_ACTION_CLS =
  'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left transition-colors text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--accent)]';

export function HeaderAccountMenu({
  user,
  isAdmin,
  showBackendEntry,
  onOpenBackend,
  onLogout,
}: HeaderAccountMenuProps) {
  const { messages: t } = useI18n();
  const m = useCommonModalsI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const accountMenuItems: Array<{ label: string; to?: string; onClick?: () => void; icon: typeof Wallet }> = [
    { label: m.hdrEnterAccount, to: '/account/home', icon: Wallet },
    { label: m.hdrMyOrders, to: '/account/orders', icon: ReceiptText },
    ...(showBackendEntry
      ? [
          {
            label: isAdmin ? m.hdrEnterAdmin : m.hdrAgentOpsShort,
            onClick: onOpenBackend,
            icon: isAdmin ? ShieldCheck : Store,
          },
        ]
      : []),
  ];

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className="h-9 flex items-center gap-2 pl-1.5 pr-3 rounded-full border cursor-pointer transition-colors whitespace-nowrap"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {user.display_name.slice(0, 1).toUpperCase()}
        </span>
        <div className="text-left leading-none hidden sm:block">
          <div className="text-[12px] font-semibold max-w-[92px] truncate">{user.display_name}</div>
          <div className="text-[10.5px] font-mono-num mt-0.5" style={{ color: 'var(--success)' }}>
            ¥{user.balance.toFixed(2)}
          </div>
        </div>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ink-muted)' }} />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-2xl p-2 paper-card z-50"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <div className="px-3 py-2 border-b mb-1" style={{ borderColor: 'var(--border-color)' }}>
            <div className="text-xs font-semibold truncate">{user.email}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                {user.role === 'admin'
                  ? m.hdrRoleAdmin
                  : user.role === 'agent'
                    ? m.hdrRoleAgent
                    : m.hdrRoleMember}
              </span>
              <span className="text-xs font-mono-num font-semibold" style={{ color: 'var(--success)' }}>
                ¥{user.balance.toFixed(2)}
              </span>
            </div>
          </div>
          {accountMenuItems.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (item.onClick) item.onClick();
                  else if (item.to) navigate(item.to);
                }}
                className={`${MENU_ACTION_CLS} mt-1 first:mt-0`}
              >
                <ItemIcon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
          <div className="my-1 border-t" style={{ borderColor: 'var(--border-color)' }} />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onLogout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left transition-colors text-[var(--danger)] hover:bg-[var(--danger-soft)]"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t.logout}
          </button>
        </div>
      )}
    </div>
  );
}
