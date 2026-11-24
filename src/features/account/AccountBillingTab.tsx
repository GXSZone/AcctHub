/**
 * 会员中心账单 Tab（双标签视图：余额收支明细 + 在线直付账单，严格不影响钱包资金守恒）
 */

import { CreditCard, Loader2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useAccountOrdersQuery, useAccountTransactionsQuery } from '../../queries/account.queries';

type BillingSubTab = 'wallet' | 'direct';

export function AccountBillingTab() {
  const acc = useAccountI18n();
  const [subTab, setSubTab] = useState<BillingSubTab>('wallet');
  const [txFilter, setTxFilter] = useState('');

  const txLabels = useMemo<Record<string, { label: string; color: string }>>(
    () => ({
      recharge: { label: acc.txRecharge, color: 'var(--success)' },
      cdk: { label: acc.txCdk, color: 'var(--success)' },
      order_pay: { label: acc.txOrderPay, color: 'var(--ink-primary)' },
      refund: { label: acc.txRefund, color: 'var(--success)' },
      commission: { label: acc.txCommission, color: 'var(--accent)' },
      withdraw: { label: acc.txWithdraw, color: 'var(--danger)' },
      withdraw_refund: { label: acc.txWithdrawRefund, color: 'var(--success)' },
    }),
    [acc]
  );

  const txQuery = useAccountTransactionsQuery(txFilter || undefined, subTab === 'wallet');
  const ordersQuery = useAccountOrdersQuery(subTab === 'direct');
  const transactions = txQuery.data?.transactions ?? [];
  const directOrders = useMemo(() => {
    const all = ordersQuery.data?.pages.flatMap((page) => page.orders) ?? [];
    return all.filter(
      (o) =>
        o.payment_method !== 'balance' &&
        Number(o.total_amount) > 0 &&
        ['paid', 'delivered', 'refunded', 'upstream_pending', 'fulfillment_failed'].includes(o.status)
    );
  }, [ordersQuery.data?.pages]);

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h1 className="font-editorial text-2xl font-semibold">{acc.billingTitle}</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {subTab === 'wallet' ? acc.billingDesc : acc.billingDirectDesc}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            className="inline-flex items-center gap-1 p-1 rounded-xl border"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'wallet'}
              onClick={() => setSubTab('wallet')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: subTab === 'wallet' ? 'var(--accent)' : 'transparent',
                color: subTab === 'wallet' ? '#FAF9F5' : 'var(--ink-secondary)',
              }}
            >
              <Wallet className="w-3.5 h-3.5" />
              {acc.billingTabWallet}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'direct'}
              onClick={() => setSubTab('direct')}
              className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: subTab === 'direct' ? 'var(--accent)' : 'transparent',
                color: subTab === 'direct' ? '#FAF9F5' : 'var(--ink-secondary)',
              }}
            >
              <CreditCard className="w-3.5 h-3.5" />
              {acc.billingTabDirect}
            </button>
          </div>

          {subTab === 'wallet' && (
            <select
              value={txFilter}
              onChange={(e) => setTxFilter(e.target.value)}
              className="acct-input h-9 w-36 py-0 text-xs"
            >
              <option value="">{acc.billingFilterAll}</option>
              <option value="recharge">{acc.txRecharge}</option>
              <option value="cdk">{acc.billingFilterCdk}</option>
              <option value="order_pay">{acc.txOrderPay}</option>
              <option value="refund">{acc.txRefund}</option>
              <option value="commission">{acc.billingFilterCommission}</option>
              <option value="withdraw">{acc.txWithdraw}</option>
            </select>
          )}
        </div>
      </div>

      {subTab === 'wallet' ? (
        txQuery.isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
            {acc.billingEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-4">{acc.billingColType}</th>
                  <th className="py-2 pr-4">{acc.billingColNote}</th>
                  <th className="py-2 pr-4 text-right">{acc.billingColAmount}</th>
                  <th className="py-2 pr-4 text-right">{acc.billingColBalance}</th>
                  <th className="py-2 text-right">{acc.billingColTime}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => {
                  const meta = txLabels[tx.type] || { label: tx.type, color: 'var(--ink-secondary)' };
                  return (
                    <tr
                      key={tx.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-2.5 pr-4 whitespace-nowrap font-medium" style={{ color: meta.color }}>
                        {meta.label}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div>{tx.note}</div>
                        {tx.ref_no && (
                          <div className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                            {tx.ref_no}
                          </div>
                        )}
                      </td>
                      <td
                        className="py-2.5 pr-4 text-right font-mono-num font-semibold whitespace-nowrap"
                        style={{ color: tx.amount >= 0 ? 'var(--success)' : 'var(--danger)' }}
                      >
                        {tx.amount >= 0
                          ? `+¥${Number(tx.amount).toFixed(2)}`
                          : `-¥${Math.abs(Number(tx.amount)).toFixed(2)}`}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono-num whitespace-nowrap">
                        ¥{Number(tx.balance_after).toFixed(2)}
                      </td>
                      <td
                        className="py-2.5 text-right font-mono-num text-[11px] whitespace-nowrap"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {tx.created_at}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : ordersQuery.isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : directOrders.length === 0 ? (
        <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
          {acc.billingDirectEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-4">{acc.billingDirectColOrder}</th>
                <th className="py-2 pr-4">{acc.billingDirectColMethod}</th>
                <th className="py-2 pr-4">{acc.billingDirectColStatus}</th>
                <th className="py-2 pr-4 text-right">{acc.billingDirectColAmount}</th>
                <th className="py-2 text-right">{acc.billingColTime}</th>
              </tr>
            </thead>
            <tbody>
              {directOrders.map((order) => (
                <tr
                  key={order.order_no}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2.5 pr-4">
                    <div className="font-medium">{order.product_title}</div>
                    <div className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {order.order_no} · {order.spec_name} × {order.quantity}
                    </div>
                  </td>
                  <td
                    className="py-2.5 pr-4 whitespace-nowrap font-mono-num"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {order.payment_method || acc.payMethodOnline}
                  </td>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span
                      className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor:
                          order.status === 'refunded' ? 'var(--danger-soft)' : 'var(--success-soft)',
                        color: order.status === 'refunded' ? 'var(--danger)' : 'var(--success)',
                      }}
                    >
                      {order.status === 'refunded'
                        ? acc.statusRefunded
                        : order.status === 'delivered'
                          ? acc.statusDelivered
                          : acc.statusProcessing}
                    </span>
                  </td>
                  <td
                    className="py-2.5 pr-4 text-right font-mono-num font-semibold whitespace-nowrap"
                    style={{ color: order.status === 'refunded' ? 'var(--ink-muted)' : 'var(--danger)' }}
                  >
                    -¥{Number(order.total_amount).toFixed(2)}
                  </td>
                  <td
                    className="py-2.5 text-right font-mono-num text-[11px] whitespace-nowrap"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {order.created_at}
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
