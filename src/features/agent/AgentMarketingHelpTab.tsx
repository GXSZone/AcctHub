/**
 * 分站营销工具面板（与主站营销中心 1:1 对称：专属优惠券[含启停切换] / 分站独立推广返佣）
 */

import { Gift, Loader2, Plus, Ticket, Trash2 } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { type AgentCouponItem, tenantAgentApi } from '../../api/tenant-agent.api';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import { AgentAffiliateConfigCard } from './AgentAffiliateConfigCard';

type AgentMarketingSubTab = 'coupons' | 'affiliate';

export function AgentMarketingHelpTab({
  agentSlug,
  onToast,
  onError,
}: {
  agentSlug: string;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const ag = useAgentI18n();
  const ss = useSaasI18n();
  const [subTab, setSubTab] = useState<AgentMarketingSubTab>('coupons');
  const [coupons, setCoupons] = useState<AgentCouponItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [cpnCode, setCpnCode] = useState('');
  const [cpnName, setCpnName] = useState('');
  const [cpnType, setCpnType] = useState<'fixed' | 'percent'>('fixed');
  const [cpnValue, setCpnValue] = useState('5');
  const [cpnMin, setCpnMin] = useState('20');
  const [cpnMax, setCpnMax] = useState('100');
  const [creatingCpn, setCreatingCpn] = useState(false);

  const loadCoupons = useCallback(async () => {
    try {
      const cRes = await tenantAgentApi.listCoupons();
      setCoupons(cRes.items || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  const handleCreateCoupon = async () => {
    if (!cpnCode.trim()) return;
    setCreatingCpn(true);
    try {
      await tenantAgentApi.createCoupon({
        code: cpnCode.trim().toUpperCase(),
        name: cpnName.trim() || cpnCode.trim().toUpperCase(),
        discount_type: cpnType,
        discount_value: Number(cpnValue || 0),
        min_order_amount: Number(cpnMin || 0),
        max_uses: Number(cpnMax || 0),
      });
      setCpnCode('');
      setCpnName('');
      await loadCoupons();
      onToast(ss.cpnCreatedToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setCreatingCpn(false);
    }
  };

  const tabs: Array<{
    id: AgentMarketingSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'coupons', label: ag.mktSubTabCoupons, icon: Ticket },
    { id: 'affiliate', label: ag.mktSubTabAffiliate, icon: Gift },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ag.tabMarketing}
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl border"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(item.id)}
              className="px-3.5 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer inline-flex items-center gap-1.5"
              style={{
                backgroundColor: active ? 'var(--accent)' : 'transparent',
                color: active ? '#FAF9F5' : 'var(--ink-secondary)',
              }}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {subTab === 'coupons' && (
        <div className="paper-card rounded-2xl p-6 space-y-4">
          <div className="pb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-2">
              <Ticket className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="font-editorial text-xl font-semibold">{ss.cpnTitle}</h2>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ss.cpnDesc}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
            <input
              type="text"
              value={cpnCode}
              onChange={(e) => setCpnCode(e.target.value.toUpperCase())}
              placeholder={ss.cpnCodePlaceholder}
              className="acct-input font-mono-num"
            />
            <input
              type="text"
              value={cpnName}
              onChange={(e) => setCpnName(e.target.value)}
              placeholder={ss.cpnNamePlaceholder}
              className="acct-input"
            />
            <select
              value={cpnType}
              onChange={(e) => setCpnType(e.target.value as 'fixed' | 'percent')}
              className="acct-input"
            >
              <option value="fixed">{ss.cpnTypeFixed}</option>
              <option value="percent">{ss.cpnTypePercent}</option>
            </select>
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={cpnValue}
              onChange={(e) => setCpnValue(e.target.value)}
              placeholder={ss.cpnValuePlaceholder}
              className="acct-input font-mono-num"
            />
            <input
              type="number"
              min="0"
              value={cpnMin}
              onChange={(e) => setCpnMin(e.target.value)}
              placeholder={ss.cpnMinOrderPlaceholder}
              className="acct-input font-mono-num"
            />
            <input
              type="number"
              min="0"
              value={cpnMax}
              onChange={(e) => setCpnMax(e.target.value)}
              placeholder={ss.cpnMaxUsesPlaceholder}
              className="acct-input font-mono-num"
            />
          </div>

          <button
            type="button"
            disabled={creatingCpn || !cpnCode.trim()}
            onClick={() => void handleCreateCoupon()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {creatingCpn ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {ss.cpnCreateBtn}
          </button>

          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          ) : coupons.length === 0 ? (
            <p className="text-xs py-2" style={{ color: 'var(--ink-muted)' }}>
              {ss.cpnEmpty}
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              {coupons.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-num font-bold" style={{ color: 'var(--accent)' }}>
                      {c.code}
                    </span>
                    <span className="font-medium">{c.name}</span>
                    <span
                      className="px-2 py-0.5 rounded-full font-mono-num text-[11px]"
                      style={{ backgroundColor: 'var(--bg-subtle)' }}
                    >
                      {c.discount_type === 'percent' ? `-${c.discount_value}%` : `-¥${c.discount_value}`}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {c.used_count}/{c.max_uses === 0 ? '∞' : c.max_uses}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await tenantAgentApi.toggleCoupon(c.id, !c.is_active);
                        await loadCoupons();
                        onToast(ss.cpnToggledToast);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: c.is_active ? 'var(--success-soft)' : 'var(--bg-subtle)',
                        color: c.is_active ? 'var(--success)' : 'var(--ink-muted)',
                      }}
                    >
                      {c.is_active ? ss.cpnStatusActive : ss.cpnStatusInactive}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await tenantAgentApi.deleteCoupon(c.id);
                        await loadCoupons();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] cursor-pointer"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3 h-3" />
                      {ss.cpnDeleteBtn}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'affiliate' && (
        <AgentAffiliateConfigCard agentSlug={agentSlug} onToast={onToast} onError={onError} />
      )}
    </div>
  );
}
