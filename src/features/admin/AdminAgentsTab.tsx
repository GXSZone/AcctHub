/**
 * 总控后台代理分站管理标签页（4 个聚焦 Tab：已签约分站 / 提现审核 / 等级体系 / 全局策略与费率）
 */

import { Banknote, Layers, Shield, Store } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { tenantAdminApi } from '../../api/tenant-admin.api';
import { AdminAgentOpsExtras, type SaasConfigState } from '../../components/AdminAgentOpsExtras';
import { useAdminAgentsI18n } from '../../i18n/namespaces/admin-agents';
import type { AgentWithdrawalRecord } from '../../types';
import { AdminAgentsListTable } from './AdminAgentsListTable';
import { AdminSaasGovernanceCard } from './AdminSaasGovernanceCard';
import { AdminTiersCard } from './AdminTiersCard';
import type { AdminAgentRow, AdminAgentTierRow, AdminProductRow } from './admin.types';

export type AdminAgentsSubTab = 'list' | 'withdrawals' | 'tiers' | 'policy';

interface AdminAgentsTabProps {
  agents: AdminAgentRow[];
  agentTiers: AdminAgentTierRow[];
  products: AdminProductRow[];
  saasConfig?: SaasConfigState;
  withdrawals: AgentWithdrawalRecord[];
  initialSubTab?: AdminAgentsSubTab;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminAgentsTab({
  agents,
  agentTiers,
  products,
  saasConfig,
  withdrawals,
  initialSubTab = 'list',
  onReload,
  showToast,
}: AdminAgentsTabProps) {
  const aa = useAdminAgentsI18n();
  const [subTab, setSubTab] = useState<AdminAgentsSubTab>(initialSubTab);
  const [saasPolicy, setSaasPolicy] = useState({ allowOwnPayGlobal: true, allowPrivateGlobal: true });

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  // 初始即同步全局 SaaS 开关，保证未切换至「全局策略」Tab 时分站表与等级页的禁用态依然准确
  useEffect(() => {
    let active = true;
    tenantAdminApi
      .getSaasPolicy()
      .then((res) => {
        if (!active) return;
        const own = Boolean(res.saas_allow_own_payment_global);
        setSaasPolicy({
          allowOwnPayGlobal: own,
          allowPrivateGlobal: own && Boolean(res.saas_allow_private_products_global),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handlePolicyLoaded = useCallback((p: { allowOwnPayGlobal: boolean; allowPrivateGlobal: boolean }) => {
    setSaasPolicy(p);
  }, []);

  const pendingWithdrawalsCount = withdrawals.filter((w) => w.status === 'pending').length;
  const ownPayGlobalOn = saasPolicy.allowOwnPayGlobal;
  const privateGlobalOn = ownPayGlobalOn && saasPolicy.allowPrivateGlobal;

  const tabs: Array<{
    id: AdminAgentsSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'list', label: aa.agentsSubTabList, icon: Store },
    {
      id: 'withdrawals',
      label: aa.agentsSubTabWithdrawals,
      icon: Banknote,
      badge: pendingWithdrawalsCount,
    },
    { id: 'tiers', label: aa.agentsSubTabTiers, icon: Layers },
    { id: 'policy', label: aa.agentsSubTabPolicy, icon: Shield },
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={aa.agentsSectionTitle}
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

      {subTab === 'list' && (
        <AdminAgentsListTable
          agents={agents}
          agentTiers={agentTiers}
          saasConfig={saasConfig}
          ownPayGlobalOn={ownPayGlobalOn}
          privateGlobalOn={privateGlobalOn}
          onReload={onReload}
          showToast={showToast}
        />
      )}

      {subTab === 'withdrawals' && (
        <AdminAgentOpsExtras
          saasConfig={saasConfig}
          withdrawals={withdrawals}
          section="withdrawals"
          onReload={onReload}
          showToast={showToast}
        />
      )}

      {subTab === 'tiers' && (
        <AdminTiersCard
          agentTiers={agentTiers}
          products={products}
          globalOwnPayEnabled={ownPayGlobalOn}
          globalPrivateEnabled={privateGlobalOn}
          onReload={onReload}
          showToast={showToast}
        />
      )}

      {subTab === 'policy' && (
        <div className="space-y-6">
          <AdminSaasGovernanceCard showToast={showToast} onPolicyLoaded={handlePolicyLoaded} />
          <AdminAgentOpsExtras
            saasConfig={saasConfig}
            withdrawals={withdrawals}
            section="saas"
            onReload={onReload}
            showToast={showToast}
          />
        </div>
      )}
    </div>
  );
}
