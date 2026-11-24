/**
 * 站点顶部滚动横幅配置与实时预览分区
 */

import { Plus, Save, Trash2 } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';
import { AnnouncementTicker } from '../../components/AnnouncementTicker';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';
import type { Announcement } from '../../types';

interface NoticeTickerSectionProps {
  siteLabel: string;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  storefrontAnnouncements: Announcement[];
  onSaveSettings: (draft: Record<string, string>, toastMsg: string) => Promise<void>;
  onJumpToNotices: () => void;
  onPreviewPopup: () => void;
}

export function NoticeTickerSection({
  siteLabel,
  settingsDraft,
  setSettingsDraft,
  storefrontAnnouncements,
  onSaveSettings,
  onJumpToNotices,
  onPreviewPopup,
}: NoticeTickerSectionProps) {
  const an = useAdminNoticeI18n();
  const [newTickerLine, setNewTickerLine] = useState('');

  const tickerEnabled = (settingsDraft.ticker_enabled ?? 'true') !== 'false';
  const tickerIncludeNotices = (settingsDraft.ticker_include_notices ?? 'true') !== 'false';

  const tickerItems = useMemo(() => {
    const raw = settingsDraft.announcement_banner || '';
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : [''];
  }, [settingsDraft.announcement_banner]);

  const updateTickerLines = (lines: string[]) => {
    setSettingsDraft((prev) => ({
      ...prev,
      announcement_banner: lines
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n'),
    }));
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{fmt(an.tickerTitle, { siteLabel })}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {fmt(an.tickerDesc, { siteLabel })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onSaveSettings(settingsDraft, fmt(an.tickerSavedToast, { siteLabel }))}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Save className="w-3.5 h-3.5" />
          {an.tickerSaveBtn}
        </button>
      </div>

      <div>
        <div
          className="text-[11px] font-medium uppercase tracking-wider mb-2"
          style={{ color: 'var(--ink-muted)' }}
        >
          {an.tickerLivePreviewLabel}
        </div>
        {tickerEnabled ? (
          <div className="-mb-4">
            <AnnouncementTicker
              announcements={tickerIncludeNotices ? storefrontAnnouncements : []}
              extraBannerText={settingsDraft.announcement_banner}
              mode={settingsDraft.ticker_mode || 'vertical'}
              onOpenAll={onJumpToNotices}
              onOpenWelcomePopup={onPreviewPopup}
            />
          </div>
        ) : (
          <div
            className="p-4 rounded-xl border border-dashed text-center text-xs"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-muted)' }}
          >
            {fmt(an.tickerDisabledTip, { siteLabel })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
        <div>
          <div className="block text-xs font-semibold mb-1">{an.tickerSwitchLabel}</div>
          <select
            value={settingsDraft.ticker_enabled ?? 'true'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, ticker_enabled: e.target.value }))}
            className="acct-input"
          >
            <option value="true">{an.tickerSwitchOn}</option>
            <option value="false">{an.tickerSwitchOff}</option>
          </select>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1">{an.tickerAnimLabel}</div>
          <select
            value={settingsDraft.ticker_mode || 'vertical'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, ticker_mode: e.target.value }))}
            className="acct-input"
          >
            <option value="vertical">{an.tickerAnimVertical}</option>
            <option value="marquee">{an.tickerAnimMarquee}</option>
          </select>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1">{an.tickerSourceLabel}</div>
          <select
            value={settingsDraft.ticker_include_notices ?? 'true'}
            onChange={(e) =>
              setSettingsDraft((prev) => ({ ...prev, ticker_include_notices: e.target.value }))
            }
            className="acct-input"
          >
            <option value="true">{fmt(an.tickerSourceMerged, { siteLabel })}</option>
            <option value="false">{an.tickerSourceCustom}</option>
          </select>
        </div>
      </div>

      <div className="space-y-2.5 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{an.tickerItemsTitle}</span>
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {fmt(an.tickerItemsCount, { count: tickerItems.filter(Boolean).length })}
          </span>
        </div>

        <div className="space-y-2">
          {tickerItems.map((line, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span
                className="w-6 h-6 rounded-full text-[11px] font-mono-num flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
              >
                {idx + 1}
              </span>
              <input
                type="text"
                value={line}
                onChange={(e) => {
                  const next = [...tickerItems];
                  next[idx] = e.target.value;
                  setSettingsDraft((prev) => ({ ...prev, announcement_banner: next.join('\n') }));
                }}
                placeholder={an.tickerItemPlaceholder}
                className="acct-input py-2 text-xs flex-1"
              />
              <button
                type="button"
                onClick={() => updateTickerLines(tickerItems.filter((_, i) => i !== idx))}
                className="p-2 rounded-xl cursor-pointer shrink-0"
                style={{ color: 'var(--danger)' }}
                title={an.tickerItemRemoveBtn}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={newTickerLine}
            onChange={(e) => setNewTickerLine(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!newTickerLine.trim()) return;
                updateTickerLines([...tickerItems.filter(Boolean), newTickerLine.trim()]);
                setNewTickerLine('');
              }
            }}
            placeholder={an.tickerNewPlaceholder}
            className="acct-input py-2 text-xs flex-1"
          />
          <button
            type="button"
            onClick={() => {
              if (!newTickerLine.trim()) return;
              updateTickerLines([...tickerItems.filter(Boolean), newTickerLine.trim()]);
              setNewTickerLine('');
            }}
            className="px-4 py-2 rounded-xl text-xs font-medium border cursor-pointer inline-flex items-center gap-1 shrink-0"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {an.tickerAddBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
