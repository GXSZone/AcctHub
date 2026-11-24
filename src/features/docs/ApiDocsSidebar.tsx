/**
 * 开放平台 API 文档左侧分组导航与状态码参考栏
 */

import { AlertTriangle, FileCode2 } from 'lucide-react';
import { useDocsI18n } from '../../i18n/namespaces/docs';
import type { DocsGroupMetaItem, EndpointSpec } from './api-docs.catalog';
import { methodStyle } from './api-docs.snippets';

interface ApiDocsSidebarProps {
  activeGroup: string;
  allowedGroups: DocsGroupMetaItem[];
  allowedCount: number;
  visibleEndpoints: EndpointSpec[];
  onSelectGroup: (group: string) => void;
}

export function ApiDocsSidebar({
  activeGroup,
  allowedGroups,
  allowedCount,
  visibleEndpoints,
  onSelectGroup,
}: ApiDocsSidebarProps) {
  const d = useDocsI18n();
  return (
    <aside className="w-full lg:w-[270px] shrink-0 lg:sticky lg:top-20 space-y-4">
      <div className="paper-card rounded-2xl p-4">
        <div
          className="flex items-center gap-2 pb-3 mb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <FileCode2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="font-editorial text-lg font-semibold">{d.sidebarTitle}</span>
        </div>

        <div className="space-y-1 text-xs">
          <button
            type="button"
            onClick={() => onSelectGroup('all')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl font-medium cursor-pointer"
            style={{
              backgroundColor: activeGroup === 'all' ? 'var(--accent-soft)' : 'transparent',
              color: activeGroup === 'all' ? 'var(--accent)' : 'var(--ink-primary)',
            }}
          >
            <span>{d.sidebarAllOverview}</span>
            <span className="font-mono-num">{allowedCount}</span>
          </button>

          {allowedGroups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectGroup(g.id)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl font-medium cursor-pointer text-left"
              style={{
                backgroundColor: activeGroup === g.id ? 'var(--bg-subtle)' : 'transparent',
                color: activeGroup === g.id ? 'var(--ink-primary)' : 'var(--ink-secondary)',
              }}
            >
              <span className="truncate">{g.label}</span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-muted)' }}
              >
                {g.badge}
              </span>
            </button>
          ))}
        </div>

        <div
          className="mt-4 pt-4 border-t space-y-1 max-h-64 overflow-y-auto"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div
            className="text-[10.5px] font-mono-num uppercase tracking-wider px-2 mb-1.5"
            style={{ color: 'var(--ink-muted)' }}
          >
            ENDPOINTS
          </div>
          {visibleEndpoints.map((ep) => {
            const ms = methodStyle(ep.method);
            return (
              <a
                key={ep.id}
                href={`#${ep.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11.5px] no-underline hover:underline"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <span
                  className="font-mono-num text-[9.5px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                  style={{ backgroundColor: ms.bg, color: ms.color }}
                >
                  {ep.method}
                </span>
                <span className="truncate font-mono-num">{ep.path.replace('/api', '')}</span>
              </a>
            );
          })}
        </div>
      </div>

      <div className="paper-card rounded-2xl p-4 text-xs space-y-2">
        <div className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--warning)' }} />
          {d.statusCodesTitle}
        </div>
        <div className="space-y-1.5 font-mono-num text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
          <div>
            <strong style={{ color: 'var(--success)' }}>200</strong> · {d.status200}
          </div>
          <div>
            <strong style={{ color: 'var(--warning)' }}>400</strong> · {d.status400}
          </div>
          <div>
            <strong style={{ color: 'var(--danger)' }}>401</strong> · {d.status401}
          </div>
          <div>
            <strong style={{ color: 'var(--danger)' }}>402</strong> · {d.status402}
          </div>
          <div>
            <strong style={{ color: 'var(--danger)' }}>403</strong> · {d.status403}
          </div>
          <div>
            <strong style={{ color: 'var(--warning)' }}>409</strong> · {d.status409}
          </div>
          <div>
            <strong style={{ color: 'var(--danger)' }}>429</strong> · {d.status429}
          </div>
        </div>
      </div>
    </aside>
  );
}
