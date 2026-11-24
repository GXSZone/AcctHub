import { useInfiniteQuery } from '@tanstack/react-query';
import { Check, Copy, Headphones, Loader2, Lock, ReceiptText, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentHostScope } from '../api/http';
import { ordersApi } from '../api/orders.api';
import { CredentialCard } from '../components/CredentialCard';
import { WarrantyStatusBadge } from '../components/TicketOrderCard';
import { TurnstileWidget } from '../components/TurnstileWidget';
import { useI18n } from '../i18n';
import { useAccountI18n } from '../i18n/namespaces/account';
import { toast } from '../lib/toast';
import type { BootstrapPayload, OrderRecord, UserProfile } from '../types';

export function OrdersPage({
  user,
  bootstrap,
}: {
  user: UserProfile | null;
  bootstrap: BootstrapPayload | null;
}) {
  const { messages: t } = useI18n();
  const acc = useAccountI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [queryPass, setQueryPass] = useState('');
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<OrderRecord[]>([]);
  const [locked, setLocked] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [searching, setSearching] = useState(false);
  const [challengeToken, setChallengeToken] = useState('');
  const [resetSignal, setResetSignal] = useState(0);
  const [copiedOrder, setCopiedOrder] = useState<string | null>(null);
  const hostScope = getCurrentHostScope();
  const challengeEnabled = !user && bootstrap?.security?.turnstile_enabled;
  const history = useInfiniteQuery({
    queryKey: ['orders', 'history', hostScope, user?.id],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => ordersApi.lookupOrders({ cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(user) && !searched,
  });

  const orders = searched
    ? results
    : (history.data?.pages
        .flatMap((page) => page.orders)
        .filter((order): order is OrderRecord => 'order_no' in order) ?? []);
  const loading = searching || (!searched && history.isFetching);
  const historyError = !searched ? history.error?.message : undefined;

  useEffect(() => {
    if (historyError) {
      toast.error(historyError);
    }
  }, [historyError]);

  const submitLookup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = query.trim();
    toast.clearErrors();
    setLookupFailed(false);
    setLocked(false);
    setResults([]);
    if (!q) {
      setSearched(false);
      return;
    }
    if (searching || (challengeEnabled && !challengeToken)) return;
    setSearched(true);
    setSearching(true);
    try {
      const response = await ordersApi.lookupOrders({
        q,
        password: queryPass.trim(),
        turnstile_token: challengeToken || undefined,
      });
      setResults(response.orders.filter((order): order is OrderRecord => 'order_no' in order));
      setLocked(response.orders.some((order) => order.locked));
    } catch (error) {
      setLookupFailed(true);
      toast.error(error instanceof Error ? error.message : acc.ordersLookupFailed);
    } finally {
      setSearching(false);
      setChallengeToken('');
      setResetSignal((signal) => signal + 1);
    }
  };

  const copyText = async (orderNo: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedOrder(orderNo);
    toast.success(acc.copiedAllBtn);
    setTimeout(() => setCopiedOrder(null), 1600);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <div
          className="text-[11px] font-mono-num uppercase tracking-[0.14em]"
          style={{ color: 'var(--accent)' }}
        >
          {t.ordersEyebrow}
        </div>
        <h1 className="font-editorial text-3xl font-semibold mt-1">{t.ordersTitle}</h1>
        <p className="text-xs sm:text-sm mt-1.5" style={{ color: 'var(--ink-secondary)' }}>
          {t.ordersSubtitle}
        </p>
      </div>

      <form
        onSubmit={(event) => void submitLookup(event)}
        className="paper-card rounded-2xl p-4 space-y-3 mb-6"
      >
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.ordersSearchPlaceholder}
              className="acct-input pl-10"
            />
          </div>
          <div className="relative sm:w-44">
            <Lock
              className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              type="password"
              value={queryPass}
              onChange={(e) => setQueryPass(e.target.value)}
              placeholder={acc.ordersPassPlaceholder}
              className="acct-input pl-9 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={loading || Boolean(challengeEnabled && query.trim() && !challengeToken)}
            className="px-6 py-2.5 rounded-xl text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 shrink-0"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />}
            {acc.ordersSearchBtn}
          </button>
        </div>
        {challengeEnabled && (
          <TurnstileWidget
            enabled
            siteKey={bootstrap?.security?.turnstile_site_key}
            action="order_lookup"
            resetSignal={resetSignal}
            onToken={setChallengeToken}
          />
        )}
      </form>

      {lookupFailed || (!searched && Boolean(historyError)) ? null : locked ? (
        <div role="status" className="paper-card rounded-2xl p-5">
          {acc.ordersLookupLocked}
        </div>
      ) : loading && orders.length === 0 ? null : orders.length === 0 ? (
        <div className="paper-card rounded-2xl p-12 text-center">
          <p className="font-editorial text-xl font-medium">{acc.ordersEmptyTitle}</p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>
            {acc.ordersEmptyDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <article key={order.order_no} className="paper-card rounded-2xl p-5 sm:p-6">
              <div
                className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-mono-num text-xs font-semibold px-2 py-0.5 rounded-md"
                      style={{ backgroundColor: 'var(--bg-subtle)' }}
                    >
                      {order.public_order_no || order.order_no}
                    </span>
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor:
                          order.status === 'refunded' ? 'var(--danger-soft)' : 'var(--success-soft)',
                        color: order.status === 'refunded' ? 'var(--danger)' : 'var(--success)',
                      }}
                    >
                      {orderStatusLabel(order, acc)}
                    </span>
                    {order.channel === 'reseller_api' && (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {acc.channelResellerApi}
                      </span>
                    )}
                    <WarrantyStatusBadge warranty={order.warranty} compact />
                  </div>
                  <h2 className="font-editorial text-lg font-semibold mt-2">{order.product_title}</h2>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {acc.specPrefix}：{order.spec_name} × {order.quantity} · {acc.emailPrefix}：
                    {order.contact_email} · {order.created_at}
                  </div>
                </div>

                <div className="text-right">
                  <div className="font-mono-num text-xl font-semibold">
                    ¥{Number(order.total_amount).toFixed(2)}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {order.payment_method === 'balance' ? acc.payMethodBalance : acc.payMethodOnline}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                    {acc.credentialHeader}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {user && order.status === 'delivered' && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/account/tickets?order_no=${encodeURIComponent(order.order_no)}&category=after_sale`
                          )
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium cursor-pointer"
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
                    {order.status === 'delivered' && Boolean(order.delivered_payload) && (
                      <button
                        type="button"
                        onClick={() => void copyText(order.order_no, order.delivered_payload)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer"
                        style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-primary)' }}
                      >
                        {copiedOrder === order.order_no ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedOrder === order.order_no ? acc.copiedAllBtn : acc.copyAllBtn}
                      </button>
                    )}
                  </div>
                </div>
                {order.status === 'delivered' && Boolean(order.delivered_payload) && (
                  <CredentialCard
                    payload={order.delivered_payload}
                    productTitle={order.product_title}
                    locked={order.locked}
                    user={user}
                  />
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {!searched && history.hasNextPage && (
        <button
          type="button"
          className="mt-5 rounded-lg border px-4 py-2 text-sm"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage ? acc.ordersLoadingMore : acc.ordersLoadMore}
        </button>
      )}
    </div>
  );
}

function orderStatusLabel(order: OrderRecord, acc: ReturnType<typeof useAccountI18n>) {
  switch (order.status) {
    case 'pending_payment':
      return acc.statusPendingPayment;
    case 'paid':
    case 'upstream_pending':
      return acc.statusAwaitingDelivery;
    case 'closed':
    case 'expired':
      return acc.statusOrderClosed;
    case 'failed':
    case 'fulfill_failed':
    case 'fulfillment_failed':
      return acc.statusDeliveryFailed;
    case 'refunded':
      return acc.statusRefunded;
    case 'delivered':
      return acc.statusDelivered;
    default:
      return acc.statusProcessing;
  }
}
