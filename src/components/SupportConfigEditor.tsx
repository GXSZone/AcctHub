import { Image as ImageIcon, Link2, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useUiKitI18n } from '../i18n/namespaces/ui-kit';
import type { SupportLinkItem, SupportMediaItem } from '../types';

export function parseSupportMedia(raw?: string | null): SupportMediaItem[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        const item = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        return { title: String(item.title || ''), url: String(item.url || '').trim() };
      })
      .filter(
        (x) =>
          x.url &&
          (/^https?:\/\//i.test(x.url) || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(x.url))
      );
  } catch {
    return [];
  }
}

export function parseSupportLinks(raw?: string | null, defaultLabel = 'Contact Support'): SupportLinkItem[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => {
        const item = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
        return {
          label: String(item.label || '').trim() || defaultLabel,
          url: String(item.url || '').trim(),
        };
      })
      .filter((x) => x.url && /^https?:\/\//i.test(x.url));
  } catch {
    return [];
  }
}

async function compressImageToDataUrl(
  file: File,
  errMsgs: { read: string; parse: string; canvas: string },
  maxDim = 560,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(errMsgs.read));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(errMsgs.parse));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error(errMsgs.canvas));
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL('image/webp', quality);
        resolve(out.startsWith('data:image/webp') ? out : canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

interface SupportConfigEditorProps {
  mediaJson: string;
  linksJson: string;
  onChangeMediaJson: (nextJson: string) => void;
  onChangeLinksJson: (nextJson: string) => void;
}

export function SupportConfigEditor({
  mediaJson,
  linksJson,
  onChangeMediaJson,
  onChangeLinksJson,
}: SupportConfigEditorProps) {
  const ui = useUiKitI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaList = parseSupportMedia(mediaJson);
  const linkList = parseSupportLinks(linksJson, ui.supportFallbackContact);

  const [imgUrlInput, setImgUrlInput] = useState('');
  const [imgTitleInput, setImgTitleInput] = useState('');
  const [uploading, setUploading] = useState(false);

  const [linkLabelInput, setLinkLabelInput] = useState('');
  const [linkUrlInput, setLinkUrlInput] = useState('');
  const [tipError, setTipError] = useState('');

  const updateMedia = (next: SupportMediaItem[]) => {
    onChangeMediaJson(JSON.stringify(next.slice(0, 8)));
  };

  const updateLinks = (next: SupportLinkItem[]) => {
    onChangeLinksJson(JSON.stringify(next.slice(0, 8)));
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setTipError('');
    try {
      const additions: SupportMediaItem[] = [];
      for (const file of Array.from(files)) {
        if (mediaList.length + additions.length >= 8) break;
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await compressImageToDataUrl(file, {
          read: ui.supportErrReadImg,
          parse: ui.supportErrParseImg,
          canvas: ui.supportErrCanvas,
        });
        const defaultTitle = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || ui.supportFallbackQrTitle;
        additions.push({ title: defaultTitle, url: dataUrl });
      }
      if (additions.length > 0) {
        updateMedia([...mediaList, ...additions]);
      }
    } catch (err) {
      setTipError(err instanceof Error ? err.message : ui.supportErrProcessImg);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleAddImageUrl = () => {
    const url = imgUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setTipError(ui.supportErrImgUrlPrefix);
      return;
    }
    setTipError('');
    updateMedia([...mediaList, { title: imgTitleInput.trim() || ui.supportFallbackScanTitle, url }]);
    setImgUrlInput('');
    setImgTitleInput('');
  };

  const handleAddLink = () => {
    const url = linkUrlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      setTipError(ui.supportErrLinkUrlPrefix);
      return;
    }
    setTipError('');
    updateLinks([...linkList, { label: linkLabelInput.trim() || ui.supportFallbackOnline, url }]);
    setLinkLabelInput('');
    setLinkUrlInput('');
  };

  return (
    <div className="space-y-4 pt-2">
      {tipError && (
        <div
          className="p-2.5 rounded-xl text-[11px]"
          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          {tipError}
        </div>
      )}

      {/* Multi-Image QR / Media Uploader + Image URL */}
      <div
        className="p-3.5 rounded-xl border space-y-3"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <ImageIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            {ui.supportQrSectionTitle}
          </div>
          <div className="shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void handleFilesSelected(e.target.files)}
            />
            <button
              type="button"
              disabled={uploading || mediaList.length >= 8}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-opacity hover:opacity-90 disabled:opacity-45"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? ui.supportUploadingBtn : ui.supportUploadBtn}
            </button>
          </div>
        </div>

        {/* Add image by link */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            value={imgTitleInput}
            onChange={(e) => setImgTitleInput(e.target.value)}
            placeholder={ui.supportImgTitlePh}
            className="acct-input h-9 text-xs sm:w-40 sm:shrink-0"
          />
          <input
            type="url"
            value={imgUrlInput}
            onChange={(e) => setImgUrlInput(e.target.value)}
            placeholder={ui.supportImgUrlPh}
            className="acct-input h-9 text-xs font-mono-num flex-1 min-w-0"
          />
          <button
            type="button"
            disabled={!imgUrlInput.trim() || mediaList.length >= 8}
            onClick={handleAddImageUrl}
            className="h-9 px-3.5 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--ink-primary)] hover:enabled:border-[var(--accent)] hover:enabled:text-[var(--accent)] hover:enabled:bg-[var(--accent-soft)] disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            {ui.supportAddImgBtn}
          </button>
        </div>

        {/* Preview Grid */}
        {mediaList.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
            {mediaList.map((m, idx) => (
              <div
                key={`${idx}-${m.url.slice(0, 24)}`}
                className="p-2 rounded-xl border space-y-1.5 relative group"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div
                  className="aspect-square rounded-lg overflow-hidden bg-white border flex items-center justify-center"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <img
                    src={m.url}
                    alt={m.title || ui.supportFallbackImgAlt}
                    className="w-full h-full object-contain"
                  />
                </div>
                <input
                  type="text"
                  value={m.title}
                  onChange={(e) => {
                    const next = [...mediaList];
                    next[idx] = { ...m, title: e.target.value };
                    updateMedia(next);
                  }}
                  placeholder={ui.supportImgCaptionPh}
                  className="acct-input h-7 px-2 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => updateMedia(mediaList.filter((_, i) => i !== idx))}
                  className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer shadow"
                  style={{ backgroundColor: 'var(--danger)', color: '#FAF9F5' }}
                  title={ui.supportRemoveImgTooltip}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Multiple Custom Support Links */}
      <div
        className="p-3.5 rounded-xl border space-y-2.5"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
      >
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Link2 className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
          {ui.supportLinksSectionTitle}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            value={linkLabelInput}
            onChange={(e) => setLinkLabelInput(e.target.value)}
            placeholder={ui.supportLinkLabelPh}
            className="acct-input h-9 text-xs sm:w-40 sm:shrink-0"
          />
          <input
            type="url"
            value={linkUrlInput}
            onChange={(e) => setLinkUrlInput(e.target.value)}
            placeholder="https://t.me/..."
            className="acct-input h-9 text-xs font-mono-num flex-1 min-w-0"
          />
          <button
            type="button"
            disabled={!linkUrlInput.trim() || linkList.length >= 8}
            onClick={handleAddLink}
            className="h-9 px-3.5 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--ink-primary)] hover:enabled:border-[var(--accent)] hover:enabled:text-[var(--accent)] hover:enabled:bg-[var(--accent-soft)] disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            {ui.supportAddLinkBtn}
          </button>
        </div>

        {linkList.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {linkList.map((lk, idx) => (
              <div
                key={`${idx}-${lk.url}`}
                className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border text-xs"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-semibold shrink-0">{lk.label}</span>
                  <span className="font-mono-num text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                    {lk.url}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => updateLinks(linkList.filter((_, i) => i !== idx))}
                  className="p-1 rounded cursor-pointer shrink-0"
                  style={{ color: 'var(--danger)' }}
                  title={ui.supportDeleteLinkTooltip}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
