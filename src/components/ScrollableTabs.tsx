import { ChevronLeft, ChevronRight } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiKitI18n } from '../i18n/namespaces/ui-kit';

export interface ScrollableTabItem<T extends string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface ScrollableTabsProps<T extends string> {
  tabs: Array<ScrollableTabItem<T>>;
  activeId: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}

export function ScrollableTabs<T extends string>({
  tabs,
  activeId,
  onChange,
  ariaLabel,
}: ScrollableTabsProps<T>) {
  const ui = useUiKitI18n();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  const tabCount = tabs.length;
  useEffect(() => {
    void tabCount;
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(el);
    window.addEventListener('resize', updateEdges);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateEdges);
    };
  }, [updateEdges, tabCount]);

  const scrollStep = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(220, Math.round(el.clientWidth * 0.55)), behavior: 'smooth' });
  };

  return (
    <div className="relative group" role="tablist" aria-label={ariaLabel || ui.tabsAriaDefault}>
      {canLeft && (
        <div
          className="absolute left-0 top-0 bottom-0 z-10 flex items-center pr-6 pointer-events-none"
          style={{
            background: 'linear-gradient(to right, var(--bg-canvas) 45%, transparent)',
          }}
        >
          <button
            type="button"
            onClick={() => scrollStep(-1)}
            aria-label={ui.tabsScrollLeft}
            className="pointer-events-auto w-8 h-8 rounded-full border shadow-sm inline-flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
              color: 'var(--ink-primary)',
            }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        onWheel={(e) => {
          const el = scrollerRef.current;
          if (!el || el.scrollWidth <= el.clientWidth) return;
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            el.scrollLeft += e.deltaY;
          }
        }}
        className="flex items-center gap-1.5 overflow-x-auto py-0.5 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = activeId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={(e) => {
                onChange(item.id);
                e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
              }}
              className="shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium cursor-pointer border transition-colors"
              style={{
                backgroundColor: active ? 'var(--accent)' : 'var(--bg-surface)',
                color: active ? '#FAF9F5' : 'var(--ink-secondary)',
                borderColor: active ? 'transparent' : 'var(--border-color)',
              }}
            >
              {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
              {item.label}
            </button>
          );
        })}
      </div>

      {canRight && (
        <div
          className="absolute right-0 top-0 bottom-0 z-10 flex items-center pl-6 pointer-events-none"
          style={{
            background: 'linear-gradient(to left, var(--bg-canvas) 45%, transparent)',
          }}
        >
          <button
            type="button"
            onClick={() => scrollStep(1)}
            aria-label={ui.tabsScrollRight}
            className="pointer-events-auto w-8 h-8 rounded-full border shadow-sm inline-flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
              color: 'var(--ink-primary)',
            }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
