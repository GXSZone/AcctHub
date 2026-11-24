/**
 * 分站站点运营配置工作台（与主站总控 1:1 同款 Tab 风格：品牌与 SEO / 导航与客服 / 域名与开关 / 发信邮箱 / 自有收款）
 */

import {
  Compass,
  CreditCard,
  Globe,
  Headphones,
  KeyRound,
  Loader2,
  Mail,
  Palette,
  Save,
  Store,
} from 'lucide-react';
import type React from 'react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { agentApi } from '../../api/agent.api';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { HeaderLinksEditor } from '../../components/HeaderLinksEditor';
import { SupportConfigEditor } from '../../components/SupportConfigEditor';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useOAuthI18n } from '../../i18n/namespaces/oauth';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import type { AgentInfo } from '../../types';
import { AgentDomainCard } from './AgentDomainCard';
import { AgentPaymentConfigTab } from './AgentPaymentConfigTab';
import { AgentSeoThemeBox } from './AgentSeoThemeBox';
import { AgentSitePrefsCard } from './AgentSitePrefsCard';

const MailConfigPanel = lazy(() =>
  import('../mail/MailConfigPanel').then((m) => ({ default: m.MailConfigPanel }))
);
const OAuthConfigPanel = lazy(() =>
  import('../oauth/OAuthConfigPanel').then((m) => ({ default: m.OAuthConfigPanel }))
);

export type AgentSiteConfigSubTab = 'brand' | 'nav_support' | 'domain' | 'mail' | 'oauth' | 'own_payment';

interface AgentBrandDomainTabProps {
  agent: AgentInfo;
  domainConfig: {
    neutral_base_domain: string;
    saas_cname_target: string;
    cf_saas_enabled: boolean;
  };
  allowOwnPayment?: boolean;
  allowPrivateProducts?: boolean;
  initialSubTab?: AgentSiteConfigSubTab;
  onGoPrivateCatalog?: () => void;
  onRefresh: () => Promise<void>;
  onRefreshUser: () => void;
  onStorefrontUpdated?: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentBrandDomainTab({
  agent,
  domainConfig,
  allowOwnPayment = false,
  allowPrivateProducts = false,
  initialSubTab = 'brand',
  onGoPrivateCatalog,
  onRefresh,
  onRefreshUser,
  onStorefrontUpdated,
  onToast,
  onError,
}: AgentBrandDomainTabProps) {
  const ag = useAgentI18n();
  const oa = useOAuthI18n();
  const ss = useSaasI18n();
  const [subTab, setSubTab] = useState<AgentSiteConfigSubTab>(initialSubTab);

  const [brandName, setBrandName] = useState(agent.brand_name);
  const [brandTagline, setBrandTagline] = useState(agent.brand_tagline || '');
  const [supportLabel, setSupportLabel] = useState(agent.support_label || '');
  const [supportUrl, setSupportUrl] = useState(agent.support_url || '');
  const [supportNote, setSupportNote] = useState(agent.support_note || '');
  const [supportMediaJson, setSupportMediaJson] = useState(agent.support_media_json || '[]');
  const [supportLinksJson, setSupportLinksJson] = useState(agent.support_links_json || '[]');
  const [markupPercent, setMarkupPercent] = useState(agent.markup_percent);
  const [themeAccent, setThemeAccent] = useState(agent.theme_accent || '');
  const [faviconUrl, setFaviconUrl] = useState(agent.favicon_url || '');
  const [ogImageUrl, setOgImageUrl] = useState(agent.og_image_url || '');
  const [seoTitle, setSeoTitle] = useState(agent.seo_title || '');
  const [seoDescription, setSeoDescription] = useState(agent.seo_description || '');
  const [footerText, setFooterText] = useState(agent.footer_text || '');
  const [savingBrand, setSavingBrand] = useState(false);

  const [showApiDocs, setShowApiDocs] = useState(true);
  const [inheritPlatformHelp, setInheritPlatformHelp] = useState(true);
  const [headerLinksJson, setHeaderLinksJson] = useState('[]');
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  useEffect(() => {
    if (!allowOwnPayment && subTab === 'own_payment') setSubTab('brand');
  }, [allowOwnPayment, subTab]);

  useEffect(() => {
    setBrandName(agent.brand_name);
    setBrandTagline(agent.brand_tagline || '');
    setSupportLabel(agent.support_label || '');
    setSupportUrl(agent.support_url || '');
    setSupportNote(agent.support_note || '');
    setSupportMediaJson(agent.support_media_json || '[]');
    setSupportLinksJson(agent.support_links_json || '[]');
    setMarkupPercent(agent.markup_percent);
    setThemeAccent(agent.theme_accent || '');
    setFaviconUrl(agent.favicon_url || '');
    setOgImageUrl(agent.og_image_url || '');
    setSeoTitle(agent.seo_title || '');
    setSeoDescription(agent.seo_description || '');
    setFooterText(agent.footer_text || '');
  }, [agent]);

  useEffect(() => {
    tenantAgentApi
      .getSiteSettings()
      .then((res) => {
        setShowApiDocs(res.show_api_docs);
        setInheritPlatformHelp(res.inherit_platform_help);
        setHeaderLinksJson(res.header_links_json || '[]');
      })
      .catch(() => undefined);
  }, []);

  const syncAll = async () => {
    await onRefresh();
    onRefreshUser();
    onStorefrontUpdated?.();
  };

  const buildBrandPayload = () => ({
    brand_name: brandName,
    brand_tagline: brandTagline,
    support_label: supportLabel,
    support_url: supportUrl,
    support_note: supportNote,
    support_media_json: supportMediaJson,
    support_links_json: supportLinksJson,
    markup_percent: markupPercent,
    theme_accent: themeAccent,
    favicon_url: faviconUrl,
    og_image_url: ogImageUrl,
    seo_title: seoTitle,
    seo_description: seoDescription,
    footer_text: footerText,
  });

  const handleSaveBrand = async (e?: React.FormEvent, alsoSaveHeaderLinks = false) => {
    e?.preventDefault();
    setSavingBrand(true);
    onError('');
    try {
      await agentApi.updateBrand(buildBrandPayload());
      if (alsoSaveHeaderLinks) {
        await tenantAgentApi.updateSiteSettings({ header_links_json: headerLinksJson });
      }
      await syncAll();
      onToast(ag.bdBrandSavedToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.bdSaveFailErr);
    } finally {
      setSavingBrand(false);
    }
  };

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    onError('');
    try {
      await tenantAgentApi.updateSiteSettings({
        show_api_docs: showApiDocs,
        inherit_platform_help: inheritPlatformHelp,
        header_links_json: headerLinksJson,
      });
      onStorefrontUpdated?.();
      onToast(ss.prefSavedToast);
    } catch (err) {
      onError(err instanceof Error ? err.message : ag.bdSaveFailErr);
    } finally {
      setSavingPrefs(false);
    }
  };

