import { ExternalLink, MessageCircle, X, ZoomIn } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { parseSupportLinks, parseSupportMedia } from './SupportConfigEditor';

export function FloatingSupport({
  label,
  url,
  note,
  mediaJson,
  linksJson,
}: {
  label?: string;
  url?: string;
  note?: string;
  mediaJson?: string;
  linksJson?: string;
}) {
  const t = useCommonModalsI18n();
  const [expanded, setExpanded] = useState(false);
  const [zoomedImg, setZoomedImg] = useState<{ title: string; url: string } | null>(null);

  const mediaList = useMemo(() => parseSupportMedia(mediaJson), [mediaJson]);
  const extraLinks = useMemo(() => parseSupportLinks(linksJson), [linksJson]);

  const allLinks = useMemo(() => {
    const out: Array<{ label: string; url: string }> = [];
    const primaryUrl = (url || '').trim();
    if (primaryUrl && /^https?:\/\//i.test(primaryUrl)) {
      out.push({ label: t.supPrimaryLink, url: primaryUrl });
    }
    for (const lk of extraLinks) {
      if (!out.some((x) => x.url === lk.url)) {
        out.push(lk);
      }
    }
    if (out.length === 0 && mediaList.length === 0) {
      out.push({ label: t.supFallbackLink, url: 'https://t.me/accthub_concierge' });
    }
    return out;
  }, [url, extraLinks, mediaList.length, t.supFallbackLink, t.supPrimaryLink]);

  return (
    <>
      <div className="fixed bottom-5 right-5 z-20 flex flex-col items-end gap-2">
        {expanded && (
          <div
            className="w-80 max-w-[calc(100vw-2.5rem)] rounded-2xl p-4 paper-card space-y-3 max-h-[75vh] overflow-y-auto"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-editorial text-base font-semibold">{label || t.supDefaultLabel}</span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="w-6 h-6 rounded-full inline-flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                aria-label={t.supCollapseAria}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {note || t.supDefaultNote}
            </p>

            {/* Multiple QR / Support Images */}
            {mediaList.length > 0 && (
              <div className={`grid gap-2.5 ${mediaList.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {mediaList.map((m, idx) => (
                  <button
                    key={`${idx}-${m.url.slice(0, 24)}`}
                    type="button"
                    onClick={() => setZoomedImg(m)}
                    className="group p-2 rounded-xl border text-center space-y-1.5 cursor-pointer transition-colors"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                    title={t.supZoomHint}
                  >
                    <div
                      className={`relative rounded-lg overflow-hidden bg-white flex items-center justify-center mx-auto ${
                        mediaList.length === 1 ? 'w-44 h-44' : 'aspect-square w-full'
                      }`}
                    >
                      <img
                        src={m.url}
                        alt={m.title || t.supImgAlt}
                        className="w-full h-full object-contain p-1"
                      />
                      <span
                        className="absolute right-1.5 bottom-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                      >
                        <ZoomIn className="w-3 h-3" />
                      </span>
                    </div>
                    {m.title && (
                      <div
                        className="text-[11px] font-medium truncate"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {m.title}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* One or more contact links */}
            {allLinks.length > 0 && (
              <div className="space-y-1.5">
                {allLinks.map((lk, idx) => (
                  <a
                    key={`${idx}-${lk.url}`}
                    href={lk.url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 px-3 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-1.5 no-underline border"
                    style={
                      idx === 0
                        ? { backgroundColor: 'var(--accent)', borderColor: 'transparent', color: '#FAF9F5' }
                        : {
                            backgroundColor: 'var(--bg-canvas)',
                            borderColor: 'var(--border-strong)',
                            color: 'var(--ink-primary)',
                          }
                    }
                  >
                    <span className="truncate">{lk.label}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-medium shadow-lg cursor-pointer transition-transform hover:scale-[1.02]"
          style={{
            backgroundColor: 'var(--ink-primary)',
            color: 'var(--bg-canvas)',
          }}
        >
          <MessageCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span>{label || t.supDefaultLabel}</span>
        </button>
      </div>

      {/* Fullscreen Lightbox for Zooming QR / Support Image */}
      {zoomedImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={zoomedImg.title || t.supModalDefaultTitle}
        >
          <button
            type="button"
            aria-label={t.supModalCloseAria}
            className="fixed inset-0 border-0 cursor-default"
            style={{ backgroundColor: 'rgba(18, 17, 16, 0.72)' }}
            onClick={() => setZoomedImg(null)}
          />
          <div className="relative z-10 paper-card rounded-2xl p-5 max-w-sm w-full text-center space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-editorial text-base font-semibold truncate">
                {zoomedImg.title || t.supModalDefaultTitle}
              </span>
              <button
                type="button"
                onClick={() => setZoomedImg(null)}
                className="w-7 h-7 rounded-full inline-flex items-center justify-center cursor-pointer"
                style={{ backgroundColor: 'var(--bg-subtle)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={zoomedImg.url}
              alt={zoomedImg.title || t.supImgAlt}
              className="w-full max-h-[65vh] object-contain rounded-xl bg-white p-2 border"
              style={{ borderColor: 'var(--border-color)' }}
            />
          </div>
        </div>
      )}
    </>
  );
}
