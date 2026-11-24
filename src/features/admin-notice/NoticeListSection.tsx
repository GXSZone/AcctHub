/**
 * 站点顾客公告列表与发布分区
 */

import { Pencil, Pin, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { openConfirm } from '../../components/ConfirmDialog';
import { RichTextEditor } from '../../components/editor/RichTextEditor';
import { fmt } from '../../i18n';
import { useAdminNoticeI18n } from '../../i18n/namespaces/admin-notice';
import type { Announcement } from '../../types';

interface NoticeListSectionProps {
  siteLabel: string;
  announcements: Announcement[];
  onCreate: (payload: {
    title: string;
    content: string;
    level: string;
    audience: 'storefront';
    is_pinned: boolean;
  }) => Promise<void>;
  onUpdate: (
    id: number,
    payload: {
      title: string;
      content: string;
      level: string;
      audience: 'storefront';
      is_pinned: boolean;
    }
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function NoticeListSection({
  siteLabel,
  announcements,
  onCreate,
  onUpdate,
  onDelete,
  onReload,
  onStorefrontUpdated,
  showToast,
}: NoticeListSectionProps) {
  const an = useAdminNoticeI18n();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ title: '', content: '', level: 'highlight', is_pinned: true });
  const [newNotice, setNewNotice] = useState({ title: '', content: '', level: 'highlight', is_pinned: true });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-6 paper-card rounded-2xl p-6 space-y-3">
        <div
          className="flex items-center justify-between pb-2 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h2 className="font-editorial text-xl font-semibold">
            {fmt(an.listTitle, { siteLabel, count: announcements.length })}
          </h2>
          <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {fmt(an.listDesc, { siteLabel })}
          </span>
        </div>

        {announcements.length === 0 ? (
          <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
            {fmt(an.listEmpty, { siteLabel })}
          </p>
        ) : (
          announcements.map((a) => {
            const isEditing = editingId === a.id;
            const levelLabel =
              a.level === 'highlight'
                ? an.levelSuccess
                : a.level === 'warning'
                  ? an.levelWarning
                  : an.levelInfo;
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
                      minHeight={160}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <select
                          value={draft.level}
                          onChange={(e) => setDraft({ ...draft, level: e.target.value })}
                          className="acct-input py-1 px-2 text-xs w-28"
                        >
                          <option value="highlight">{an.levelSuccess}</option>
                          <option value="info">{an.levelInfo}</option>
                          <option value="warning">{an.levelWarning}</option>
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
                            await onUpdate(a.id, { ...draft, audience: 'storefront' });
                            setEditingId(null);
                            await onReload();
                            onStorefrontUpdated();
                            showToast(an.listUpdatedToast);
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
                          style={{
                            backgroundColor:
                              a.level === 'highlight'
                                ? 'var(--accent-soft)'
                                : a.level === 'warning'
                                  ? 'var(--warning-soft)'
                                  : 'var(--bg-subtle)',
                            color:
                              a.level === 'highlight'
                                ? 'var(--accent)'
                                : a.level === 'warning'
                                  ? 'var(--warning)'
                                  : 'var(--ink-secondary)',
                          }}
                        >
                          {levelLabel}
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
                        title={an.listEditTooltip}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await openConfirm({
                            title: an.listDeleteConfirmTitle,
                            description: fmt(an.listDeleteConfirmDesc, { title: a.title, siteLabel }),
                            confirmLabel: an.listDeleteConfirmBtn,
                            tone: 'danger',
                          });
                          if (!ok) return;
                          await onDelete(a.id);
                          await onReload();
                          onStorefrontUpdated();
                          showToast(an.listDeletedToast);
                        }}
                        className="p-1.5 rounded-lg cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                        title={an.listDeleteTooltip}
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

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onCreate({ ...newNotice, audience: 'storefront' });
          setNewNotice({ title: '', content: '', level: 'highlight', is_pinned: true });
          await onReload();
          onStorefrontUpdated();
          showToast(fmt(an.listPublishedToast, { siteLabel }));
        }}
        className="lg:col-span-6 paper-card rounded-2xl p-6 space-y-4"
      >
        <h2 className="font-editorial text-xl font-semibold">{fmt(an.listPublishTitle, { siteLabel })}</h2>
        <div>
          <div className="block text-xs font-semibold mb-1">{an.listFormTitleLabel}</div>
          <input
            required
            placeholder={an.listFormTitlePlaceholder}
            value={newNotice.title}
            onChange={(e) => setNewNotice((n) => ({ ...n, title: e.target.value }))}
            className="acct-input"
          />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="w-40">
            <div className="block text-xs font-semibold mb-1">{an.listFormLevelLabel}</div>
            <select
              value={newNotice.level}
              onChange={(e) => setNewNotice((n) => ({ ...n, level: e.target.value }))}
              className="acct-input py-2 text-xs"
            >
              <option value="highlight">{an.levelSuccess}</option>
              <option value="info">{an.levelInfo}</option>
              <option value="warning">{an.levelWarning}</option>
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={newNotice.is_pinned}
              onChange={(e) => setNewNotice((n) => ({ ...n, is_pinned: e.target.checked }))}
            />
            {an.listFormPinLabel}
          </label>
        </div>

        <div>
          <div className="block text-xs font-semibold mb-1.5">{an.listFormBodyLabel}</div>
          <RichTextEditor
            value={newNotice.content}
            onChange={(html) => setNewNotice((n) => ({ ...n, content: html }))}
            placeholder={an.listFormBodyPlaceholder}
            minHeight={200}
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {an.listPublishBtn}
        </button>
      </form>
    </div>
  );
}
