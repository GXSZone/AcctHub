/**
 * 富文本编辑器主组件（支持可视化编辑、粘贴截图压缩、外链插入、源码与前台预览）
 */

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { fmt } from '../../i18n';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';
import { normalizeRichContent, safeSetHTML } from '../../lib/sanitizeHtml';
import { RichContentRenderer } from '../RichContentRenderer';
import { RichTextMediaBars } from './RichTextMediaBars';
import { type EditorMode, RichTextToolbar } from './RichTextToolbar';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

async function compressImageFile(
  file: File,
  errMsgs: { read: string; decode: string },
  maxWidth = 1080
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(errMsgs.read));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(errMsgs.decode));
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.82);
        resolve(dataUrl.startsWith('data:image/webp') ? dataUrl : canvas.toDataURL('image/jpeg', 0.84));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function RichTextEditor({ value, onChange, placeholder, minHeight = 260 }: RichTextEditorProps) {
  const ui = useUiKitI18n();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastHtmlRef = useRef<string>('');
  const mountedElRef = useRef<HTMLDivElement | null>(null);

  const [mode, setMode] = useState<EditorMode>('visual');
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 切换商品、返回可视化模式或重新挂载画布时安全同步内容
  useEffect(() => {
    if (mode !== 'visual') {
      mountedElRef.current = null;
      return;
    }
    const el = editorRef.current;
    if (!el) return;
    const normalized = normalizeRichContent(value);
    const isFreshMount = mountedElRef.current !== el;
    if (isFreshMount || (normalized !== lastHtmlRef.current && el.innerHTML !== normalized)) {
      if (el.innerHTML !== normalized) {
        void safeSetHTML(el, normalized);
      }
      lastHtmlRef.current = normalized;
      mountedElRef.current = el;
    }
  }, [value, mode]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    lastHtmlRef.current = html;
    onChange(html);
  };

  const exec = (cmd: string, arg?: string) => {
    if (mode !== 'visual') setMode('visual');
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    emitChange();
  };

  const insertHtmlBlock = (html: string) => {
    if (mode !== 'visual') {
      onChange(`${value}\n${html}`);
      return;
    }
    editorRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    emitChange();
  };

  const handleFilePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await compressImageFile(file, {
          read: ui.editorErrReadImg,
          decode: ui.editorErrDecodeImg,
        });
        const safeName = file.name.replace(/[<>"']/g, '');
        insertHtmlBlock(
          `<figure class="acct-figure"><img src="${dataUrl}" alt="${safeName}" /><figcaption>${safeName}</figcaption></figure><p><br /></p>`
        );
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file = imgItem.getAsFile();
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await compressImageFile(file, {
        read: ui.editorErrReadImg,
        decode: ui.editorErrDecodeImg,
      });
      insertHtmlBlock(
        `<figure class="acct-figure"><img src="${dataUrl}" alt="${ui.editorPastedImgAlt}" /><figcaption>${ui.editorPastedCaption}</figcaption></figure><p><br /></p>`
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      await handleFilePick(files);
    }
  };

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
    >
      <RichTextToolbar
        mode={mode}
        uploading={uploading}
        fileInputRef={fileInputRef}
        onExec={exec}
        onInsertHtml={insertHtmlBlock}
        onFilePick={(files) => void handleFilePick(files)}
        onToggleImageModal={() => {
          setLinkModalOpen(false);
          setImageModalOpen((o) => !o);
        }}
        onToggleLinkModal={() => {
          setImageModalOpen(false);
          setLinkModalOpen((o) => !o);
        }}
        onModeChange={setMode}
      />

      <RichTextMediaBars
        imageModalOpen={imageModalOpen}
        linkModalOpen={linkModalOpen}
        onInsertHtml={insertHtmlBlock}
        onCloseImage={() => setImageModalOpen(false)}
        onCloseLink={() => setLinkModalOpen(false)}
      />

      {mode === 'visual' && (
        <div className="relative">
          {/* biome-ignore lint/a11y/useSemanticElements: contentEditable 富文本画布必须使用 div 渲染 HTML 排版 */}
          <div
            ref={editorRef}
            role="textbox"
            aria-multiline="true"
            aria-label={ui.editorAriaLabel}
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            onInput={emitChange}
            onPaste={(e) => void handlePaste(e)}
            onDrop={(e) => void handleDrop(e)}
            data-placeholder={placeholder || ui.editorDefaultPh}
            className="acct-prose acct-editor-canvas p-5 outline-none overflow-y-auto"
            style={{ minHeight }}
          />
        </div>
      )}

      {mode === 'preview' && (
        <div className="p-5 overflow-y-auto" style={{ minHeight, backgroundColor: 'var(--bg-canvas)' }}>
          {value.trim() ? (
            <RichContentRenderer content={value} />
          ) : (
            <p className="text-xs italic" style={{ color: 'var(--ink-muted)' }}>
              {ui.editorEmptyPreview}
            </p>
          )}
        </div>
      )}

      {mode === 'source' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full p-4 bg-transparent border-0 outline-none font-mono-num text-xs leading-relaxed resize-y"
          style={{ minHeight, color: 'var(--ink-primary)' }}
          placeholder={ui.editorSourcePh}
        />
      )}

      <div
        className="px-4 py-1.5 border-t text-[11px] flex items-center justify-between"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--ink-muted)',
        }}
      >
        <span>{ui.editorPasteTip}</span>
        <span className="font-mono-num">{fmt(ui.editorCharCount, { count: value.length })}</span>
      </div>
    </div>
  );
}
