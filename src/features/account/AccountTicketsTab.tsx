/**
 * 会员中心售后与质保工单 Tab（含新建工单、实时订单保质核验、对话详情与结单）
 */

import { Loader2, Plus, Send } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { accountApi } from '../../api/account.api';
import { TicketOrderCard, WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import {
  useAccountOrdersQuery,
  useAccountTicketDetailQuery,
  useAccountTicketsQuery,
} from '../../queries/account.queries';

import { AccountTicketDetail } from './AccountTicketDetail';

interface AccountTicketsTabProps {
  presetTicket?: { orderNo: string; category: string; subject: string } | null;
  onClearPreset: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AccountTicketsTab({ presetTicket, onClearPreset, onToast, onError }: AccountTicketsTabProps) {
  const acc = useAccountI18n();
  const ticketStatusMeta = useMemo<Record<string, { label: string; bg: string; color: string }>>(
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
  const autoSubjectRef = useRef('');
  const ticketsQuery = useAccountTicketsQuery(true);
  const ordersQuery = useAccountOrdersQuery(true);
  const tickets = ticketsQuery.data?.tickets ?? [];
  const orders = ordersQuery.data?.pages.flatMap((page) => page.orders) ?? [];

  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [tkOrderNo, setTkOrderNo] = useState('');
  const [manualOrderMode, setManualOrderMode] = useState(false);
  const [tkCategory, setTkCategory] = useState('after_sale');
  const [tkSubject, setTkSubject] = useState('');
  const [tkContent, setTkContent] = useState('');
  const [tkSubmitting, setTkSubmitting] = useState(false);

  const [activeTicketId, setActiveTicketId] = useState<number | null>(null);
  const activeTicketQuery = useAccountTicketDetailQuery(activeTicketId);
  const activeTicket = activeTicketQuery.data ?? null;

  useEffect(() => {
    if (!presetTicket) return;
    setTkCategory(presetTicket.category || 'after_sale');
    setTkOrderNo(presetTicket.orderNo);
    setManualOrderMode(false);
    autoSubjectRef.current = presetTicket.subject;
    setTkSubject(presetTicket.subject);
    setNewTicketOpen(true);
    setActiveTicketId(null);
    onClearPreset();
  }, [presetTicket, onClearPreset]);

  const selectedOrderRecord = useMemo(
    () => orders.find((o) => o.order_no === tkOrderNo.trim()) || null,
    [orders, tkOrderNo]
  );

  const selectedOrderSnapshot = useMemo(() => {
    if (!selectedOrderRecord?.warranty) return null;
    return {
      order_no: selectedOrderRecord.order_no,
      product_id: selectedOrderRecord.product_id || 0,
      product_title: selectedOrderRecord.product_title,
      spec_name: selectedOrderRecord.spec_name,
      quantity: selectedOrderRecord.quantity,
      unit_price: selectedOrderRecord.unit_price,
      total_amount: selectedOrderRecord.total_amount,
      status: selectedOrderRecord.status,
      payment_method: selectedOrderRecord.payment_method || '',
      channel: selectedOrderRecord.channel || 'web',
      tenant_slug: selectedOrderRecord.tenant_slug || null,
      contact_email: selectedOrderRecord.contact_email,
      created_at: selectedOrderRecord.created_at,
      delivered_payload: selectedOrderRecord.delivered_payload,
      warranty: selectedOrderRecord.warranty,
    };
  }, [selectedOrderRecord]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.tkTitle}</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {acc.tkDesc}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNewTicketOpen((v) => !v);
            setActiveTicketId(null);
          }}
          className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {newTicketOpen ? acc.tkBackListBtn : acc.tkNewBtn}
        </button>
      </div>

      {newTicketOpen && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (tkCategory === 'after_sale' && !tkOrderNo.trim()) {
              onError(acc.tkNeedOrderErr);
              return;
            }
            setTkSubmitting(true);
            onError('');
            try {
              const res = await accountApi.createTicket({
                order_no: tkOrderNo.trim(),
                category: tkCategory,
                subject: tkSubject,
                content: tkContent,
              });
              setTkOrderNo('');
              setTkSubject('');
              setTkContent('');
              autoSubjectRef.current = '';
              setManualOrderMode(false);
              setNewTicketOpen(false);
              await ticketsQuery.refetch();
              onToast(fmt(acc.tkSubmittedToast, { ticketNo: res.ticket_no }));
            } catch (err) {
              onError(err instanceof Error ? err.message : acc.tkSubmitFailErr);
            } finally {
              setTkSubmitting(false);
            }
          }}
          className="paper-card rounded-2xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <div className="block text-xs font-semibold mb-1">{acc.tkCatLabel}</div>
              <select
                value={tkCategory}
                onChange={(e) => {
                  setTkCategory(e.target.value);
                  onError('');
                }}
                className="acct-input text-xs"
              >
                <option value="after_sale">{acc.tkCatAfterSale}</option>
                <option value="login_help">{acc.tkCatLoginHelp}</option>
                <option value="billing">{acc.tkCatBilling}</option>
                <option value="other">{acc.tkCatOther}</option>
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-semibold">
                  {acc.tkOrderNoLabel}
                  {tkCategory === 'after_sale' ? (
                    <span style={{ color: 'var(--danger)' }}>{acc.tkOrderRequiredHint}</span>
                  ) : (
                    <span className="font-normal" style={{ color: 'var(--ink-muted)' }}>
                      {acc.tkOrderOptionalHint}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setManualOrderMode((m) => !m)}
                  className="text-[11px] underline cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  {manualOrderMode ? acc.tkSwitchSelectBtn : acc.tkManualInputBtn}
                </button>
              </div>

              {!manualOrderMode ? (
                <select
                  required={tkCategory === 'after_sale'}
                  value={orders.some((o) => o.order_no === tkOrderNo) ? tkOrderNo : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTkOrderNo(val);
                    onError('');
                    const matched = orders.find((o) => o.order_no === val);
                    if (matched && (!tkSubject.trim() || tkSubject === autoSubjectRef.current)) {
                      const nextSubj = fmt(acc.afterSaleSubject, {
                        orderNo: matched.order_no,
                        productTitle: matched.product_title.slice(0, 22),
                      });
                      autoSubjectRef.current = nextSubj;
                      setTkSubject(nextSubj);
                    }
                  }}
                  className="acct-input text-xs font-mono-num"
                >
                  <option value="">
                    {ordersQuery.isLoading
                      ? acc.tkLoadingOrdersOpt
                      : orders.length === 0
                        ? acc.tkNoOrdersOpt
                        : tkCategory === 'after_sale'
                          ? fmt(acc.tkSelectOrderReqOpt, { count: orders.length })
                          : fmt(acc.tkSelectOrderOptOpt, { count: orders.length })}
                  </option>
                  {orders.map((o) => (
                    <option key={o.order_no} value={o.order_no}>
                      {o.order_no} · {o.product_title.slice(0, 18)} · ¥{Number(o.total_amount).toFixed(2)}
                      {o.warranty ? ` [${o.warranty.badge_label}]` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  required={tkCategory === 'after_sale'}
                  value={tkOrderNo}
                  onChange={(e) => {
                    setTkOrderNo(e.target.value);
                    onError('');
                  }}
                  placeholder={
                    tkCategory === 'after_sale'
                      ? acc.tkOrderInputReqPlaceholder
                      : acc.tkOrderInputOptPlaceholder
                  }
                  className="acct-input text-xs font-mono-num"
                />
              )}
            </div>
          </div>

          {selectedOrderSnapshot && (
            <TicketOrderCard order={selectedOrderSnapshot} title={acc.tkSelectedOrderCardTitle} />
          )}

          <div>
            <div className="block text-xs font-semibold mb-1">{acc.tkSubjectLabel}</div>
            <input
              type="text"
              required
              value={tkSubject}
              onChange={(e) => setTkSubject(e.target.value)}
              placeholder={acc.tkSubjectPlaceholder}
              className="acct-input text-xs"
            />
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.tkContentLabel}</div>
            <textarea
              rows={4}
              required
              value={tkContent}
              onChange={(e) => setTkContent(e.target.value)}
              placeholder={acc.tkContentPlaceholder}
              className="acct-input text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={tkSubmitting || (tkCategory === 'after_sale' && !tkOrderNo.trim())}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {tkSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {acc.tkSubmitBtn}
          </button>
        </form>
      )}

      {activeTicket ? (
        <AccountTicketDetail
          ticket={activeTicket.ticket}
          messages={activeTicket.messages}
          onBack={() => setActiveTicketId(null)}
          onRefresh={async () => {
            await activeTicketQuery.refetch();
            await ticketsQuery.refetch();
          }}
          onToast={onToast}
        />
      ) : (
        <div className="paper-card rounded-2xl p-5">
          {ticketsQuery.isLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : tickets.length === 0 ? (
            <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
              {acc.tkEmpty}
            </p>
          ) : (
            <div className="space-y-2">
              {tickets.map((tk) => {
                const st = ticketStatusMeta[tk.status] || ticketStatusMeta.open;
                return (
                  <button
                    key={tk.id}
                    type="button"
                    onClick={() => setActiveTicketId(tk.id)}
                    className="w-full p-3.5 rounded-xl border text-left flex items-center justify-between gap-3 cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {tk.ticket_no}
                        </span>
                        <span
                          className="text-[10.5px] px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: st.bg, color: st.color }}
                        >
                          {st.label}
                        </span>
                        <WarrantyStatusBadge warranty={tk.order_info?.warranty} compact />
                        {tk.order_info ? (
                          <span
                            className="font-mono-num text-[10.5px]"
                            style={{ color: 'var(--ink-secondary)' }}
                          >
                            {fmt(acc.tkItemOrderFull, {
                              orderNo: tk.order_info.order_no,
                              title: tk.order_info.product_title.slice(0, 18),
                            })}
                          </span>
                        ) : tk.order_no ? (
                          <span className="font-mono-num text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {fmt(acc.tkItemOrderShort, { orderNo: tk.order_no })}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs font-semibold mt-1 truncate">{tk.subject}</div>
                    </div>
                    <span
                      className="text-[11px] font-mono-num shrink-0"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {tk.updated_at}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
