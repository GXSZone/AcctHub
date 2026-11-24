/**
 * 代理分站独立订单检索 & 本店注册会员列表面板
 */

import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Users } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';

export function AgentStoreOrdersTab() {
  const rf = useRiskControlI18n();
  const [searchInput, setSearchInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [status, setStatus] = useState('all');

  const ordersQuery = useQuery({
    queryKey: ['agent', 'store-orders', appliedQ, status],
    queryFn: () => tenantAgentApi.listStoreOrders({ q: appliedQ || undefined, status }),
  });

  const items = ordersQuery.data?.items ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedQ(searchInput.trim());
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4 text-xs">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={rf.ordSearchPlaceholder}
          className="acct-input flex-1 min-w-[200px]"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="acct-input w-auto">
          <option value="all">{rf.ordFilterAllStatus}</option>
          <option value="delivered">{rf.ordFilterDelivered}</option>
          <option value="pending_payment">{rf.ordFilterPendingPay}</option>
          <option value="risk_review">{rf.ordFilterRiskReview}</option>
          <option value="refunded">{rf.ordFilterRefunded}</option>
        </select>
        <button
          type="submit"
          className="px-4 py-2 rounded-xl font-semibold cursor-pointer inline-flex items-center gap-1"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Search className="w-3.5 h-3.5" />
          {rf.ordSearchBtn}
        </button>
      </form>

      {ordersQuery.isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
          {rf.agentOrdersEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Product</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Amount</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr
                  key={o.order_no}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2.5 pr-4 font-mono-num">{o.public_order_no || o.order_no}</td>
                  <td className="py-2.5 pr-4">
                    <div className="font-medium flex items-center gap-1.5 flex-wrap">
                      <span>{o.product_title}</span>
                      {o.is_private_product && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {rf.agentPrivateBadge}
                        </span>
                      )}
                      {o.settlement_mode === 'tenant_direct_collect' && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                        >
                          {rf.agentDirectCollectBadge}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {o.spec_name} × {o.quantity}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 font-mono-num">{o.contact_email}</td>
                  <td className="py-2.5 pr-4 font-mono-num font-semibold">
                    ¥{Number(o.total_amount).toFixed(2)}
                    {o.payment_fee_amount > 0 && (
                      <span className="ml-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                        (+¥{o.payment_fee_amount.toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono-num">{o.status}</td>
                  <td className="py-2.5 text-right font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {o.created_at}
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

export function AgentStoreMembersTab() {
  const rf = useRiskControlI18n();
  const [searchInput, setSearchInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');

  const membersQuery = useQuery({
    queryKey: ['agent', 'store-members', appliedQ],
    queryFn: () => tenantAgentApi.listStoreMembers({ q: appliedQ || undefined }),
  });

  const items = membersQuery.data?.items ?? [];

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4 text-xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAppliedQ(searchInput.trim());
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Email / Display Name..."
          className="acct-input flex-1 min-w-[200px]"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-xl font-semibold cursor-pointer inline-flex items-center gap-1"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Search className="w-3.5 h-3.5" />
          {rf.ordSearchBtn}
        </button>
      </form>

      {membersQuery.isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center space-y-2" style={{ color: 'var(--ink-muted)' }}>
          <Users className="w-6 h-6 mx-auto opacity-50" />
          <p>{rf.agentMembersEmpty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-4">ID / Member</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">{rf.agentMemberColOrders}</th>
                <th className="py-2 text-right">Joined</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr
                  key={m.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2.5 pr-4 font-semibold">
                    #{m.id} · {m.display_name}
                  </td>
                  <td className="py-2.5 pr-4 font-mono-num">{m.email}</td>
                  <td className="py-2.5 pr-4 font-mono-num">
                    {m.order_count} / ¥{m.total_spent.toFixed(2)}
                  </td>
                  <td className="py-2.5 text-right font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {m.created_at}
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
