/**
 * 直属下级代理专属弹窗设置与历史推送记录卡片
 */

import { Clock, Eye, RotateCcw, Save, Trash2 } from 'lucide-react';
import type React from 'react';
import { useMemo } from 'react';
import { openConfirm } from '../../components/ConfirmDialog';
import { RichTextEditor } from '../../components/editor/RichTextEditor';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';

interface DownlinePopupHistoryItem {
  id: string;
  version: string;
  enabled: boolean;
  frequency: string;
  title: string;
  content: string;
  sent_at: string;
}

interface NoticeDownlinesPopupCardProps {
  downlinePopupEnabled: boolean;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSaveSettings: (draft: Record<string, string>, toastMsg: string) => Promise<void>;
  onPreviewDownlinePopup: (override?: { title: string; content: string }) => void;
  onDeletePopupHistory: (historyId: string) => Promise<void>;
  showToast: (msg: string) => void;
}

export function NoticeDownlinesPopupCard({
  downlinePopupEnabled,
  settingsDraft,
  setSettingsDraft,
  onSaveSettings,
  onPreviewDownlinePopup,
  onDeletePopupHistory,
  showToast,
}: NoticeDownlinesPopupCardProps) {
  const an = useAdminNoticeI18n();

  const historyItems = useMemo<DownlinePopupHistoryItem[]>(() => {
    const raw = settingsDraft.downline_popup_history;
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((x): x is DownlinePopupHistoryItem => Boolean(x && typeof x === 'object'))
        : [];
    } catch {
      return [];
    }
  }, [settingsDraft.downline_popup_history]);

  const frequencyLabel = (freq: string) => {
    if (freq === 'once_per_session') return an.downlinePopupFreqSession;
    if (freq === 'always') return an.downlinePopupFreqAlways;
    return an.downlinePopupFreqDaily;
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div
        className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{an.downlinePopupTitle}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {an.downlinePopupDescPrefix}
            <strong>{an.downlinePopupDescHighlight}</strong>
            {an.downlinePopupDescSuffix}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPreviewDownlinePopup()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer"
            style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <Eye className="w-3.5 h-3.5" />
            {an.downlinePopupPreviewBtn}
          </button>
          <button
            type="button"
            onClick={async () => {
              const next = { ...settingsDraft, downline_popup_version: String(Date.now()) };
              setSettingsDraft(next);
              await onSaveSettings(next, an.downlinePopupSavedToast);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-3.5 h-3.5" />
            {an.downlinePopupSaveBtn}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <div className="block text-xs font-semibold mb-1">{an.downlinePopupSwitchLabel}</div>
          <select
            value={downlinePopupEnabled ? 'true' : 'false'}
            onChange={(e) =>
              setSettingsDraft((prev) => ({ ...prev, downline_popup_enabled: e.target.value }))
            }
            className="acct-input"
          >
            <option value="true">{an.downlinePopupSwitchOn}</option>
            <option value="false">{an.downlinePopupSwitchOff}</option>
          </select>
        </div>
        <div>
          <div className="block text-xs font-semibold mb-1">{an.downlinePopupFreqLabel}</div>
          <select
            value={settingsDraft.downline_popup_frequency || 'once_per_day'}
            onChange={(e) =>
              setSettingsDraft((prev) => ({ ...prev, downline_popup_frequency: e.target.value }))
            }
            className="acct-input"
          >
            <option value="once_per_day">{an.downlinePopupFreqDaily}</option>
            <option value="once_per_session">{an.downlinePopupFreqSession}</option>
            <option value="always">{an.downlinePopupFreqAlways}</option>
          </select>
        </div>
        <div>
          <div className="block text-xs font-semibold mb-1">{an.downlinePopupTitleLabel}</div>
          <input
            type="text"
            value={settingsDraft.downline_popup_title ?? ''}
            onChange={(e) => setSettingsDraft((prev) => ({ ...prev, downline_popup_title: e.target.value }))}
            placeholder={an.downlinePopupTitlePlaceholder}
            className="acct-input"
          />
        </div>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1.5">{an.downlinePopupBodyLabel}</div>
        <RichTextEditor
          value={settingsDraft.downline_popup_content ?? ''}
          onChange={(html) => setSettingsDraft((prev) => ({ ...prev, downline_popup_content: html }))}
          placeholder={an.downlinePopupBodyPlaceholder}
          minHeight={180}
        />
      </div>

      <div className="pt-4 border-t space-y-3" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {fmt(an.downlineHistoryTitle, { count: historyItems.length })}
          </h3>
        </div>

        {historyItems.length === 0 ? (
          <p
            className="text-xs py-4 text-center rounded-xl border"
            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
          >
            {an.downlineHistoryEmpty}
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {historyItems.map((item) => {
              const titleText = item.title || an.downlineHistoryUntitled;
              return (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2.5 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                        style={{
                          backgroundColor: item.enabled ? 'var(--success-soft)' : 'var(--bg-subtle)',
                          color: item.enabled ? 'var(--success)' : 'var(--ink-muted)',
                        }}
                      >
                        {item.enabled ? an.downlineHistoryStatusOn : an.downlineHistoryStatusOff}
                      </span>
                      <span className="font-semibold truncate">{titleText}</span>
                    </div>
                    <div
                      className="text-[10.5px] font-mono-num flex items-center gap-2 flex-wrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      <span>{item.sent_at}</span>
                      <span>·</span>
                      <span>{frequencyLabel(item.frequency)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewDownlinePopup({
                          title: titleText,
                          content: item.content || an.previewDownlineDefaultBody,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
                    >
                      <Eye className="w-3 h-3" />
                      {an.downlineHistoryPreviewBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsDraft((prev) => ({
                          ...prev,
                          downline_popup_enabled: item.enabled ? 'true' : 'false',
                          downline_popup_frequency: item.frequency || 'once_per_day',
                          downline_popup_title: item.title,
                          downline_popup_content: item.content,
                        }));
                        showToast(an.downlineHistoryAppliedToast);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                      style={{
                        borderColor: 'var(--accent)',
                        backgroundColor: 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                    >
                      <RotateCcw className="w-3 h-3" />
                      {an.downlineHistoryApplyBtn}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await openConfirm({
                          title: an.downlineHistoryDeleteTitle,
                          description: fmt(an.downlineHistoryDeleteDesc, { title: titleText }),
                          confirmLabel: an.downlineDeleteConfirmBtn,
                          tone: 'danger',
                        });
                        if (!ok) return;
                        await onDeletePopupHistory(item.id);
                        showToast(an.downlineHistoryDeletedToast);
                      }}
                      className="p-1.5 rounded-lg border cursor-pointer"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                      aria-label={an.downlineHistoryDeleteBtn}
                      title={an.downlineHistoryDeleteBtn}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
