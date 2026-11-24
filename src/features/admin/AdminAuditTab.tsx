import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Download, Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { type AdminAuditLogRow, adminApi } from '../../api/admin.api';
import { getAuthScope } from '../../api/http';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';

/**
 * 总控操作审计日志查询面板：展示敏感写操作轨迹、自动脱敏快照与 CSV 导出
 */
export function AdminAuditTab({ showToast }: { showToast: (msg: string) => void }) {
  const ac = useAdminCoreI18n();
  const [searchQ, setSearchQ] = useState('');
  const [targetFilter, setTargetFilter] = useState('');
  const [days, setDays] = useState(30);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = { q: searchQ || undefined, target_type: targetFilter || undefined, days };
  const logsQuery = useQuery({
    queryKey: ['admin', 'audit-logs', filters],
    queryFn: () => adminApi.auditLogs(filters),
  });

  const logs: AdminAuditLogRow[] = logsQuery.data?.logs ?? [];

  const handleExportCsv = async () => {
    const scope = getAuthScope();
    setExporting(true);
    try {
      const blob = await adminApi.downloadAuditLogsCsv(filters);
      if (scope !== getAuthScope()) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accthub-audit-logs-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(ac.audExportedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : ac.audExportFailErr);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="paper-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={ac.audSearchPlaceholder}
              className="acct-input pl-9 text-xs"
            />
          </div>
          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            className="acct-input w-36 text-xs"
          >
            <option value="">{ac.audTypeAll}</option>
            <option value="products">{ac.audTypeProducts}</option>
            <option value="orders">{ac.audTypeOrders}</option>
            <option value="withdrawals">{ac.audTypeWithdrawals}</option>
            <option value="agents">{ac.audTypeAgents}</option>
            <option value="payment-plugins">{ac.audTypePayments}</option>
            <option value="settings">{ac.audTypeSettings}</option>
            <option value="upstreams">{ac.audTypeUpstreams}</option>
            <option value="cdks">{ac.audTypeCdks}</option>
          </select>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="acct-input w-28 text-xs"
          >
            <option value={7}>{ac.audDays7}</option>
            <option value={30}>{ac.audDays30}</option>
            <option value={90}>{ac.audDays90}</option>
          </select>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void logsQuery.refetch()}
            className="px-3 py-2 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />
            {ac.audRefreshBtn}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportCsv()}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {ac.audExportBtn}
          </button>
        </div>
      </div>

      <div className="paper-card rounded-2xl p-4 sm:p-5">
        {logsQuery.isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center space-y-2" style={{ color: 'var(--ink-muted)' }}>
            <ShieldAlert className="w-6 h-6 mx-auto opacity-70" />
            <div className="text-xs">{ac.audEmpty}</div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {logs.map((row) => {
              const isOpen = expandedId === row.id;
              return (
                <div
                  key={row.id}
                  className="rounded-xl border p-3.5 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : row.id)}
                    className="w-full text-left flex flex-wrap items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="font-mono-num text-[11px] font-semibold px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {row.action}
                        </span>
                        <span className="font-medium truncate">{row.summary}</span>
                      </div>
                      <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(ac.audActorMeta, {
                          email: row.actorEmail,
                          role: row.actorRole,
                          ip: row.ip || '-',
                          time: row.createdAt,
                        })}
                      </div>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      style={{ color: 'var(--ink-muted)' }}
                    />
                  </button>

                  {isOpen && (
                    <div
                      className="mt-3 pt-3 border-t space-y-2 text-[11px] font-mono-num"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <div style={{ color: 'var(--ink-muted)' }}>Request ID: {row.requestId || '-'}</div>
                      <div>
                        <div className="font-semibold mb-1" style={{ color: 'var(--ink-secondary)' }}>
                          {ac.audSnapshotTitle}
                        </div>
                        <pre
                          className="p-2.5 rounded-lg overflow-x-auto text-[11px] leading-relaxed"
                          style={{ backgroundColor: 'var(--bg-surface)' }}
                        >
                          {row.afterJson}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
