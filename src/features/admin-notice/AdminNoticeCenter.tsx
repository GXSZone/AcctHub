/**
 * 站点消息、横幅、弹窗与直属下级通知管理中心（同时支持总控与代理分站）
 */

import { BellRing, BookOpen, Megaphone, Newspaper, Users } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { agentApi } from '../../api/agent.api';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { WelcomePopupModal } from '../../components/WelcomePopupModal';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';
import type { Announcement } from '../../types';
import { AdminHelpTab, type HelpArticleRow } from '../admin/AdminHelpTab';
import { NoticeDownlinesSection } from './NoticeDownlinesSection';
import { NoticeListSection } from './NoticeListSection';
import { NoticePopupSection } from './NoticePopupSection';
import { NoticeTickerSection } from './NoticeTickerSection';

export type NoticeSubTab = 'ticker' | 'popup' | 'notices' | 'downlines' | 'help';

interface AdminNoticeCenterProps {
  mode?: 'admin' | 'agent';
  initialSubTab?: NoticeSubTab;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  announcements: Announcement[];
  helpArticles?: HelpArticleRow[];
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function AdminNoticeCenter({
  mode = 'admin',
  initialSubTab = 'ticker',
  settingsDraft,
  setSettingsDraft,
  announcements,
  helpArticles,
  onReload,
  onStorefrontUpdated,
  showToast,
}: AdminNoticeCenterProps) {
  const an = useAdminNoticeI18n();
  const [subTab, setSubTab] = useState<NoticeSubTab>(initialSubTab);
  const [agentHelpArticles, setAgentHelpArticles] = useState<HelpArticleRow[]>([]);
  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);
  const [previewDownlinePopup, setPreviewDownlinePopup] = useState<{
    open: boolean;
    title?: string;
    content?: string;
  }>({ open: false });

  const isAgent = mode === 'agent';
  const siteLabel = isAgent ? an.siteLabelAgent : an.siteLabelAdmin;

  const loadAgentHelp = useCallback(async () => {
    if (!isAgent) return;
    try {
      const res = await tenantAgentApi.listHelp();
      setAgentHelpArticles(res.items || []);
    } catch {
      /* 忽略加载异常，列表保持当前态 */
    }
  }, [isAgent]);

  useEffect(() => {
    void loadAgentHelp();
  }, [loadAgentHelp]);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const activeHelpArticles = isAgent ? agentHelpArticles : (helpArticles ?? []);

  const storefrontAnnouncements = useMemo(
    () => announcements.filter((a) => (a.audience || 'storefront') === 'storefront'),
    [announcements]
  );
  const downlineAnnouncements = useMemo(
    () => announcements.filter((a) => a.audience === 'direct_downlines'),
    [announcements]
  );

  const persistSettings = async (nextDraft: Record<string, string>, toastMsg: string) => {
    if (isAgent) await agentApi.updateNoticeSettings(nextDraft);
    else await adminApi.updateSettings(nextDraft);
    await onReload();
    onStorefrontUpdated();
    showToast(toastMsg);
  };

  const deleteDownlinePopupHistory = async (historyId: string) => {
    if (isAgent) await agentApi.deleteDownlinePopupHistory(historyId);
    else await adminApi.deleteDownlinePopupHistory(historyId);
    await onReload();
  };

  const createAnnouncement = async (payload: {
    title: string;
    content: string;
    level: string;
    audience: 'storefront' | 'direct_downlines';
    is_pinned: boolean;
  }) => {
    if (isAgent) await agentApi.createAnnouncement(payload);
    else await adminApi.createAnnouncement(payload);
  };

  const updateAnnouncement = async (
    id: number,
    payload: {
      title?: string;
      content?: string;
      level?: string;
      audience?: 'storefront' | 'direct_downlines';
      is_pinned?: boolean;
    }
  ) => {
    if (isAgent) await agentApi.updateAnnouncement(id, payload);
    else await adminApi.updateAnnouncement(id, payload);
  };

  const deleteAnnouncement = async (id: number) => {
    if (isAgent) await agentApi.deleteAnnouncement(id);
    else await adminApi.deleteAnnouncement(id);
  };

  const tickerEnabled = (settingsDraft.ticker_enabled ?? 'true') !== 'false';
  const popupEnabled = (settingsDraft.popup_enabled ?? (isAgent ? 'false' : 'true')) === 'true';
  const downlinePopupEnabled = settingsDraft.downline_popup_enabled === 'true';