  const tabs: Array<{
    id: AgentSiteConfigSubTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'brand', label: ag.cfgSubTabBrand, icon: Palette },
    { id: 'nav_support', label: ag.cfgSubTabNavSupport, icon: Compass },
    { id: 'domain', label: ag.cfgSubTabDomain, icon: Globe },
    { id: 'mail', label: ag.cfgSubTabMail, icon: Mail },
    { id: 'oauth', label: oa.tabLabel, icon: KeyRound },
    ...(allowOwnPayment
      ? [{ id: 'own_payment' as const, label: ag.cfgSubTabPayment, icon: CreditCard }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={ag.tabSiteConfig}
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

      {/* Tab 1：品牌信息、默认加价与主题 SEO */}
      {subTab === 'brand' && (
        <form
          onSubmit={(e) => void handleSaveBrand(e, false)}
          className="paper-card rounded-2xl p-6 space-y-5"
        >
          <div
            className="flex items-center gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <Store className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{ag.bdBrandSectionTitle}</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <div className="block text-xs font-semibold mb-1">{ag.bdStoreNameLabel}</div>
              <input
                type="text"
                required
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder={ag.bdStoreNamePlaceholder}
                className="acct-input"
              />
            </div>
            <div>
              <div className="block text-xs font-semibold mb-1">{ag.bdTaglineLabel}</div>
              <input
                type="text"
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                placeholder={ag.bdTaglinePlaceholder}
                className="acct-input"
              />
            </div>
            <div>
              <div className="block text-xs font-semibold mb-1">{ag.bdDefaultMarkupLabel}</div>
              <input
                type="number"
                min={0}
                max={200}
                value={markupPercent}
                onChange={(e) => setMarkupPercent(Number(e.target.value))}
                className="acct-input font-mono-num"
              />
            </div>
          </div>

          <AgentSeoThemeBox
            themeAccent={themeAccent}
            faviconUrl={faviconUrl}
            ogImageUrl={ogImageUrl}
            seoTitle={seoTitle}
            seoDescription={seoDescription}
            footerText={footerText}
            onChange={(patch) => {
              if (patch.theme_accent !== undefined) setThemeAccent(patch.theme_accent);
              if (patch.favicon_url !== undefined) setFaviconUrl(patch.favicon_url);
              if (patch.og_image_url !== undefined) setOgImageUrl(patch.og_image_url);
              if (patch.seo_title !== undefined) setSeoTitle(patch.seo_title);
              if (patch.seo_description !== undefined) setSeoDescription(patch.seo_description);
              if (patch.footer_text !== undefined) setFooterText(patch.footer_text);
            }}
          />

          <button
            type="submit"
            disabled={savingBrand}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {savingBrand ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {ag.bdSaveAllBtn}
          </button>
        </form>
      )}

      {/* Tab 2：顶部导航外链与悬浮客服 */}
      {subTab === 'nav_support' && (
        <div className="paper-card rounded-2xl p-6 space-y-5">
          <HeaderLinksEditor linksJson={headerLinksJson} onChangeJson={setHeaderLinksJson} />

          <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--border-color)' }}>
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Headphones className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {ag.bdSupportHeader}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                  {ag.bdSupportBtnLabel}
                </div>
                <input
                  type="text"
                  value={supportLabel}
                  onChange={(e) => setSupportLabel(e.target.value)}
                  placeholder={ag.bdSupportBtnPlaceholder}
                  className="acct-input text-xs"
                />
              </div>
              <div>
                <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                  {ag.bdSupportUrlLabel}
                </div>
                <input
                  type="text"
                  value={supportUrl}
                  onChange={(e) => setSupportUrl(e.target.value)}
                  placeholder="https://t.me/your_support"
                  className="acct-input text-xs font-mono-num"
                />
              </div>
              <div>
                <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                  {ag.bdSupportHoursLabel}
                </div>
                <input
                  type="text"
                  value={supportNote}
                  onChange={(e) => setSupportNote(e.target.value)}
                  placeholder={ag.bdSupportHoursPlaceholder}
                  className="acct-input text-xs"
                />
              </div>
            </div>

            <SupportConfigEditor
              mediaJson={supportMediaJson}
              linksJson={supportLinksJson}
              onChangeMediaJson={setSupportMediaJson}
              onChangeLinksJson={setSupportLinksJson}
            />
          </div>

          <button
            type="button"
            disabled={savingBrand}
            onClick={() => void handleSaveBrand(undefined, true)}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {savingBrand ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {ag.bdSaveAllBtn}
          </button>
        </div>
      )}

      {/* Tab 3：独立域名绑定与站点展示开关 */}
      {subTab === 'domain' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <AgentDomainCard agent={agent} domainConfig={domainConfig} onToast={onToast} onError={onError} />
          <AgentSitePrefsCard
            showApiDocs={showApiDocs}
            inheritPlatformHelp={inheritPlatformHelp}
            savingPrefs={savingPrefs}
            onChangeShowApiDocs={setShowApiDocs}
            onChangeInheritHelp={setInheritPlatformHelp}
            onSave={() => void handleSavePrefs()}
          />
        </div>
      )}

      {/* Tab 4：发信邮箱 */}
      {subTab === 'mail' && (
        <Suspense
          fallback={
            <div
              className="paper-card rounded-2xl p-8 flex items-center justify-center gap-2 text-xs"
              style={{ color: 'var(--ink-muted)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
              {ag.bdLoadingMail}
            </div>
          }
        >
          <MailConfigPanel
            mode="agent"
            defaultBrandName={brandName || agent.brand_name || ag.bdDefaultMailBrand}
            showToast={onToast}
          />
        </Suspense>
      )}

      {/* Tab 5：分站独立第三方 OAuth 授权登录 */}
      {subTab === 'oauth' && (
        <Suspense
          fallback={
            <div
              className="paper-card rounded-2xl p-8 flex items-center justify-center gap-2 text-xs"
              style={{ color: 'var(--ink-muted)' }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
          }
        >
          <OAuthConfigPanel mode="agent" showToast={onToast} onError={onError} />
        </Suspense>
      )}

      {/* Tab 6：自有收款渠道（仅获授权分站可见） */}
      {subTab === 'own_payment' && allowOwnPayment && (
        <AgentPaymentConfigTab
          allowPrivateProducts={allowPrivateProducts}
          onGoPrivateCatalog={onGoPrivateCatalog}
          onToast={onToast}
          onError={onError}
        />
      )}
    </div>
  );
}
