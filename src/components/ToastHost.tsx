/**
 * 全局视口悬浮气泡通知容器（固定显示于视口右上角，脱离页面滚动流）
 */

import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import {
  dismissToast,
  subscribeToasts,
  type ToastAction,
  type ToastItem,
  type ToastTone,
} from '../lib/toast';

function ToastActionButton({ action, onTrigger }: { action: ToastAction; onTrigger: () => void }) {
  const inRouter = useInRouterContext();
  if (!inRouter) {
    return (
      <a
        href={action.to}
        onClick={onTrigger}
        className="mt-1.5 inline-flex items-center text-[11px] font-semibold underline underline-offset-2"
        style={{ color: 'var(--accent)' }}
      >
        {action.label}
      </a>
    );
  }
  return <RouterToastActionButton action={action} onTrigger={onTrigger} />;
}

function RouterToastActionButton({ action, onTrigger }: { action: ToastAction; onTrigger: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        onTrigger();
        navigate(action.to);
      }}
      className="mt-1.5 inline-flex items-center text-[11px] font-semibold underline underline-offset-2 cursor-pointer"
      style={{ color: 'var(--accent)' }}
    >
      {action.label}
    </button>
  );
}

function toneStyle(tone: ToastTone): {
  bg: string;
  border: string;
  fg: string;
  Icon: typeof CheckCircle2;
} {
  switch (tone) {
    case 'success':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--success)',
        fg: 'var(--success)',
        Icon: CheckCircle2,
      };
    case 'error':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--danger)',
        fg: 'var(--danger)',
        Icon: AlertCircle,
      };
    case 'warning':
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--warning)',
        fg: 'var(--warning)',
        Icon: AlertTriangle,
      };
    default:
      return {
        bg: 'var(--bg-surface)',
        border: 'var(--accent)',
        fg: 'var(--accent)',
        Icon: Info,
      };
  }
}

export function ToastHost() {
  const m = useCommonModalsI18n();
  const [items, setItems] = useState<ToastItem[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeToasts(setItems);
  }, []);

  useEffect(() => {
    const el = hostRef.current as
      | (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void })
      | null;
    if (!el || typeof el.showPopover !== 'function' || typeof el.hidePopover !== 'function') return;
    try {
      if (items.length > 0) {
        // 每次气泡变更时重排进 top-layer 末尾，确保始终悬浮于原生 <dialog.showModal()> 之上
        if (el.matches(':popover-open')) el.hidePopover();
        el.showPopover();
      } else if (el.matches(':popover-open')) {
        el.hidePopover();
      }
    } catch {
      // 兼容不支持原生 popover 的测试或旧环境
    }
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div
      ref={hostRef}
      popover="manual"
      className="fixed top-20 right-4 left-4 sm:left-auto sm:right-6 bottom-auto z-[95] flex flex-col gap-2.5 sm:w-[24rem] pointer-events-none"
      style={{
        margin: 0,
        padding: 0,
        border: 'none',
        backgroundColor: 'transparent',
        overflow: 'visible',
      }}
      aria-live="polite"
    >
      {items.map((item) => {
        const { bg, border, fg, Icon } = toneStyle(item.tone);
        return (
          <div
            key={item.id}
            role={item.tone === 'error' && item.alertRole ? 'alert' : 'status'}
            className="pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg flex items-start gap-2.5 text-xs leading-relaxed backdrop-blur-sm transition-all"
            style={{
              backgroundColor: bg,
              borderColor: border,
              color: 'var(--ink-primary)',
              boxShadow: '0 10px 30px -10px rgba(18, 17, 16, 0.22)',
            }}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: fg }} />
            <div className="flex-1 min-w-0 font-medium break-words">
              <div>{item.message}</div>
              {item.action && (
                <ToastActionButton action={item.action} onTrigger={() => dismissToast(item.id)} />
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className="w-5 h-5 -mr-1 -mt-0.5 rounded-full inline-flex items-center justify-center shrink-0 cursor-pointer opacity-60 hover:opacity-100"
              style={{ color: 'var(--ink-muted)' }}
              aria-label={m.toastCloseAria}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
