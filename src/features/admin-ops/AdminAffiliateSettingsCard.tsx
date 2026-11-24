/**
 * 总控后台营销中心：主站邀请有礼与推广返佣设置卡片
 */

import { Gift, Save } from 'lucide-react';
import type React from 'react';
import { adminApi } from '../../api/admin.api';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';

interface AdminAffiliateSettingsCardProps {
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onReload: () => Promise<void>;
  onStorefrontUpdated?: () => void;
  showToast: (msg: string) => void;
}

export function AdminAffiliateSettingsCard({
  settingsDraft,
  setSettingsDraft,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminAffiliateSettingsCardProps) {
  const ac = useAdminCoreI18n();

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2 className="font-editorial text-xl font-semibold">{ac.mktAffTitle}</h2>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {ac.mktAffSubtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="block text-xs font-semibold mb-1">{ac.setAffEnableLabel}</div>
          <select
            value={settingsDraft.affiliate_enabled ?? '1'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, affiliate_enabled: e.target.value }))}
            className="acct-input"
          >
            <option value="1">{ac.setAffOptOn}</option>
            <option value="0">{ac.setAffOptOff}</option>
          </select>
        </div>
        <div>
          <div className="block text-xs font-semibold mb-1">{ac.setAffRateLabel}</div>
          <input
            type="number"
            min="0"
            max="0.5"
            step="0.01"
            value={settingsDraft.affiliate_commission_rate ?? '0.05'}
            onChange={(e) =>
              setSettingsDraft((prev) => ({ ...prev, affiliate_commission_rate: e.target.value }))
            }
            placeholder={ac.setAffRatePlaceholder}
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block text-xs font-semibold mb-1">{ac.setAffMinOrderLabel}</div>
          <input
            type="number"
            min="0"
            step="1"
            value={settingsDraft.affiliate_min_order_amount ?? '10'}
            onChange={(e) =>
              setSettingsDraft((prev) => ({ ...prev, affiliate_min_order_amount: e.target.value }))
            }
            className="acct-input font-mono-num"
          />
        </div>
        <div>
          <div className="block text-xs font-semibold mb-1">{ac.setAffMaxRewardLabel}</div>
          <input
            type="number"
            min="0"
            step="1"
            value={settingsDraft.affiliate_max_reward ?? '0'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, affiliate_max_reward: e.target.value }))}
            className="acct-input font-mono-num"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={async () => {
          await adminApi.updateSettings({
            affiliate_enabled: settingsDraft.affiliate_enabled ?? '1',
            affiliate_commission_rate: settingsDraft.affiliate_commission_rate ?? '0.05',
            affiliate_min_order_amount: settingsDraft.affiliate_min_order_amount ?? '10',
            affiliate_max_reward: settingsDraft.affiliate_max_reward ?? '0',
          });
          await onReload();
          onStorefrontUpdated?.();
          showToast(ac.mktAffSavedToast);
        }}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        <Save className="w-4 h-4" />
        {ac.mktAffSaveBtn}
      </button>
    </div>
  );
}
