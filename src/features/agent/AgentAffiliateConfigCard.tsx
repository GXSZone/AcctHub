/**
 * 分站独立运营策略卡：邀请有礼 · 推广消费金开关、比例与门槛配置
 */

import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Gift, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { agentApi } from '../../api/agent.api';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useAgentAffiliateConfigQuery } from '../../queries/agent.queries';

interface AgentAffiliateConfigCardProps {
  agentSlug?: string;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentAffiliateConfigCard({ agentSlug, onToast, onError }: AgentAffiliateConfigCardProps) {
  const ag = useAgentI18n();
  const queryClient = useQueryClient();
  const cfgQuery = useAgentAffiliateConfigQuery(true);
  const [enabled, setEnabled] = useState(false);
  const [commissionRate, setCommissionRate] = useState('0.05');
  const [minOrderAmount, setMinOrderAmount] = useState('10');
  const [maxReward, setMaxReward] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const data = cfgQuery.data;
    if (!data) return;
    setEnabled(Boolean(data.enabled));
    setCommissionRate(String(data.commission_rate ?? 0.05));
    setMinOrderAmount(String(data.min_order_amount ?? 10));
    setMaxReward(String(data.max_reward ?? 0));
  }, [cfgQuery.data]);

  const handleSave = async () => {
    setSaving(true);
    onError('');
    try {
      await agentApi.updateAffiliateConfig({
        enabled,
        commission_rate: Math.min(0.5, Math.max(0, Number(commissionRate) || 0)),
        min_order_amount: Math.max(0, Number(minOrderAmount) || 0),
        max_reward: Math.max(0, Number(maxReward) || 0),
      });
      await Promise.all([
        cfgQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ['account', 'affiliate'] }),
      ]);
      onToast(ag.affCfgSavedToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.affCfgSaveFailErr);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div className="pb-3 border-b space-y-1" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ag.affCfgTitle}</h2>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {ag.affCfgSubtitle}
        </p>
      </div>

      {cfgQuery.isLoading ? (
        <div className="py-4 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <div className="block text-xs font-semibold mb-1">{ag.affCfgEnableLabel}</div>
            <select
              value={enabled ? '1' : '0'}
              onChange={(e) => setEnabled(e.target.value === '1')}
              className="acct-input"
            >
              <option value="1">{ag.affCfgOptOn}</option>
              <option value="0">{ag.affCfgOptOff}</option>
            </select>
          </div>

          <div>
            <div className="block text-xs font-semibold mb-1">{ag.affCfgRateLabel}</div>
            <input
              type="number"
              min="0"
              max="0.5"
              step="0.01"
              value={commissionRate}
              onChange={(e) => setCommissionRate(e.target.value)}
              className="acct-input font-mono-num"
            />
          </div>

          <div>
            <div className="block text-xs font-semibold mb-1">{ag.affCfgMinOrderLabel}</div>
            <input
              type="number"
              min="0"
              step="1"
              value={minOrderAmount}
              onChange={(e) => setMinOrderAmount(e.target.value)}
              className="acct-input font-mono-num"
            />
          </div>

          <div className="md:col-span-2">
            <div className="block text-xs font-semibold mb-1">{ag.affCfgMaxRewardLabel}</div>
            <input
              type="number"
              min="0"
              step="1"
              value={maxReward}
              onChange={(e) => setMaxReward(e.target.value)}
              className="acct-input font-mono-num"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || cfgQuery.isLoading}
          onClick={() => void handleSave()}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {ag.affCfgSaveBtn}
        </button>

        {agentSlug && (
          <Link
            to="/account/affiliate"
            className="px-3.5 py-2 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 no-underline transition-colors hover:bg-[var(--bg-subtle)]"
            style={{
              borderColor: 'var(--border-color)',
              color: 'var(--ink-secondary)',
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {ag.affCfgPreviewLink}
          </Link>
        )}
      </div>
    </div>
  );
}
