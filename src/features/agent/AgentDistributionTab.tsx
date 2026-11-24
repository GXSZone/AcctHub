/**
 * 分站工作台：下级分销合并面板（2 个聚焦 Tab：下级等级体系 / 我的直属下级）
 */

import { Layers, Users } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import type { AgentMeResponse } from '../../api/agent.api';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import type { AgentTierInfo } from '../../types';
import { AgentDownlinesTab } from './AgentDownlinesTab';
import { AgentTiersTab } from './AgentTiersTab';

export type AgentDistributionSubTab = 'tiers' | 'downlines';

interface AgentDistributionTabProps {
  initialSubTab?: AgentDistributionSubTab;
  myDownlineTiers: AgentTierInfo[];
  myDiscountFloor: number;
  subAgents: AgentMeResponse['sub_agents'];
  directSubCount: number;
  totalDownlineCount: number;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentDistributionTab({
  initialSubTab = 'downlines',
  myDownlineTiers,
  myDiscountFloor,
  subAgents,
  directSubCount,
  totalDownlineCount,
  onRefresh,
  onToast,
  onError,
}: AgentDistributionTabProps) {
  const ag = useAgentI18n();
  const [subTab, setSubTab] = useState<AgentDistributionSubTab>(initialSubTab);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const tabs: Array<{
    id: AgentDistributionSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'downlines', label: ag.distSubTabDownlines, icon: Users, badge: directSubCount },
    { id: 'tiers', label: ag.distSubTabTiers, icon: Layers },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ag.tabDistribution}
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
              <span>{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className="px-1.5 py-0.5 rounded-full font-mono-num text-[10px] font-semibold leading-none"
                  style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'var(--accent-soft)',
                    color: active ? '#FAF9F5' : 'var(--accent)',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {subTab === 'downlines' && (
        <AgentDownlinesTab
          subAgents={subAgents}
          myDownlineTiers={myDownlineTiers}
          directSubCount={directSubCount}
          totalDownlineCount={totalDownlineCount}
          onRefresh={onRefresh}
          onToast={onToast}
          onError={onError}
        />
      )}

      {subTab === 'tiers' && (
        <AgentTiersTab
          myDownlineTiers={myDownlineTiers}
          myDiscountFloor={myDiscountFloor}
          onRefresh={onRefresh}
          onToast={onToast}
          onError={onError}
        />
      )}
    </div>
  );
}
