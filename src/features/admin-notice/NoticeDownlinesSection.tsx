/**
 * 直属下级代理专属消息发布与已发消息管理分区
 */

import { Pencil, Pin, Sparkles, Trash2 } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { openConfirm } from '../../components/ConfirmDialog';
import { RichTextEditor } from '../../components/editor/RichTextEditor';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';
import type { Announcement } from '../../types';
import { NoticeDownlinesPopupCard } from './NoticeDownlinesPopupCard';

interface NoticeDownlinesSectionProps {
  downlinePopupEnabled: boolean;
  settingsDraft: Record<string, string>;
  setSettingsDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  announcements: Announcement[];
  onSaveSettings: (draft: Record<string, string>, toastMsg: string) => Promise<void>;
  onPreviewDownlinePopup: (override?: { title: string; content: string }) => void;
  onDeletePopupHistory: (historyId: string) => Promise<void>;
  onCreate: (payload: {
    title: string;
    content: string;
    level: string;
    audience: 'direct_downlines';
    is_pinned: boolean;
  }) => Promise<void>;
  onUpdate: (
    id: number,
    payload: {
      title: string;
      content: string;
      level: string;
      audience: 'direct_downlines';
      is_pinned: boolean;
    }
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function NoticeDownlinesSection({
  downlinePopupEnabled,
  settingsDraft,
  setSettingsDraft,
  announcements,
  onSaveSettings,
  onPreviewDownlinePopup,
  onDeletePopupHistory,
  onCreate,
  onUpdate,
  onDelete,
  onReload,
  showToast,
}: NoticeDownlinesSectionProps) {
  const an = useAdminNoticeI18n();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ title: '', content: '', level: 'highlight', is_pinned: true });
  const [newNotice, setNewNotice] = useState({ title: '', content: '', level: 'highlight', is_pinned: true });

