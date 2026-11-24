/**
 * 富文本编辑器内联插图与外链插入工具条
 */

import { useState } from 'react';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';

interface RichTextMediaBarsProps {
  imageModalOpen: boolean;
  linkModalOpen: boolean;
  onInsertHtml: (html: string) => void;
  onCloseImage: () => void;
  onCloseLink: () => void;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function RichTextMediaBars({
  imageModalOpen,
  linkModalOpen,
  onInsertHtml,
  onCloseImage,
  onCloseLink,
}: RichTextMediaBarsProps) {
  const ui = useUiKitI18n();
  const [imgUrl, setImgUrl] = useState('');
  const [imgCaption, setImgCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');

  return (
    <>
      {imageModalOpen && (
        <div
          className="px-4 py-3 border-b flex flex-wrap items-center gap-2 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <input
            type="url"
            value={imgUrl}
            onChange={(e) => setImgUrl(e.target.value)}
            placeholder={ui.editorImgUrlPh}
            className="acct-input py-1.5 text-xs flex-1 min-w-[200px]"
          />
          <input
            type="text"
            value={imgCaption}
            onChange={(e) => setImgCaption(e.target.value)}
            placeholder={ui.editorImgCaptionPh}
            className="acct-input py-1.5 text-xs w-44"
          />
          <button
            type="button"
            onClick={() => {
              const rawSrc = imgUrl.trim();
              if (!rawSrc || !/^https?:\/\/|^\/|^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(rawSrc)) {
                return;
              }
              const safeSrc = rawSrc.replace(/"/g, '&quot;');
              const safeCap = escapeHtml(imgCaption.trim());
              onInsertHtml(
                `<figure class="acct-figure"><img src="${safeSrc}" alt="${safeCap || ui.editorFallbackImgAlt}" />${
                  safeCap ? `<figcaption>${safeCap}</figcaption>` : ''
                }</figure><p><br /></p>`
              );
              setImgUrl('');
              setImgCaption('');
              onCloseImage();
            }}
            className="px-3 py-1.5 rounded-lg font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {ui.editorInsertImgBtn}
          </button>
        </div>
      )}

      {linkModalOpen && (
        <div
          className="px-4 py-3 border-b flex flex-wrap items-center gap-2 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-subtle)' }}
        >
          <input
            type="text"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            placeholder={ui.editorLinkTextPh}
            className="acct-input py-1.5 text-xs w-52"
          />
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder={ui.editorLinkUrlPh}
            className="acct-input py-1.5 text-xs flex-1 min-w-[200px]"
          />
          <button
            type="button"
            onClick={() => {
              const rawHref = linkUrl.trim();
              if (!rawHref || !/^https?:\/\/|^\//i.test(rawHref)) return;
              const safeHref = rawHref.replace(/"/g, '&quot;');
              const safeText = escapeHtml(linkText.trim() || rawHref);
              onInsertHtml(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`);
              setLinkUrl('');
              setLinkText('');
              onCloseLink();
            }}
            className="px-3 py-1.5 rounded-lg font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {ui.editorInsertLinkBtn}
          </button>
        </div>
      )}
    </>
  );
}
