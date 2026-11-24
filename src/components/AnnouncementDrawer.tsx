import { resolveLocalizedField } from '@shared/domain/i18n';
import { Bell, Pin, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';
import type { Announcement } from '../types';
import { RichContentRenderer } from './RichContentRenderer';

interface AnnouncementDrawerProps {
  open: boolean;
  onClose: () => void;
  announcements: Announcement[];
}

export function AnnouncementDrawer({ open, onClose, announcements }: AnnouncementDrawerProps) {
  const { locale } = useI18n();
  const m = useCommonModalsI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="notice-drawer-title"
      className="acct-dialog acct-drawer"
    >
      <div className="h-full flex flex-col">
        <div
          className="p-5 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 id="notice-drawer-title" className="font-editorial text-xl font-semibold">
              {m.ntcDrawerTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={m.ntcCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          {announcements.map((a) => {
            const badgeBg =
              a.level === 'highlight'
                ? 'var(--accent-soft)'
                : a.level === 'warning'
                  ? 'var(--warning-soft)'
                  : 'var(--bg-subtle)';
            const badgeColor =
              a.level === 'highlight'
                ? 'var(--accent)'
                : a.level === 'warning'
                  ? 'var(--warning)'
                  : 'var(--ink-secondary)';

            return (
              <article
                key={a.id}
                className="p-4 rounded-2xl border"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-md inline-flex items-center gap-1"
                      style={{ backgroundColor: badgeBg, color: badgeColor }}
                    >
                      {a.is_pinned ? <Pin className="w-3 h-3" /> : null}
                      {a.level === 'highlight'
                        ? m.ntcLevelHighlight
                        : a.level === 'warning'
                          ? m.ntcLevelWarning
                          : m.ntcLevelInfo}
                    </span>
                    {a.audience === 'direct_downlines' && (
                      <span
                        className="text-[11px] font-semibold px-2 py-0.5 rounded-md inline-flex items-center"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {m.ntcDownlineBadge}
                      </span>
                    )}
                  </div>
                  <time className="text-[11px] font-mono-num shrink-0" style={{ color: 'var(--ink-muted)' }}>
                    {a.created_at?.slice(0, 10)}
                  </time>
                </div>
                <h3 className="font-semibold text-sm leading-snug">
                  {resolveLocalizedField({
                    locale,
                    baseZh: a.title,
                    legacyEn: a.title_en,
                    translationsJson: a.translations_json,
                    field: 'title',
                  })}
                </h3>
                <div className="mt-2 text-xs">
                  <RichContentRenderer
                    content={resolveLocalizedField({
                      locale,
                      baseZh: a.content,
                      legacyEn: a.content_en,
                      translationsJson: a.translations_json,
                      field: 'content',
                    })}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}