  return (
    <div className="space-y-6">
      <NoticeDownlinesPopupCard
        downlinePopupEnabled={downlinePopupEnabled}
        settingsDraft={settingsDraft}
        setSettingsDraft={setSettingsDraft}
        onSaveSettings={onSaveSettings}
        onPreviewDownlinePopup={onPreviewDownlinePopup}
        onDeletePopupHistory={onDeletePopupHistory}
        showToast={showToast}
      />

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onCreate({ ...newNotice, audience: 'direct_downlines' });
          setNewNotice({ title: '', content: '', level: 'highlight', is_pinned: true });
          await onReload();
          showToast(an.downlinePublishedToast);
        }}
        className="paper-card rounded-2xl p-6 space-y-4"
      >
        <div
          className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <h2 className="font-editorial text-xl font-semibold">{an.downlinePublishTitle}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {an.downlinePublishBadge}
            </p>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {an.downlinePublishBtn}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-6">
            <div className="block text-xs font-semibold mb-1">{an.downlineFormTitleLabel}</div>
            <input
              required
              placeholder={an.downlineFormTitlePlaceholder}
              value={newNotice.title}
              onChange={(e) => setNewNotice((n) => ({ ...n, title: e.target.value }))}
              className="acct-input"
            />
          </div>

          <div className="md:col-span-3">
            <div className="block text-xs font-semibold mb-1">{an.downlineFormLevelLabel}</div>
            <select
              value={newNotice.level}
              onChange={(e) => setNewNotice((n) => ({ ...n, level: e.target.value }))}
              className="acct-input py-2 text-xs"
            >
              <option value="highlight">{an.downlineLevelSuccess}</option>
              <option value="info">{an.downlineLevelInfo}</option>
              <option value="warning">{an.downlineLevelWarning}</option>
            </select>
          </div>

          <div className="md:col-span-3 pb-2">
            <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={newNotice.is_pinned}
                onChange={(e) => setNewNotice((n) => ({ ...n, is_pinned: e.target.checked }))}
              />
              {an.downlineFormPinLabel}
            </label>
          </div>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1.5">{an.downlineFormBodyLabel}</div>
          <RichTextEditor
            value={newNotice.content}
            onChange={(html) => setNewNotice((n) => ({ ...n, content: html }))}
            placeholder={an.downlineFormBodyPlaceholder}
            minHeight={180}
          />
        </div>
      </form>

      <div className="paper-card rounded-2xl p-6 space-y-3">
        <div
          className="flex items-center justify-between pb-2 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h2 className="font-editorial text-xl font-semibold">
            {fmt(an.downlineListTitle, { count: announcements.length })}
          </h2>
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {an.downlineListSub}
          </span>
        </div>

        {announcements.length === 0 ? (
          <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
            {an.downlineListEmpty}
          </p>
        ) : (
          announcements.map((a) => {
            const isEditing = editingId === a.id;
            const levelLabel =
              a.level === 'highlight'
                ? an.downlineLevelSuccess
                : a.level === 'warning'
                  ? an.downlineLevelWarning
                  : an.downlineLevelInfo;
            return (
              <div
                key={a.id}
                className="p-4 rounded-xl border space-y-2.5"
                style={{
                  borderColor: isEditing ? 'var(--accent)' : 'var(--border-color)',
                  backgroundColor: 'var(--bg-canvas)',
                }}
              >
                {isEditing ? (
                  <>
                    <input
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="acct-input text-xs"
                    />
                    <RichTextEditor
                      value={draft.content}
                      onChange={(html) => setDraft({ ...draft, content: html })}
                      minHeight={140}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <select
                          value={draft.level}
                          onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                          className="acct-input py-1 px-2 text-xs w-28"
                        >
                          <option value="highlight">{an.downlineLevelSuccess}</option>
                          <option value="info">{an.downlineLevelInfo}</option>
                          <option value="warning">{an.downlineLevelWarning}</option>
                        </select>
                        <label className="inline-flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={draft.is_pinned}
                            onChange={(e) => setDraft({ ...draft, is_pinned: e.target.checked })}
                          />
                          {an.pinnedLabel}
                        </label>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 rounded-lg border text-xs cursor-pointer"
                          style={{ borderColor: 'var(--border-color)' }}
                        >
                          {an.cancelBtn}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await onUpdate(a.id, { ...draft, audience: 'direct_downlines' });
                            setEditingId(null);
                            await onReload();
                            showToast(an.downlineUpdatedToast);
                          }}
                          className="px-3 py-1 rounded-lg text-xs font-medium cursor-pointer"
                          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                        >
                          {an.saveBtn}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <span
                          className="text-[10.5px] px-2 py-0.5 rounded-md font-medium"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {fmt(an.downlineTagPrefix, { level: levelLabel })}
                        </span>
                        {a.is_pinned ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[10.5px]"
                            style={{ color: 'var(--accent)' }}
                          >
                            <Pin className="w-3 h-3" /> {an.pinnedLabel}
                          </span>
                        ) : null}
                        <span className="text-[10.5px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                          {a.created_at?.slice(0, 10)}
                        </span>
                      </div>
                      <div className="text-xs font-semibold">{a.title}</div>
                      <p
                        className="text-xs mt-1 leading-relaxed line-clamp-2"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {a.content
                          .replace(/<[^>]+>/g, ' ')
                          .replace(/\s+/g, ' ')
                          .trim()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(a.id);
                          setDraft({
                            title: a.title,
                            content: a.content,
                            level: a.level,
                            is_pinned: Boolean(a.is_pinned),
                          });
                        }}
                        className="p-1.5 rounded-lg cursor-pointer"
                        style={{ color: 'var(--accent)' }}
                        title={an.downlineEditTooltip}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await openConfirm({
                            title: an.downlineDeleteConfirmTitle,
                            description: fmt(an.downlineDeleteConfirmDesc, { title: a.title }),
                            confirmLabel: an.downlineDeleteConfirmBtn,
                            tone: 'danger',
                          });
                          if (!ok) return;
                          await onDelete(a.id);
                          await onReload();
                          showToast(an.downlineDeletedToast);
                        }}
                        className="p-1.5 rounded-lg cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                        title={an.downlineDeleteTooltip}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