  const subTabs: Array<{
    id: NoticeSubTab;
    title: string;
    subtitle: string;
    statusText: string;
    statusOn: boolean;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'ticker',
      title: an.cardTickerTitle,
      subtitle: fmt(an.cardTickerDesc, { siteLabel }),
      statusText: tickerEnabled
        ? `${settingsDraft.ticker_mode === 'marquee' ? an.cardTickerModeMarquee : an.cardTickerModeVertical} · ${an.cardStatusOn}`
        : an.cardStatusOff,
      statusOn: tickerEnabled,
      icon: Megaphone,
    },
    {
      id: 'popup',
      title: an.cardPopupTitle,
      subtitle: fmt(an.cardPopupDesc, { siteLabel }),
      statusText: popupEnabled ? an.cardStatusOn : an.cardStatusOff,
      statusOn: popupEnabled,
      icon: BellRing,
    },
    {
      id: 'notices',
      title: an.cardListTitle,
      subtitle: fmt(an.cardListDesc, { siteLabel }),
      statusText: fmt(an.cardListCount, { count: storefrontAnnouncements.length }),
      statusOn: storefrontAnnouncements.length > 0,
      icon: Newspaper,
    },
    {
      id: 'downlines',
      title: an.cardDownlineTitle,
      subtitle: fmt(an.cardDownlineDesc, { siteLabel }),
      statusText: `${downlinePopupEnabled ? an.cardDownlinePopupPrefix : ''}${fmt(an.cardDownlineCount, { count: downlineAnnouncements.length })}`,
      statusOn: downlinePopupEnabled || downlineAnnouncements.length > 0,
      icon: Users,
    },
    {
      id: 'help',
      title: an.cardHelpTitle,
      subtitle: fmt(an.cardHelpDesc, { siteLabel }),
      statusText: fmt(an.cardHelpCount, { count: activeHelpArticles.length }),
      statusOn: activeHelpArticles.length > 0,
      icon: BookOpen,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 items-stretch">
        {subTabs.map((item) => {
          const Icon = item.icon;
          const active = subTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSubTab(item.id)}
              className="paper-card h-full rounded-2xl p-4 text-left cursor-pointer transition-all flex flex-col justify-between gap-2 min-w-0"
              style={{
                borderColor: active ? 'var(--accent)' : 'var(--border-color)',
                boxShadow: active ? 'inset 0 0 0 1px var(--accent)' : 'none',
                backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
              }}
            >
              <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold min-w-0 flex-1">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.title}</span>
                </span>
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
                  style={{
                    backgroundColor: item.statusOn ? 'var(--success-soft)' : 'var(--bg-subtle)',
                    color: item.statusOn ? 'var(--success)' : 'var(--ink-muted)',
                  }}
                >
                  {item.statusText}
                </span>
              </div>
              <p
                className="text-[11.5px] leading-relaxed line-clamp-2"
                style={{ color: 'var(--ink-secondary)' }}
              >
                {item.subtitle}
              </p>
            </button>
          );
        })}
      </div>

      {subTab === 'ticker' && (
        <NoticeTickerSection
          siteLabel={siteLabel}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          storefrontAnnouncements={storefrontAnnouncements}
          onSaveSettings={persistSettings}
          onJumpToNotices={() => setSubTab('notices')}
          onPreviewPopup={() => setPreviewPopupOpen(true)}
        />
      )}

      {subTab === 'popup' && (
        <NoticePopupSection
          siteLabel={siteLabel}
          popupEnabled={popupEnabled}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          onSaveSettings={persistSettings}
          onPreviewPopup={() => setPreviewPopupOpen(true)}
        />
      )}

      {subTab === 'notices' && (
        <NoticeListSection
          siteLabel={siteLabel}
          announcements={storefrontAnnouncements}
          onCreate={createAnnouncement}
          onUpdate={updateAnnouncement}
          onDelete={deleteAnnouncement}
          onReload={onReload}
          onStorefrontUpdated={onStorefrontUpdated}
          showToast={showToast}
        />
      )}

      {subTab === 'downlines' && (
        <NoticeDownlinesSection
          downlinePopupEnabled={downlinePopupEnabled}
          settingsDraft={settingsDraft}
          setSettingsDraft={setSettingsDraft}
          announcements={downlineAnnouncements}
          onSaveSettings={persistSettings}
          onPreviewDownlinePopup={(override) =>
            setPreviewDownlinePopup({
              open: true,
              title: override?.title,
              content: override?.content,
            })
          }
          onDeletePopupHistory={deleteDownlinePopupHistory}
          onCreate={createAnnouncement}
          onUpdate={updateAnnouncement}
          onDelete={deleteAnnouncement}
          onReload={onReload}
          showToast={showToast}
        />
      )}

      {subTab === 'help' && (
        <AdminHelpTab
          mode={mode}
          articles={activeHelpArticles}
          onReload={async () => {
            if (isAgent) await loadAgentHelp();
            else await onReload();
            onStorefrontUpdated();
          }}
          showToast={showToast}
        />
      )}

      <WelcomePopupModal
        open={previewPopupOpen}
        title={settingsDraft.popup_title || fmt(an.previewPopupDefaultTitle, { siteLabel })}
        content={settingsDraft.popup_content || an.previewPopupDefaultBody}
        badge={fmt(an.previewPopupBadge, { siteLabel })}
        showDismissToday={false}
        onClose={() => setPreviewPopupOpen(false)}
      />

      <WelcomePopupModal
        open={previewDownlinePopup.open}
        title={
          previewDownlinePopup.title ?? (settingsDraft.downline_popup_title || an.previewDownlineDefaultTitle)
        }
        content={
          previewDownlinePopup.content ??
          (settingsDraft.downline_popup_content || an.previewDownlineDefaultBody)
        }
        badge={an.previewDownlineBadge}
        showDismissToday={false}
        onClose={() => setPreviewDownlinePopup({ open: false })}
      />
    </div>
  );
}
