/**
 * 通用无业务耦合分页导航栏原语（支持上一页 / 下一页 / 总条数与页码汇总）
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmt } from '../../i18n';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
  className?: string;
}

export function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPageChange,
  className = '',
}: PaginationBarProps) {
  const ui = useUiKitI18n();
  if (totalItems <= 0) return null;

  const safePages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safePages);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 pt-3 border-t text-xs ${className}`}
      style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
    >
      <span className="font-mono-num">
        {fmt(ui.pageSummary, { total: totalItems, page: safePage, pages: safePages })}
      </span>
      <div className="inline-flex items-center gap-1.5">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{
            borderColor: 'var(--border-strong)',
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--ink-primary)',
          }}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {ui.pagePrev}
        </button>
        <button
          type="button"
          disabled={safePage >= safePages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{
            borderColor: 'var(--border-strong)',
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--ink-primary)',
          }}
        >
          {ui.pageNext}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
