/**
 * 会员中心工单对话详情与回复子组件
 */

import { Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { accountApi } from '../../api/account.api';
import { TicketOrderCard, WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { useAccountI18n } from '../../i18n/namespaces/account';
import type { SupportTicketRecord, TicketMessageRecord } from '../../types';

interface AccountTicketDetailProps {
  ticket: SupportTicketRecord;
  messages: TicketMessageRecord[];
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
}

export function AccountTicketDetail({
  ticket,
  messages,
  onBack,
  onRefresh,
  onToast,
}: AccountTicketDetailProps) {
  const acc = useAccountI18n();
  const statusMeta = useMemo<Record<string, { label: string; bg: string; color: string }>>(
    () => ({
      open: { label: acc.tkStatusOpen, bg: 'var(--accent-soft)', color: 'var(--accent)' },
      agent_replied: { label: acc.tkStatusAgentReplied, bg: 'var(--success-soft)', color: 'var(--success)' },
      escalated: { label: acc.tkStatusEscalated, bg: 'var(--warning-soft)', color: 'var(--warning)' },
      admin_replied: { label: acc.tkStatusAdminReplied, bg: 'var(--success-soft)', color: 'var(--success)' },
      resolved: { label: acc.tkStatusResolved, bg: 'var(--success-soft)', color: 'var(--success)' },
      closed: { label: acc.tkStatusClosed, bg: 'var(--bg-subtle)', color: 'var(--ink-muted)' },
    }),
    [acc]
  );
  const [replyText, setReplyText] = useState('');
  const [replySending, setReplySending] = useState(false);
  const st = statusMeta[ticket.status] || statusMeta.open;

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono-num text-xs font-semibold">{ticket.ticket_no}</span>
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: st.bg, color: st.color }}
            >
              {st.label}
            </span>
            <WarrantyStatusBadge warranty={ticket.order_info?.warranty} compact />
          </div>
          <h2 className="font-editorial text-lg font-semibold mt-1">{ticket.subject}</h2>
        </div>
        <div className="flex items-center gap-2">
          {ticket.status !== 'closed' && (
            <button
              type="button"
              onClick={async () => {
                await accountApi.closeTicket(ticket.id);
                await onRefresh();
                onToast(acc.tkDetailClosedToast);
              }}
              className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {acc.tkDetailCloseBtn}
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {acc.tkDetailBackBtn}
          </button>
        </div>
      </div>

      {ticket.order_info && (
        <TicketOrderCard order={ticket.order_info} showDeliveredPayload title={acc.tkDetailOrderCardTitle} />
      )}

      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
        {messages.map((m) => {
          const isMe = m.sender_role === 'user';
          return (
            <div
              key={m.id}
              className="p-3.5 rounded-xl border text-xs space-y-1"
              style={{
                borderColor: isMe ? 'var(--border-color)' : 'var(--accent)',
                backgroundColor: isMe ? 'var(--bg-canvas)' : 'var(--accent-soft)',
              }}
            >
              <div
                className="flex items-center justify-between text-[11px]"
                style={{ color: 'var(--ink-muted)' }}
              >
                <strong style={{ color: isMe ? 'var(--ink-primary)' : 'var(--accent)' }}>
                  {m.sender_name}
                </strong>
                <span className="font-mono-num">{m.created_at}</span>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--ink-primary)' }}>
                {m.content}
              </div>
            </div>
          );
        })}
      </div>

      {ticket.status !== 'closed' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!replyText.trim()) return;
            setReplySending(true);
            try {
              await accountApi.replyTicket(ticket.id, replyText);
              setReplyText('');
              await onRefresh();
            } finally {
              setReplySending(false);
            }
          }}
          className="flex gap-2 pt-2"
        >
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder={acc.tkDetailReplyPlaceholder}
            className="acct-input flex-1 text-xs"
          />
          <button
            type="submit"
            disabled={replySending}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Send className="w-3.5 h-3.5" />
            {acc.tkDetailSendBtn}
          </button>
        </form>
      )}
    </div>
  );
}
