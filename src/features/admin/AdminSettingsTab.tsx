/**
 * 总控后台站点运营配置标签页（5 个聚焦 Tab：品牌与首页 / 导航与客服 / 支付渠道 / 发信邮箱 / 运维告警）
 */

import {
  BellRing,
  Compass,
  CreditCard,
  KeyRound,
  Loader2,
  Mail,
  Palette,
  Save,
  ShieldAlert,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import type React from 'react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { HeaderLinksEditor } from '../../components/HeaderLinksEditor';
import { SupportConfigEditor } from '../../components/SupportConfigEditor';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useExtensionsI18n } from '../../i18n/namespaces/extensions';
import { useOAuthI18n } from '../../i18n/namespaces/oauth';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { AdminNotifyCard, type NotifyConfigState } from '../admin-ops';
import { Admin2FaPanel } from './Admin2FaPanel';
import { AdminPaymentsTab } from './AdminPaymentsTab';
import { AdminRiskControlTab } from './AdminRiskControlTab';
import { AdminWebhooksPanel } from './AdminWebhooksPanel';
import type { AdminOverview } from './admin.types';

const MailConfigPanel = lazy(() =>
  import('../mail/MailConfigPanel').then((m) => ({ default: m.MailConfigPanel }))
);
const OAuthConfigPanel = lazy(() =>
  import('../oauth/OAuthConfigPanel').then((m) => ({ default: m.OAuthConfigPanel }))
);

type SettingsSubTab =
  | 'brand'
  | 'nav_support'
  | 'payments'
  | 'mail'
  | 'oauth'
  | 'webhooks'
  | 'notify'
  | 'risk'
  | 'admin_2fa';

