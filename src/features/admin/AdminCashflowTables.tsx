/**
 * 总控全店非商品资金流水子表（代理开户与升级流水 + 会员在线充值与 CDK 兑换流水）
 */

import { Loader2 } from 'lucide-react';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useAdminCashflowsQuery } from '../../queries/admin.queries';

export function AdminCashflowTables({ mode }: { mode: 'upgrades' | 'recharges' }) {
  const ac = useAdminCoreI18n();
  const query = useAdminCashflowsQuery(true);

  if (query.isLoading) {
    return (
      <div className="py-12 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (mode === 'upgrades') {
    const list = query.data?.agent_upgrades ?? [];
    if (list.length === 0) {
      return (
        <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
          {ac.ordUpgEmpty}
        </p>
      );
    }
    return (
      <table className="w-full text-xs text-left">
        <thead>
          <tr
            className="border-b whitespace-nowrap"
            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
          >
            <th className="py-2 pr-4">{ac.ordUpgColMember}</th>
            <th className="py-2 pr-4">{ac.ordUpgColTier}</th>
            <th className="py-2 pr-4">{ac.ordUpgColPay}</th>
            <th className="py-2 pr-4">{ac.ordUpgColAmount}</th>
            <th className="py-2 pr-4">{ac.ordUpgColSplit}</th>
            <th className="py-2 text-right">{ac.ordUpgColTime}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <tr
              key={u.id}
              className="border-b last:border-b-0"
              style={{ borderColor: 'var(--border-color)' }}
            >
              <td className="py-2.5 pr-4">
                <div className="font-medium">
                  {u.agent_brand || u.user_name}
                  {u.agent_slug && (
                    <span className="ml-1.5 font-mono-num text-[11px]" style={{ color: 'var(--accent)' }}>
                      @{u.agent_slug}
                    </span>
                  )}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {u.user_email} · {u.parent_slug ? `@${u.parent_slug}` : ac.ordUpgDirectTag}
                </div>
              </td>
              <td className="py-2.5 pr-4 font-medium">{u.unlocked_tier_name}</td>
              <td className="py-2.5 pr-4 font-mono-num text-[11px]">{u.payment_method}</td>
              <td className="py-2.5 pr-4 font-mono-num font-semibold">¥{u.amount.toFixed(2)}</td>
              <td className="py-2.5 pr-4 font-mono-num text-[11px]">
                <span style={{ color: 'var(--ink-muted)' }}>¥{u.parent_share.toFixed(2)}</span>
                {' / '}
                <span className="font-semibold" style={{ color: 'var(--success)' }}>
                  ¥{u.platform_net.toFixed(2)}
                </span>
              </td>
              <td
                className="py-2.5 text-right font-mono-num text-[11px] whitespace-nowrap"
                style={{ color: 'var(--ink-muted)' }}
              >
                {u.created_at}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const list = query.data?.wallet_recharges ?? [];
  if (list.length === 0) {
    return (
      <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
        {ac.ordRchEmpty}
      </p>
    );
  }
  return (
    <table className="w-full text-xs text-left">
      <thead>
        <tr
          className="border-b whitespace-nowrap"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
        >
          <th className="py-2 pr-4">{ac.ordRchColRef}</th>
          <th className="py-2 pr-4">{ac.ordRchColMember}</th>
          <th className="py-2 pr-4">{ac.ordRchColSource}</th>
          <th className="py-2 pr-4">{ac.ordRchColAmount}</th>
          <th className="py-2 pr-4">{ac.ordRchColStatus}</th>
          <th className="py-2 text-right">{ac.ordRchColTime}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id} className="border-b last:border-b-0" style={{ borderColor: 'var(--border-color)' }}>
            <td className="py-2.5 pr-4 font-mono-num">{r.ref_no}</td>
            <td className="py-2.5 pr-4">{r.user_email}</td>
            <td className="py-2.5 pr-4">
              <span
                className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
              >
                {r.source === 'cdk' ? ac.ordRchSourceCdk : `${ac.ordRchSourceOnline} · ${r.channel}`}
              </span>
              {r.note && (
                <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  {r.note}
                </div>
              )}
            </td>
            <td className="py-2.5 pr-4 font-mono-num font-semibold" style={{ color: 'var(--success)' }}>
              +¥{r.amount.toFixed(2)}
            </td>
            <td className="py-2.5 pr-4 font-mono-num text-[11px]">{r.status}</td>
            <td
              className="py-2.5 text-right font-mono-num text-[11px] whitespace-nowrap"
              style={{ color: 'var(--ink-muted)' }}
            >
              {r.created_at}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
