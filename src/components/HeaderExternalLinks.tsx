/**
 * 顶部导航栏自定义外链与自定义分组菜单（置于 Header 最末位）
 * - 单链（type: 'link'）：直接单显（文字前带外链图标）
 * - 分组（type: 'group'）：展示自定义分组名称，点击展开圆角卡片竖排列表，支持多分组互斥展开
 */

import type { HeaderNavEntry } from '@shared/domain/header-links';
import { ChevronDown, ExternalLink, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function HeaderExternalLinks({ entries }: { entries: HeaderNavEntry[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenIdx(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIdx(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [openIdx]);

  if (entries.length === 0) return null;

  return (
    <div ref={wrapRef} className="inline-flex items-center gap-1 shrink-0">
      {entries.map((entry, idx) => {
        if (entry.type === 'link') {
          return (
            <a
              key={`link-${entry.url}-${idx}`}
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors no-underline hover:bg-[var(--bg-subtle)]"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              <span>{entry.label}</span>
            </a>
          );
        }

        const isOpen = openIdx === idx;
        return (
          <div key={`group-${entry.label}-${idx}`} className="relative shrink-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenIdx((curr) => (curr === idx ? null : idx))}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap cursor-pointer transition-colors hover:bg-[var(--bg-subtle)]"
              style={{
                backgroundColor: isOpen ? 'var(--bg-subtle)' : 'transparent',
                color: isOpen ? 'var(--ink-primary)' : 'var(--ink-secondary)',
              }}
            >
              <Link2 className="w-3.5 h-3.5 shrink-0" />
              <span>{entry.label}</span>
              <ChevronDown
                className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && (
              <div
                className="absolute right-0 top-full mt-2 min-w-[184px] rounded-2xl border p-2 shadow-lg z-50 space-y-0.5"
                style={{
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--bg-surface)',
                }}
              >
                {entry.items.map((ext, subIdx) => (
                  <a
                    key={`${ext.url}-${subIdx}`}
                    href={ext.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpenIdx(null)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium whitespace-nowrap no-underline transition-colors hover:bg-[var(--bg-subtle)]"
                    style={{ color: 'var(--ink-primary)' }}
                  >
                    <ExternalLink className="w-4 h-4 shrink-0" style={{ color: 'var(--ink-secondary)' }} />
                    <span>{ext.label}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