interface AdminSettingsTabProps {
  initialSubTab?: SettingsSubTab;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  notifyConfig?: NotifyConfigState;
  paymentPlugins: AdminOverview['payment_plugins'];
  fxSnapshot?: AdminOverview['fx_snapshot'];
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

const MAIN_ACCENT_PRESETS = ['#D97757', '#2D6A57', '#3B6FD8', '#7C5CFA', '#B85D3B', '#1F6F78'];

export function AdminSettingsTab({
  initialSubTab = 'brand',
  settingsDraft,
  setSettingsDraft,
  notifyConfig,
  paymentPlugins,
  fxSnapshot,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminSettingsTabProps) {
  const ac = useAdminCoreI18n();
  const oa = useOAuthI18n();
  const pc = useExtensionsI18n();
  const rf = useRiskControlI18n();
  const [subTab, setSubTab] = useState<SettingsSubTab>(initialSubTab);
  const prevInitialSubTabRef = useRef(initialSubTab);
  useEffect(() => {
    if (initialSubTab && initialSubTab !== prevInitialSubTabRef.current) {
      prevInitialSubTabRef.current = initialSubTab;
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);
  const mainAccent = settingsDraft.theme_accent || '';

  const tabs: Array<{
    id: SettingsSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'brand', label: ac.setSubTabBrand, icon: Palette },
    { id: 'nav_support', label: ac.setSubTabNavSupport, icon: Compass },
    { id: 'payments', label: ac.setSubTabPayments, icon: CreditCard },
    { id: 'mail', label: ac.setSubTabMail, icon: Mail },
    { id: 'oauth', label: oa.tabLabel, icon: KeyRound },
    { id: 'webhooks', label: pc.webhooksSubTab, icon: Webhook },
    { id: 'notify', label: ac.setSubTabNotify, icon: BellRing },
    { id: 'risk', label: rf.riskSubTabLabel, icon: ShieldAlert },
    { id: 'admin_2fa', label: pc.admin2FaSubTab, icon: ShieldCheck },
  ];

  const handleSaveSettings = async () => {
    await adminApi.updateSettings(settingsDraft);
    await onReload();
    onStorefrontUpdated();
    showToast(ac.setSavedToast);
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ac.navSettingsLabel}
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

      {/* Tab 1：品牌与首页外观 */}
      {subTab === 'brand' && (
        <div className="paper-card rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="font-editorial text-xl font-semibold">{ac.setTitle}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ac.setSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              ['brand_name', ac.setBrandName],
              ['brand_logo_url', ac.setBrandLogoUrl],
              ['brand_tagline', ac.setBrandTagline],
              ['hero_title', ac.setHeroTitle],
              ['hero_subtitle', ac.setHeroSubtitle],
            ].map(([key, label]) => (
              <div key={key}>
                <div className="block text-xs font-semibold mb-1">{label}</div>
                <input
                  type="text"
                  value={settingsDraft[key] || ''}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={key === 'brand_logo_url' ? 'https://cdn.example.com/logo.png' : undefined}
                  className="acct-input"
                />
              </div>
            ))}

            <div>
              <div className="block text-xs font-semibold mb-1">{ac.setThemeAccentLabel}</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(mainAccent) ? mainAccent : '#D97757'}
                  onChange={(e) =>
                    setSettingsDraft((prev) => ({ ...prev, theme_accent: e.target.value.toUpperCase() }))
                  }
                  className="w-9 h-9 rounded-lg border p-0.5 cursor-pointer shrink-0"
                  style={{ borderColor: 'var(--border-color)' }}
                  aria-label={ac.setThemeAccentLabel}
                />
                <input
                  type="text"
                  value={mainAccent}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, theme_accent: e.target.value }))}
                  placeholder="#D97757"
                  className="acct-input font-mono-num flex-1"
                />
                {mainAccent && (
                  <button
                    type="button"
                    onClick={() => setSettingsDraft((prev) => ({ ...prev, theme_accent: '' }))}
                    className="px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    {ac.setThemeAccentReset}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {MAIN_ACCENT_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setSettingsDraft((prev) => ({ ...prev, theme_accent: hex }))}
                    className="w-4 h-4 rounded-full border cursor-pointer"
                    style={{
                      backgroundColor: hex,
                      borderColor: mainAccent.toUpperCase() === hex ? 'var(--ink-primary)' : 'transparent',
                    }}
                    aria-label={hex}
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="block text-xs font-semibold mb-1">{ac.setDefaultViewLabel}</div>
              <select
                value={settingsDraft.default_view_mode || 'list'}
                onChange={(e) => setSettingsDraft((prev) => ({ ...prev, default_view_mode: e.target.value }))}
                className="acct-input"
              >
                <option value="list">{ac.setViewListOpt}</option>
                <option value="grid">{ac.setViewGridOpt}</option>
              </select>
            </div>

            <div>
              <div className="block text-xs font-semibold mb-1">{ac.setIntentMatchLabel}</div>
              <select
                value={settingsDraft.show_smart_bar || 'true'}
                onChange={(e) => setSettingsDraft((prev) => ({ ...prev, show_smart_bar: e.target.value }))}
                className="acct-input"
              >
                <option value="true">{ac.setOptOn}</option>
                <option value="false">{ac.setOptOff}</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-color)' }}>
            <div>
              <h3 className="text-sm font-semibold">{rf.legalSectionTitle}</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                {rf.legalSectionDesc}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              {(
                [
                  ['legal_terms', rf.legalTermsTitle],
                  ['legal_privacy', rf.legalPrivacyTitle],
                  ['legal_refund', rf.legalRefundTitle],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div className="block text-xs font-semibold mb-1">{label}</div>
                  <textarea
                    rows={3}
                    value={settingsDraft[key] || ''}
                    onChange={(e) => setSettingsDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="acct-input text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSaveSettings()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-4 h-4" />
            {ac.setSaveBtn}
          </button>
        </div>
      )}

      {/* Tab 2：顶部导航自定义外链与悬浮客服 */}
      {subTab === 'nav_support' && (
        <div className="paper-card rounded-2xl p-6 space-y-5">
          <HeaderLinksEditor
            linksJson={settingsDraft.header_links_json || '[]'}
            onChangeJson={(v) => setSettingsDraft((prev) => ({ ...prev, header_links_json: v }))}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              ['support_label', ac.setSupportLabel],
              ['support_url', ac.setSupportUrl],
              ['support_note', ac.setSupportNote],
            ].map(([key, label]) => (
              <div key={key}>
                <div className="block text-xs font-semibold mb-1">{label}</div>
                <input
                  type="text"
                  value={settingsDraft[key] || ''}
                  onChange={(e) => setSettingsDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="acct-input"
                />
              </div>
            ))}
          </div>

          <SupportConfigEditor
            mediaJson={settingsDraft.support_media_json || '[]'}
            linksJson={settingsDraft.support_links_json || '[]'}
            onChangeMediaJson={(v) => setSettingsDraft((prev) => ({ ...prev, support_media_json: v }))}
            onChangeLinksJson={(v) => setSettingsDraft((prev) => ({ ...prev, support_links_json: v }))}
          />

          <button
            type="button"
            onClick={() => void handleSaveSettings()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-4 h-4" />
            {ac.setSaveBtn}
          </button>
        </div>
      )}

      {subTab === 'payments' && (
        <AdminPaymentsTab
          plugins={paymentPlugins}
          fxSnapshot={fxSnapshot}
          onReload={onReload}
          onStorefrontUpdated={onStorefrontUpdated}
          showToast={showToast}
        />
      )}

      <Suspense
        fallback={
          <div
            className="paper-card rounded-2xl p-10 flex items-center justify-center gap-2 text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            {ac.pageLazyLoading}
          </div>
        }
      >
        {subTab === 'mail' && (
          <MailConfigPanel
            mode="admin"
            defaultBrandName={settingsDraft.brand_name || 'AcctHub'}
            showToast={showToast}
          />
        )}

        {subTab === 'oauth' && <OAuthConfigPanel mode="admin" showToast={showToast} />}
      </Suspense>

      {subTab === 'webhooks' && <AdminWebhooksPanel showToast={showToast} />}

      {subTab === 'notify' && (
        <AdminNotifyCard notifyConfig={notifyConfig} onReload={onReload} showToast={showToast} />
      )}

      {subTab === 'risk' && <AdminRiskControlTab showToast={showToast} />}

      {subTab === 'admin_2fa' && <Admin2FaPanel showToast={showToast} />}
    </div>
  );
}
