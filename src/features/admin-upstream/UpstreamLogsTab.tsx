/**
 * 上游定时同步与风控熔断审计日志视图
 */

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { UpstreamSyncLogRecord } from '../../api/upstream.api';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';

export function UpstreamLogsTab({ logs }: { logs: UpstreamSyncLogRecord[] }) {
  const au = useAdminUpstreamI18n();

  return (
    <div className="paper-card rounded-2xl p-5 space-y-3">
      <h3 className="font-editorial text-lg font-semibold">{au.logsTitle}</h3>
      {logs.length === 0 ? (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
          {au.logsEmpty}
        </p>
      ) : (
        <div className="space-y-2.5">
          {logs.map((log) => (
            <div
              key={log.id}
              className="p-3.5 rounded-xl border text-xs space-y-1.5"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--success)' }} />
                  ) : (
                    <XCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                  )}
                  <span className="font-semibold">{log.source_name}</span>
                  <span
                    className="text-[10.5px] px-1.5 py-0.5 rounded font-mono-num"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    {log.trigger_type === 'cron' ? au.triggerCron : au.triggerManual} · {log.duration_ms}ms
                  </span>
                </div>
                <span className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                  {log.created_at}
                </span>
              </div>
              <div style={{ color: 'var(--ink-secondary)' }}>{log.message}</div>
              {log.alerts && log.alerts.length > 0 && (
                <div
                  className="p-2.5 rounded-lg space-y-1 text-[11px]"
                  style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                >
                  {log.alerts.map((al, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{al}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
