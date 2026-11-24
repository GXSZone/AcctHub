/**
 * 富文本编辑器顶部工具栏与视图模式切换器
 */

import {
  AlertTriangle,
  Bold,
  Code,
  Code2,
  Eye,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  PencilLine,
  Quote,
  Sparkles,
  Table,
  Underline,
  Upload,
} from 'lucide-react';
import type React from 'react';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';

export type EditorMode = 'visual' | 'source' | 'preview';

interface RichTextToolbarProps {
  mode: EditorMode;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onExec: (cmd: string, arg?: string) => void;
  onInsertHtml: (html: string) => void;
  onFilePick: (files: FileList | null) => void;
  onToggleImageModal: () => void;
  onToggleLinkModal: () => void;
  onModeChange: (mode: EditorMode) => void;
}

const TOOL_BTN_CLASS =
  'p-1.5 rounded-lg cursor-pointer transition-colors inline-flex items-center justify-center hover:opacity-90';

export function RichTextToolbar({
  mode,
  uploading,
  fileInputRef,
  onExec,
  onInsertHtml,
  onFilePick,
  onToggleImageModal,
  onToggleLinkModal,
  onModeChange,
}: RichTextToolbarProps) {
  const ui = useUiKitI18n();

  return (
    <div
      className="px-3 py-2 border-b flex flex-wrap items-center justify-between gap-2"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex flex-wrap items-center gap-0.5">
        <button
          type="button"
          onClick={() => onExec('formatBlock', 'H2')}
          className={TOOL_BTN_CLASS}
          title={ui.toolH2}
        >
          <Heading2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onExec('formatBlock', 'H3')}
          className={TOOL_BTN_CLASS}
          title={ui.toolH3}
        >
          <Heading3 className="w-4 h-4" />
        </button>

        <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        <button type="button" onClick={() => onExec('bold')} className={TOOL_BTN_CLASS} title={ui.toolBold}>
          <Bold className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onExec('italic')}
          className={TOOL_BTN_CLASS}
          title={ui.toolItalic}
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onExec('underline')}
          className={TOOL_BTN_CLASS}
          title={ui.toolUnderline}
        >
          <Underline className="w-4 h-4" />
        </button>

        <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        <button
          type="button"
          onClick={() => onExec('insertUnorderedList')}
          className={TOOL_BTN_CLASS}
          title={ui.toolUl}
        >
          <List className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onExec('insertOrderedList')}
          className={TOOL_BTN_CLASS}
          title={ui.toolOl}
        >
          <ListOrdered className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onExec('formatBlock', 'BLOCKQUOTE')}
          className={TOOL_BTN_CLASS}
          title={ui.toolQuote}
        >
          <Quote className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() =>
            onInsertHtml(
              '<pre><code>BASE_URL=https://api.accthub.edge/v1\nAPI_KEY=sk-accthub-live-...</code></pre><p><br /></p>'
            )
          }
          className={TOOL_BTN_CLASS}
          title={ui.toolCode}
        >
          <Code className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onInsertHtml('<hr /><p><br /></p>')}
          className={TOOL_BTN_CLASS}
          title={ui.toolHr}
        >
          <Minus className="w-4 h-4" />
        </button>

        <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => onFilePick(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          title={ui.toolUploadTip}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>{uploading ? ui.toolUploading : ui.toolUpload}</span>
        </button>

        <button type="button" onClick={onToggleImageModal} className={TOOL_BTN_CLASS} title={ui.toolExtImg}>
          <ImagePlus className="w-4 h-4" />
        </button>

        <button type="button" onClick={onToggleLinkModal} className={TOOL_BTN_CLASS} title={ui.toolLink}>
          <Link2 className="w-4 h-4" />
        </button>

        <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-color)' }} />

        <button
          type="button"
          onClick={() => onInsertHtml(ui.tplTipCardHtml)}
          className={TOOL_BTN_CLASS}
          style={{ color: 'var(--success)' }}
          title={ui.toolTipCard}
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onInsertHtml(ui.tplWarnCardHtml)}
          className={TOOL_BTN_CLASS}
          style={{ color: 'var(--warning)' }}
          title={ui.toolWarnCard}
        >
          <AlertTriangle className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onInsertHtml(ui.tplTableCardHtml)}
          className={TOOL_BTN_CLASS}
          title={ui.toolTableCard}
        >
          <Table className="w-4 h-4" />
        </button>
      </div>

      <div
        className="inline-flex rounded-full border p-0.5 text-[11px]"
        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
      >
        {(
          [
            ['visual', ui.modeVisual, PencilLine],
            ['preview', ui.modePreview, Eye],
            ['source', ui.modeSource, Code2],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-medium cursor-pointer"
            style={{
              backgroundColor: mode === m ? 'var(--accent)' : 'transparent',
              color: mode === m ? '#FAF9F5' : 'var(--ink-secondary)',
            }}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
