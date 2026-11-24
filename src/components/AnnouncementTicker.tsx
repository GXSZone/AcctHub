import { resolveLocalizedField } from '@shared/domain/i18n';
import { BellRing, ChevronDown, ChevronUp, Megaphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import type { Announcement } from '../types';

interface AnnouncementTickerProps {
  announcements: Announcement[];
  extraBannerText?: string;
  mode?: 'vertical' | 'marquee' | string;
  onOpenAll: () => void;
  onSelectAnnouncement?: (item: Announcement) => void;
  onOpenWelcomePopup?: () => void;
}

interface TickerEntry {
  id: string;
  title: string;
  level: string;
  announcement?: Announcement;
}

export function AnnouncementTicker({
  announcements,
  extraBannerText,
  mode = 'vertical',
  onOpenAll,
  onSelectAnnouncement,
  onOpenWelcomePopup,
}: AnnouncementTickerProps) {
  const { locale } = useI18n();
  const m = useCommonModalsI18n();
  const entries = useMemo<TickerEntry[]>(() => {
    const list: TickerEntry[] = [];
    const seen = new Set<string>();

    if (extraBannerText) {
      for (const line of extraBannerText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (!seen.has(line)) {
          seen.add(line);
          list.push({ id: `banner-${list.length}`, title: line, level: 'highlight' });
        }
      }
    }

    for (const a of announcements) {
      const text = resolveLocalizedField({
        locale,
        baseZh: a.title,
        legacyEn: a.title_en,
        translationsJson: a.translations_json,
        field: 'title',
      });
      if (text && !seen.has(text)) {
        seen.add(text);
        list.push({ id: `notice-${a.id}`, title: text, level: a.level, announcement: a });
      }
    }
    return list;
  }, [announcements, extraBannerText, locale]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (mode === 'marquee' || entries.length <= 1 || paused) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % entries.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [entries.length, mode, paused]);

  useEffect(() => {
    if (index >= entries.length) setIndex(0);
  }, [entries.length, index]);

  if (entries.length === 0) return null;

  const dotColor = (level: string) =>
    level === 'highlight' ? 'var(--accent)' : level === 'warning' ? 'var(--warning)' : 'var(--success)';

  const handleItemClick = (entry: TickerEntry) => {
    if (entry.announcement && onSelectAnnouncement) {
      onSelectAnnouncement(entry.announcement);
    } else {
      onOpenAll();
    }
  };

  return (
    <section
      aria-label={m.ntcTickerAria}
      className="mb-6 px-3.5 sm:px-4 py-2 rounded-2xl border flex items-center justify-between gap-3 text-xs"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-color)',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Left icon + Scrolling Body */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Megaphone className="w-3.5 h-3.5" />
        </span>

        {mode === 'marquee' ? (
          <div className="acct-marquee-wrap overflow-hidden flex-1 min-w-0 mask-fade">
            <div className="acct-marquee-track">
              {[...entries, ...entries].map((entry, idx) => (
                <button
                  key={`${entry.id}-${idx}`}
                  type="button"
                  onClick={() => handleItemClick(entry)}
                  className="inline-flex items-center gap-2 whitespace-nowrap cursor-pointer hover:underline underline-offset-4 bg-transparent border-0 p-0 text-xs"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor(entry.level) }}
                  />
                  <span>{entry.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="relative h-6 overflow-hidden flex-1 min-w-0">
            <div
              className="transition-transform duration-500 ease-out"
              style={{ transform: `translateY(-${index * 24}px)` }}
            >
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleItemClick(entry)}
                  className="h-6 w-full flex items-center gap-2 text-left cursor-pointer hover:underline underline-offset-4 bg-transparent border-0 p-0 text-xs"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor(entry.level) }}
                  />
                  <span className="truncate">{entry.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        {mode !== 'marquee' && entries.length > 1 && (
          <div
            className="hidden sm:inline-flex items-center gap-1 pr-2 border-r"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <span className="font-mono-num text-[10.5px] mr-0.5" style={{ color: 'var(--ink-muted)' }}>
              {index + 1}/{entries.length}
            </span>
            <button
              type="button"
              onClick={() => setIndex((prev) => (prev - 1 + entries.length) % entries.length)}
              className="w-5 h-5 rounded-md inline-flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
              aria-label={m.ntcPrevAria}
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setIndex((prev) => (prev + 1) % entries.length)}
              className="w-5 h-5 rounded-md inline-flex items-center justify-center cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
              aria-label={m.ntcNextAria}
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        )}

        {onOpenWelcomePopup && (
          <button
            type="button"
            onClick={onOpenWelcomePopup}
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-primary)' }}
          >
            <BellRing className="w-3 h-3" style={{ color: 'var(--accent)' }} />
            {m.ntcPopupBtn}
          </button>
        )}

        <button
          type="button"
          onClick={onOpenAll}
          className="font-medium underline underline-offset-4 cursor-pointer whitespace-nowrap"
          style={{ color: 'var(--accent)' }}
        >
          {m.ntcAllBtn}
        </button>
      </div>
    </section>
  );
}
