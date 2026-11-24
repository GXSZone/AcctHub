/**
 * 全站售后工单总控中心（含上游一键换新补采）
 */

import { Headphones, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { upstreamApi } from '../../api/upstream.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { TicketOrderCard, WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { fmt } from '../../i18n';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';
import type { SupportTicketRecord, TicketMessageRecord } from '../../types';

export function AdminTicketsPanel({
  tickets,
  onReload,
  showToast,
}: {
  tickets: SupportTicketRecord[];
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}) {
  const ao = useAdminOpsI18n();
  const [active, setActive] = useState<{
    ticket: SupportTicketRecord;
    messages: TicketMessageRecord[];
    replacementMailStatus: string | null;
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const selectedTicket = useRef<number | null>(null);
  const detailRequest = useRef(0);
  const activeId = active?.ticket.id;
  const reply = activeId === undefined ? '' : (drafts[activeId] ?? '');
  const [sending, setSending] = useState(false);
  const [replacingUpstream, setReplacingUpstream] = useState(false);

  const openDetail = async (id: number, select = false) => {
    if (select) selectedTicket.current = id;
    if (selectedTicket.current !== id) return;
    const requestId = ++detailRequest.current;
    const res = await adminApi.getTicket(id);
    if (requestId === detailRequest.current && selectedTicket.current === res.ticket.id) setActive(res);
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div
        className="flex items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ao.tkTitle}</h2>
        </div>
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {ao.tkSubtitle}
        </span>
      </div>

      {active ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                {fmt(ao.tkMetaLine, {
                  ticketNo: active.ticket.ticket_no,
                  email: active.ticket.contact_email,
                  orderPart: active.ticket.order_no
                    ? fmt(ao.tkMetaOrderPart, { orderNo: active.ticket.order_no })
                    : '',
                })}
              </div>
              <div className="font-semibold text-sm mt-0.5">{active.ticket.subject}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await adminApi.updateTicketStatus(active.ticket.id, 'resolved');
                  await openDetail(active.ticket.id);
                  await onReload();
                  showToast(ao.tkResolvedToast);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
              >
                {ao.tkMarkResolvedBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  selectedTicket.current = null;
                  detailRequest.current += 1;
                  setActive(null);
                }}
                className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                {ao.tkBackBtn}
              </button>
            </div>
          </div>

          {active.ticket.order_info ? (
            <TicketOrderCard
              order={active.ticket.order_info}
              showDeliveredPayload
              title={ao.tkOrderCardTitle}
              replacingUpstream={replacingUpstream}
              onReplaceViaUpstream={async () => {
                const ok = await openConfirm({
                  title: ao.tkReplaceConfirmTitle,
                  description: ao.tkReplaceConfirmDesc,
                  detail: fmt(ao.tkReplaceConfirmDetail, {
                    orderNo: active.ticket.order_info?.order_no || '',
                  }),
                  confirmLabel: ao.tkReplaceConfirmBtn,
                  tone: 'accent',
                });
                if (!ok) return;
                setReplacingUpstream(true);
                try {
                  const res = await upstreamApi.replaceTicketViaUpstream(active.ticket.id, { quantity: 1 });
                  if (res.status !== 'delivered' && !['pending', 'timeout_unknown'].includes(res.status)) {
                    throw new Error(res.errorMessage || ao.tkReplaceFailErr);
                  }
                  showToast(
                    res.status !== 'delivered'
                      ? ao.tkReplacePendingToast
                      : [
                          fmt(ao.tkReplaceOkToast, {
                            upstreamOrderNo: res.upstreamOrderNo,
                            cost: res.cost,
                          }),
                          res.mailStatus === 'sent' ? ao.tkReplaceMailSent : ao.tkReplaceMailUnconfirmed,
                        ].join(' ')
                  );
                  await openDetail(active.ticket.id);
                  await onReload();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : ao.tkReplaceFailErr);
                } finally {
                  setReplacingUpstream(false);
                }
              }}
            />
          ) : active.ticket.order_no ? (
            <div
              className="p-3 rounded-xl border text-xs"
              style={{
                borderColor: 'var(--warning)',
                backgroundColor: 'var(--warning-soft)',
                color: 'var(--warning)',
              }}
            >
              {ao.tkOrderMissingPrefix}
              <span className="font-mono-num font-semibold">{active.ticket.order_no}</span>
              {ao.tkOrderMissingSuffix}
            </div>
          ) : null}

          {active.replacementMailStatus && active.replacementMailStatus !== 'sent' && (
            <button
              type="button"
              className="text-xs underline"
              onClick={async () => {
                try {
                  const result = await upstreamApi.retryReplacementEmail(active.ticket.id);
                  showToast(
                    result.mailStatus === 'sent' ? ao.tkReplaceMailSent : ao.tkReplaceMailUnconfirmed
                  );
                  await openDetail(active.ticket.id);
                } catch (err) {
                  showToast(err instanceof Error ? err.message : ao.tkReplaceMailUnconfirmed);
                }
              }}
            >
              {ao.tkReplaceMailRetry}
            </button>
          )}

          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {active.messages.map((m) => (
              <div
                key={m.id}
                className="p-3 rounded-xl border text-xs space-y-1"
                style={{
                  borderColor: m.sender_role === 'admin' ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: m.sender_role === 'admin' ? 'var(--accent-soft)' : 'var(--bg-canvas)',
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
              const ticketId = active.ticket.id;
              if (ticketId !== selectedTicket.current || !reply.trim()) return;
              setSending(true);
              try {
                await adminApi.replyTicket(ticketId, reply, 'admin_replied');
                setDrafts((previous) =>
                  previous[ticketId] === reply ? { ...previous, [ticketId]: '' } : previous
                );
                await openDetail(ticketId);
                await onReload();
                showToast(ao.tkRepliedToast);
              } finally {
                setSending(false);
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={reply}
              onChange={(e) => {
                const value = e.target.value;
                setDrafts((previous) => ({ ...previous, [active.ticket.id]: value }));
              }}
              placeholder={ao.tkReplyPh}
              className="acct-input flex-1 text-xs"
            />
            <button
              type="submit"
              disabled={sending}
              className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Send className="w-3.5 h-3.5" />
              {ao.tkSendReplyBtn}
            </button>
          </form>
        </div>
      ) : tickets.length === 0 ? (
        <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
          {ao.tkEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {tickets.map((tk) => (
            <button
              key={tk.id}
              type="button"
              onClick={() => void openDetail(tk.id, true)}
              className="w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className="font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {tk.ticket_no}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor:
                        tk.status === 'escalated'
                          ? 'var(--warning-soft)'
                          : tk.status === 'resolved' || tk.status === 'closed'
                            ? 'var(--success-soft)'
                            : 'var(--accent-soft)',
                      color:
                        tk.status === 'escalated'
                          ? 'var(--warning)'
                          : tk.status === 'resolved' || tk.status === 'closed'
                            ? 'var(--success)'
                            : 'var(--accent)',
                    }}
                  >
                    {tk.status === 'escalated'
                      ? ao.tkStatusEscalated
                      : tk.status === 'open'
                        ? ao.tkStatusOpen
                        : tk.status === 'resolved'
                          ? ao.tkStatusResolved
                          : tk.status === 'closed'
                            ? ao.tkStatusClosed
                            : ao.tkStatusReplied}
                  </span>
                  {tk.site_slug ? (
                    <span className="font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {fmt(ao.tkSiteTenantTag, { slug: tk.site_slug })}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--ink-muted)' }}>{ao.tkDirectCustomer}</span>
                  )}
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
                        {fmt(ao.tkOrderNoLabel, { orderNo: tk.order_info.order_no })}
                      </span>
                      <span className="truncate max-w-[260px]">
                        （{tk.order_info.product_title} · ¥{Number(tk.order_info.total_amount).toFixed(2)}）
                      </span>
                    </>
                  ) : tk.order_no ? (
                    <span className="font-mono-num">{fmt(ao.tkOrderNoInline, { orderNo: tk.order_no })}</span>
                  ) : null}
                </div>
              </div>
              <span className="text-[11px] font-mono-num shrink-0" style={{ color: 'var(--ink-muted)' }}>
                {tk.updated_at}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
