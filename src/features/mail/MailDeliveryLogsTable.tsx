/**
 * 独立发卡邮箱投递日志表格子组件
 */

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { fmt } from '../../i18n';
import { useMailI18n } from '../../i18n/namespaces/mail';
import type { EmailDeliveryLogRow } from '../../types';

interface MailDeliveryLogsTableProps {
  logs: EmailDeliveryLogRow[];
  isAgent: boolean;
}

export function MailDeliveryLogsTable({ logs, isAgent }: MailDeliveryLogsTableProps) {
  const mt = useMailI18n();
  const sceneLabels: Record<string, string> = {
    order_created: mt.sceneCreated,
    order_delivery: mt.sceneDelivery,
    order_replacement: mt.sceneReplacement,
    order_resend: mt.sceneResend,
    restock_alert: mt.sceneRestock,
    test: mt.sceneTest,
  };

  return (
    <div className="pt-4 border-t space-y-2.5" style={{ borderColor: 'var(--border-color)' }}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold">{fmt(mt.logsTitle, { count: logs.length })}</span>
        <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {isAgent ? mt.logsScopeAgent : mt.logsScopeAdmin}
        </span>
      </div>
      {logs.length === 0 ? (
        <p
          className="text-xs py-5 text-center rounded-xl border"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
        >
          {mt.logsEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border-color)' }}>
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{
                  borderColor: 'var(--border-color)',
                  backgroundColor: 'var(--bg-canvas)',
                  color: 'var(--ink-muted)',
                }}
              >
                <th className="py-2 px-3">{mt.colScene}</th>
                <th className="py-2 px-3">{mt.colRecipient}</th>
                <th className="py-2 px-3">{mt.colProvider}</th>
                <th className="py-2 px-3">{mt.colStatus}</th>
                <th className="py-2 px-3 text-right">{mt.colTime}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((lg) => (
                <tr
                  key={lg.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="font-medium">{sceneLabels[lg.scene] || lg.scene}</span>
                    {lg.order_no && (
                      <span
                        className="ml-1.5 font-mono-num text-[11px]"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {lg.order_no}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 font-mono-num">{lg.to_email}</td>
                  <td
                    className="py-2 px-3 font-mono-num uppercase text-[11px]"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {lg.provider}
                  </td>
                  <td className="py-2 px-3">
                    {lg.status === 'sent' ? (
                      <span
                        className="inline-flex items-center gap-1 font-medium"
                        style={{ color: 'var(--success)' }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {mt.statusDelivered}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1"
                        style={{ color: 'var(--danger)' }}
                        title={lg.error_message}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate max-w-[220px]">
                          {lg.error_message || mt.statusFailedFallback}
                        </span>
                      </span>
                    )}
                  </td>
                  <td
                    className="py-2 px-3 text-right font-mono-num text-[11px] whitespace-nowrap"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {lg.created_at}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
