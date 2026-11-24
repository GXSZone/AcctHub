/**
 * 分站工作台 Tab 5：本店客户售后工单（分级回复与转交平台总控处理）
 */

import { Loader2, RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { agentApi } from '../../api/agent.api';
import { TicketOrderCard, WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useAgentTicketsQuery } from '../../queries/agent.queries';
import type { SupportTicketRecord, TicketMessageRecord } from '../../types';

import { isAgentTicketUnread, type TicketSeenMap } from './agent-ticket-unread';

interface AgentTicketsTabProps {
  seenMap?: TicketSeenMap;
  onMarkTicketSeen?: (ticketId: number, lastMessageId: number) => void;
  onToast: (msg: string) => void;
}

export function AgentTicketsTab({ seenMap = {}, onMarkTicketSeen, onToast }: AgentTicketsTabProps) {
  const ag = useAgentI18n();
  const ticketsQuery = useAgentTicketsQuery(true);
  const storeTickets = ticketsQuery.data?.tickets ?? [];

  const [activeStoreTicket, setActiveStoreTicket] = useState<{
    ticket: SupportTicketRecord;
    messages: TicketMessageRecord[];
  } | null>(null);
  const [storeReplyText, setStoreReplyText] = useState('');

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{ag.atkTitle}</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {ag.atkDesc}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void ticketsQuery.refetch()}
          className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer inline-flex items-center gap-1"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${ticketsQuery.isFetching ? 'animate-spin' : ''}`} />
          {ag.atkRefreshBtn}
        </button>
      </div>

      {activeStoreTicket ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                {fmt(ag.atkCustomerMeta, {
                  ticketNo: activeStoreTicket.ticket.ticket_no,
                  email: activeStoreTicket.ticket.contact_email,
                })}
                {activeStoreTicket.ticket.order_no
                  ? fmt(ag.atkOrderPart, { orderNo: activeStoreTicket.ticket.order_no })
                  : ''}
              </div>
              <div className="font-semibold text-sm mt-0.5">{activeStoreTicket.ticket.subject}</div>
            </div>
            <div className="flex items-center gap-2">
              {!activeStoreTicket.ticket.escalated_to_admin && (
                <button
                  type="button"
                  onClick={async () => {
                    await agentApi.escalateTicket(activeStoreTicket.ticket.id);
                    const detail = await agentApi.getTicket(activeStoreTicket.ticket.id);
                    setActiveStoreTicket(detail);
                    await ticketsQuery.refetch();
                    onToast(ag.atkEscalatedToast);
                  }}
                  className="px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                  style={{
                    borderColor: 'var(--warning)',
                    backgroundColor: 'var(--warning-soft)',
                    color: 'var(--warning)',
                  }}
                >
                  {ag.atkEscalateBtn}
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveStoreTicket(null)}
                className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                {ag.atkBackBtn}
              </button>
            </div>
          </div>

          {activeStoreTicket.ticket.order_info ? (
            <TicketOrderCard
              order={activeStoreTicket.ticket.order_info}
              showDeliveredPayload
              title={ag.atkOrderCardTitle}
            />
          ) : activeStoreTicket.ticket.order_no ? (
            <div
              className="p-3 rounded-xl border text-xs"
              style={{
                borderColor: 'var(--warning)',
                backgroundColor: 'var(--warning-soft)',
                color: 'var(--warning)',
              }}
            >
              {ag.atkOrderMissingPrefix}{' '}
              <span className="font-mono-num font-semibold">{activeStoreTicket.ticket.order_no}</span>{' '}
              {ag.atkOrderMissingSuffix}
            </div>
          ) : null}

          <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
            {activeStoreTicket.messages.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-xl border text-xs space-y-1"
                style={{
                  borderColor:
                    m.sender_role === 'agent' || m.sender_role === 'admin'
                      ? 'var(--accent)'
                      : 'var(--border-color)',
                  backgroundColor:
                    m.sender_role === 'agent' || m.sender_role === 'admin'
                      ? 'var(--accent-soft)'
                      : 'var(--bg-canvas)',
                }}
              >
                <div
                  className="flex items-center justify-between text-[11px]"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <strong style={{ color: 'var(--ink-primary)' }}>{m.sender_name}</strong>
                  <span className="font-mono-num">{m.created_at}</span>
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))}
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!storeReplyText.trim()) return;
              await agentApi.replyTicket(activeStoreTicket.ticket.id, storeReplyText);
              setStoreReplyText('');
              const detail = await agentApi.getTicket(activeStoreTicket.ticket.id);
              setActiveStoreTicket(detail);
              const latestId = detail.messages.at(-1)?.id ?? detail.ticket.last_message_id ?? 0;
              onMarkTicketSeen?.(detail.ticket.id, latestId);
              await ticketsQuery.refetch();
              onToast(ag.atkRepliedToast);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={storeReplyText}
              onChange={(e) => setStoreReplyText(e.target.value)}
              placeholder={ag.atkReplyPlaceholder}
              className="acct-input flex-1 text-xs"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Send className="w-3.5 h-3.5" />
              {ag.atkReplyBtn}
            </button>
          </form>
        </div>
      ) : ticketsQuery.isLoading ? (
        <div className="py-10 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : storeTickets.length === 0 ? (
        <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
          {ag.atkEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {storeTickets.map((tk) => {
            const hasNew = isAgentTicketUnread(tk, seenMap);
            return (
              <button
                key={tk.id}
                type="button"
                onClick={async () => {
                  const detail = await agentApi.getTicket(tk.id);
                  setActiveStoreTicket(detail);
                  const latestId = detail.messages.at(-1)?.id ?? tk.last_message_id ?? tk.message_count ?? 1;
                  onMarkTicketSeen?.(tk.id, latestId);
                }}
                className="w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer transition-colors"
                style={{
                  borderColor: hasNew
                    ? 'color-mix(in srgb, var(--danger) 45%, var(--border-color))'
                    : 'var(--border-color)',
                  backgroundColor: 'var(--bg-canvas)',
                }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    {hasNew && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {ag.atkNewMsgBadge}
                      </span>
                    )}
                    <span className="font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {tk.ticket_no}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor:
                          tk.status === 'escalated' ? 'var(--warning-soft)' : 'var(--accent-soft)',
                        color: tk.status === 'escalated' ? 'var(--warning)' : 'var(--accent)',
                      }}
                    >
                      {tk.status === 'escalated'
                        ? ag.atkStatusEscalated
                        : tk.status === 'resolved'
                          ? ag.atkStatusResolved
                          : tk.status === 'closed'
                            ? ag.atkStatusClosed
                            : ag.atkStatusPending}
                    </span>
                    <WarrantyStatusBadge warranty={tk.order_info?.warranty} compact />
                  </div>
                  <div className="text-xs font-semibold mt-1 truncate">{tk.subject}</div>
                  <div
                    className="text-[11px] flex items-center gap-1.5 flex-wrap mt-0.5"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <span>{tk.contact_email}</span>
                    {tk.order_info ? (
                      <>
                        <span>·</span>
                        <span className="font-mono-num font-medium" style={{ color: 'var(--ink-primary)' }}>
                          {fmt(ag.atkOrderPrefix, { orderNo: tk.order_info.order_no })}
                        </span>
                        <span className="truncate max-w-[240px]">
                          （{tk.order_info.product_title} · ¥{Number(tk.order_info.total_amount).toFixed(2)}）
                        </span>
                      </>
                    ) : tk.order_no ? (
                      <span className="font-mono-num">
                        · {fmt(ag.atkOrderPrefix, { orderNo: tk.order_no })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span className="text-[11px] font-mono-num shrink-0" style={{ color: 'var(--ink-muted)' }}>
                  {tk.updated_at}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
