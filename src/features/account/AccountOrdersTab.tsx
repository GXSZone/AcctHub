/**
 * 会员中心购买记录与卡密凭证 Tab（紧凑摘要行 + 点击展开/折叠卡密凭证）
 */

import { ChevronDown, ChevronUp, Headphones, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CredentialCard } from '../../components/CredentialCard';
import { WarrantyStatusBadge } from '../../components/TicketOrderCard';
import { fmt } from '../../i18n';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';
import { useAccountOrdersQuery } from '../../queries/account.queries';
import type { UserProfile } from '../../types';

interface AccountOrdersTabProps {
  user: UserProfile;
  onStartOrderTicket: (orderNo: string, productTitle: string) => void;
}

export function AccountOrdersTab({ user, onStartOrderTicket }: AccountOrdersTabProps) {
  const acc = useAccountI18n();
  const cm = useCommerceI18n();
  const ordersQuery = useAccountOrdersQuery(true);
  const orders = ordersQuery.data?.pages.flatMap((page) => page.orders) ?? [];
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const toggleExpand = (orderNo: string) => {
    setExpandedMap((prev) => ({ ...prev, [orderNo]: !prev[orderNo] }));
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.ordersTabTitle}</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {acc.ordersTabDesc}
        </p>
      </div>

      {ordersQuery.isLoading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : ordersQuery.error ? (
        <p role="alert">{ordersQuery.error.message}</p>
      ) : orders.length === 0 ? (
        <div
          className="paper-card rounded-2xl p-12 text-center text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          {acc.ordersNone}
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((order) => {
            const expanded = Boolean(expandedMap[order.order_no]);
            return (
              <article key={order.order_no} className="paper-card rounded-2xl overflow-hidden">
                <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(order.order_no)}
                    aria-expanded={expanded}
                    className="flex-1 min-w-[220px] text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="font-mono-num text-[11px] font-semibold px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--bg-subtle)' }}
                      >
                        {order.order_no}
                      </span>
                      <span
                        className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor:
                            order.status === 'refunded'
                              ? 'var(--danger-soft)'
                              : order.status === 'grouping'
                                ? 'var(--accent-soft)'
                                : 'var(--success-soft)',
                          color:
                            order.status === 'refunded'
                              ? 'var(--danger)'
                              : order.status === 'grouping'
                                ? 'var(--accent)'
                                : 'var(--success)',
                        }}
                      >
                        {order.status === 'refunded'
                          ? acc.statusRefunded
                          : order.status === 'grouping'
                            ? cm.statusGrouping
                            : order.status === 'delivered'
                              ? acc.statusDelivered
                              : acc.statusProcessing}
                      </span>
                      <WarrantyStatusBadge warranty={order.warranty} compact />
                      {order.status === 'delivered' &&
                        order.warranty &&
                        (order.warranty.status === 'expired' ||
                          (order.warranty.remaining_days !== null &&
                            order.warranty.remaining_days > 0 &&
                            order.warranty.remaining_days <= 7)) && (
                          <span
                            className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}
                          >
                            {order.warranty.status === 'expired'
                              ? cm.renewalExpiredBadge
                              : fmt(cm.renewalExpiringBadge, { days: order.warranty.remaining_days ?? 0 })}
                          </span>
                        )}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-1">
                      <h2 className="font-editorial text-base font-semibold group-hover:text-[var(--accent)] transition-colors">
                        {order.product_title}
                      </h2>
                      <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(acc.ordersSpecMeta, {
                          spec: order.spec_name,
                          qty: order.quantity,
                          time: order.created_at,
                        })}
                      </span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono-num text-base font-semibold mr-1">
                      ¥{Number(order.total_amount).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpand(order.order_no)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer"
                      style={{
                        borderColor: expanded ? 'var(--accent)' : 'var(--border-strong)',
                        backgroundColor: expanded ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                        color: expanded ? 'var(--accent)' : 'var(--ink-secondary)',
                      }}
                    >
                      {expanded ? acc.ordersCollapseBtn : acc.ordersExpandBtn}
                      {expanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {order.status === 'delivered' && order.product_id && (
                      <Link
                        to={`/item/${order.product_id}?spec=${encodeURIComponent(order.spec_id || 'default')}&rebuy=1`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold no-underline"
                        style={{
                          borderColor: 'var(--success)',
                          backgroundColor: 'var(--success-soft)',
                          color: 'var(--success)',
                        }}
                      >
                        <RefreshCw className="w-3 h-3" />
                        {cm.rebuyBtn}
                      </Link>
                    )}
                    {order.status !== 'refunded' && (
                      <button
                        type="button"
                        onClick={() => onStartOrderTicket(order.order_no, order.product_title)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer"
                        style={{
                          borderColor: 'var(--accent)',
                          backgroundColor: 'var(--accent-soft)',
                          color: 'var(--accent)',
                        }}
                      >
                        <Headphones className="w-3.5 h-3.5" />
                        {acc.applyAfterSaleBtn}
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div
                    className="px-4 pb-4 pt-3 border-t space-y-3"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    {order.warranty?.warranty_summary && (
                      <div className="text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
                        {fmt(acc.ordersWarrantyNote, { summary: order.warranty.warranty_summary })}
                      </div>
                    )}
                    <CredentialCard
                      payload={order.delivered_payload}
                      productTitle={order.product_title}
                      locked={order.locked}
                      user={user}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {ordersQuery.hasNextPage && (
        <button
          type="button"
          className="rounded-lg border px-4 py-2 text-sm cursor-pointer"
          disabled={ordersQuery.isFetchingNextPage}
          onClick={() => void ordersQuery.fetchNextPage()}
        >
          {ordersQuery.isFetchingNextPage ? acc.ordersLoadingMore : acc.ordersLoadMore}
        </button>
      )}
    </div>
  );
}
