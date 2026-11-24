/**
 * 站点进站弹窗公告设置分区
 */

import { Eye, Save } from 'lucide-react';
import type React from 'react';
import { RichTextEditor } from '../../components/editor/RichTextEditor';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';

interface NoticePopupSectionProps {
  siteLabel: string;
  popupEnabled: boolean;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSaveSettings: (draft: Record<string, string>, toastMsg: string) => Promise<void>;
  onPreviewPopup: () => void;
}

export function NoticePopupSection({
  siteLabel,
  popupEnabled,
  settingsDraft,
  setSettingsDraft,
  onSaveSettings,
  onPreviewPopup,
}: NoticePopupSectionProps) {
  const an = useAdminNoticeI18n();

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{fmt(an.popupTitle, { siteLabel })}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {fmt(an.popupDesc, { siteLabel })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviewPopup}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Eye className="w-3.5 h-3.5" />
            {an.popupPreviewBtn}
          </button>
          <button
            type="button"
            onClick={async () => {
              const next = { ...settingsDraft, popup_version: String(Date.now()) };
              setSettingsDraft(next);
              await onSaveSettings(next, fmt(an.popupSavedToast, { siteLabel }));
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-3.5 h-3.5" />
            {an.popupSaveBtn}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="block text-xs font-semibold mb-1">{an.popupSwitchLabel}</div>
          <select
            value={popupEnabled ? 'true' : 'false'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, popup_enabled: e.target.value }))}
            className="acct-input"
          >
            <option value="true">{an.popupSwitchOn}</option>
            <option value="false">{an.popupSwitchOff}</option>
          </select>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1">{an.popupFreqLabel}</div>
          <select
            value={settingsDraft.popup_frequency || 'once_per_day'}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, popup_frequency: e.target.value }))}
            className="acct-input"
          >
            <option value="once_per_day">{an.popupFreqDaily}</option>
            <option value="once_per_session">{an.popupFreqSession}</option>
            <option value="always">{an.popupFreqAlways}</option>
          </select>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1">{an.popupMainTitleLabel}</div>
          <input
            type="text"
            value={settingsDraft.popup_title ?? ''}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, popup_title: e.target.value }))}
            placeholder={fmt(an.popupMainTitlePlaceholder, { siteLabel })}
            className="acct-input"
          />
        </div>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1.5">{an.popupBodyLabel}</div>
        <RichTextEditor
          value={settingsDraft.popup_content ?? ''}
          onChange={(html) => setSettingsDraft((prev) => ({ ...prev, popup_content: html }))}
          placeholder={an.popupBodyPlaceholder}
          minHeight={220}
        />
      </div>
    </div>
  );
}
