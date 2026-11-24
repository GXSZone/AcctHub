/**
 * 分站工作台收益提现申请（含平台提现手续费实时试算）与提现历史明细
 */

import { Banknote, Loader2, Wallet } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { type AgentMeResponse, agentApi } from '../../api/agent.api';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';

interface AgentWithdrawalSectionProps {
  balance: number;
  withdrawalFeePct: number;
  withdrawals: AgentMeResponse['withdrawals'];
  onRefresh: () => Promise<void>;
  onRefreshUser: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentWithdrawalSection({
  balance,
  withdrawalFeePct,
  withdrawals,
  onRefresh,
  onRefreshUser,
  onToast,
  onError,
}: AgentWithdrawalSectionProps) {
  const ag = useAgentI18n();
  const [wdAmount, setWdAmount] = useState<number>(50);
  const [wdChannel, setWdChannel] = useState<'alipay' | 'wechat' | 'usdt_trc20'>('alipay');
  const [wdAccount, setWdAccount] = useState('');
  const [wdName, setWdName] = useState('');
  const [wdSubmitting, setWdSubmitting] = useState(false);

  const safeAmt = Number.isFinite(wdAmount) && wdAmount > 0 ? wdAmount : 0;
  const estFee = withdrawalFeePct > 0 ? Number(((safeAmt * withdrawalFeePct) / 100).toFixed(2)) : 0;
  const estNet = Number(Math.max(0, safeAmt - estFee).toFixed(2));

  const handleSubmitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setWdSubmitting(true);
    onError('');
    try {
      await agentApi.createWithdrawal({
        amount: wdAmount,
        channel: wdChannel,
        account_info: wdAccount,
        account_name: wdName,
      });
      setWdAccount('');
      setWdName('');
      await onRefresh();
      onRefreshUser();
      onToast(fmt(ag.ovWdSuccessToast, { amount: wdAmount.toFixed(2) }));
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.ovWdFailErr);
    } finally {
      setWdSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <form onSubmit={handleSubmitWithdrawal} className="lg:col-span-5 paper-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <Banknote className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ag.ovWdFormTitle}</h2>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="block text-xs font-semibold mb-1">{ag.ovWdAmountLabel}</div>
            <input
              type="number"
              min={10}
              max={Math.max(10, balance)}
              step="0.01"
              required
              value={wdAmount}
              onChange={(e) => setWdAmount(Number(e.target.value))}
              className="acct-input font-mono-num"
            />
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{ag.ovWdChannelLabel}</div>
            <select
              value={wdChannel}
              onChange={(e) => setWdChannel(e.target.value as 'alipay' | 'wechat' | 'usdt_trc20')}
              className="acct-input"
            >
              <option value="alipay">{ag.ovChannelAlipay}</option>
              <option value="wechat">{ag.ovChannelWechat}</option>
              <option value="usdt_trc20">USDT (TRC20)</option>
            </select>
          </div>
        </div>

        {withdrawalFeePct > 0 && (
          <div
            className="px-3 py-2 rounded-xl border text-[11px] font-mono-num flex flex-wrap items-center justify-between gap-2"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <span style={{ color: 'var(--ink-secondary)' }}>
              {fmt(ag.ovWdFeeLine, { rate: withdrawalFeePct, fee: estFee.toFixed(2) })}
            </span>
            <span className="font-semibold" style={{ color: 'var(--success)' }}>
              {fmt(ag.ovWdNetLine, { net: estNet.toFixed(2) })}
            </span>
          </div>
        )}

        <div>
          <div className="block text-xs font-semibold mb-1">
            {wdChannel === 'usdt_trc20' ? ag.ovWdAccountUsdtLabel : ag.ovWdAccountNormalLabel}
          </div>
          <input
            type="text"
            required
            value={wdAccount}
            onChange={(e) => setWdAccount(e.target.value)}
            placeholder={wdChannel === 'usdt_trc20' ? 'T...' : ag.ovWdAccountNormalPlaceholder}
            className="acct-input font-mono-num"
          />
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1">{ag.ovWdRemarkLabel}</div>
          <input
            type="text"
            value={wdName}
            onChange={(e) => setWdName(e.target.value)}
            placeholder={ag.ovWdRemarkPlaceholder}
            className="acct-input"
          />
        </div>

        <button
          type="submit"
          disabled={wdSubmitting || balance < 10}
          className="w-full py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {wdSubmitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Wallet className="w-3.5 h-3.5" />
          )}
          {fmt(ag.ovWdSubmitBtn, { balance: balance.toFixed(2) })}
        </button>
      </form>

      <div className="lg:col-span-7 paper-card rounded-2xl p-6 space-y-4">
        <div
          className="flex items-center justify-between pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h2 className="font-editorial text-xl font-semibold">{ag.ovWdHistoryTitle}</h2>
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovWdHistoryHint}
          </span>
        </div>
        {withdrawals.length === 0 ? (
          <p className="text-xs py-10 text-center" style={{ color: 'var(--ink-muted)' }}>
            {ag.ovWdHistoryEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-3">{ag.ovColAmount}</th>
                  <th className="py-2 pr-3">{ag.ovColChannelAccount}</th>
                  <th className="py-2 pr-3">{ag.ovColStatus}</th>
                  <th className="py-2">{ag.ovColNoteTime}</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => {
                  const fee = Number(w.fee_amount || 0);
                  const net = Number(w.net_amount ?? w.amount - fee);
                  return (
                    <tr
                      key={w.id}
                      className="border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-2.5 pr-3 font-mono-num">
                        <div className="font-semibold">¥{Number(w.amount).toFixed(2)}</div>
                        {fee > 0 && (
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {fmt(ag.ovWdNetLine, { net: net.toFixed(2) })}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-mono-num">{w.account_info}</div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {w.channel === 'alipay'
                            ? ag.ovChannelAlipay
                            : w.channel === 'wechat'
                              ? ag.ovChannelWechatShort
                              : 'USDT-TRC20'}
                          {w.account_name ? ` · ${w.account_name}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                          style={{
                            backgroundColor:
                              w.status === 'paid'
                                ? 'var(--success-soft)'
                                : w.status === 'rejected'
                                  ? 'var(--danger-soft)'
                                  : 'var(--accent-soft)',
                            color:
                              w.status === 'paid'
                                ? 'var(--success)'
                                : w.status === 'rejected'
                                  ? 'var(--danger)'
                                  : 'var(--accent)',
                          }}
                        >
                          {w.status === 'paid'
                            ? ag.ovWdStatusPaid
                            : w.status === 'rejected'
                              ? ag.ovWdStatusRejected
                              : ag.ovWdStatusPending}
                        </span>
                      </td>
                      <td className="py-2.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {w.admin_note || w.created_at}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
