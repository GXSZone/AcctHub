/**
 * 商品编辑器顶部标题栏（AI 优化入口、编辑/整页预览切换与关闭按钮）
 */

import { ExternalLink, Eye, FileEdit, Sparkles, X } from 'lucide-react';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';

interface ProductEditorHeaderProps {
  productId: number | null;
  title: string;
  isSuperAdmin: boolean;
  drawerMode: 'edit' | 'preview';
  aiOpen: boolean;
  onToggleAi: () => void;
  onChangeMode: (mode: 'edit' | 'preview') => void;
  onClose: () => void;
}

export function ProductEditorHeader({
  productId,
  title,
  isSuperAdmin,
  drawerMode,
  aiOpen,
  onToggleAi,
  onChangeMode,
  onClose,
}: ProductEditorHeaderProps) {
  const ape = useAdminProductEditorI18n();
  return (
    <div
      className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <div className="min-w-0">
        <div
          className="text-[10.5px] font-mono-num uppercase tracking-widest"
          style={{ color: 'var(--accent)' }}
        >
          {productId ? `EDIT ITEM #${productId}` : 'CREATE NEW ITEM'}
        </div>
        <h2 id="product-editor-title" className="font-editorial text-xl font-semibold truncate">
          {productId ? title || ape.peHeaderEditFallback : ape.peHeaderNewTitle}
        </h2>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {isSuperAdmin && (
          <button
            type="button"
            onClick={onToggleAi}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer whitespace-nowrap border transition-colors"
            style={{
              borderColor: aiOpen && drawerMode === 'edit' ? 'transparent' : 'var(--accent)',
              backgroundColor: aiOpen && drawerMode === 'edit' ? 'var(--accent)' : 'var(--accent-soft)',
              color: aiOpen && drawerMode === 'edit' ? '#FAF9F5' : 'var(--accent)',
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {ape.peHeaderAiBtn}
          </button>
        )}

        <div
          className="inline-flex items-center p-0.5 rounded-full border text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <button
            type="button"
            onClick={() => onChangeMode('edit')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium cursor-pointer transition-colors whitespace-nowrap"
            style={{
              backgroundColor: drawerMode === 'edit' ? 'var(--accent)' : 'transparent',
              color: drawerMode === 'edit' ? '#FAF9F5' : 'var(--ink-secondary)',
            }}
          >
            <FileEdit className="w-3.5 h-3.5" />
            {ape.peHeaderEditMode}
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('preview')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium cursor-pointer transition-colors whitespace-nowrap"
            style={{
              backgroundColor: drawerMode === 'preview' ? 'var(--accent)' : 'transparent',
              color: drawerMode === 'preview' ? '#FAF9F5' : 'var(--ink-secondary)',
            }}
          >
            <Eye className="w-3.5 h-3.5" />
            {ape.peHeaderPreviewMode}
          </button>
        </div>

        {productId && (
          <a
            href={`/item/${productId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium no-underline whitespace-nowrap transition-colors hover:bg-[var(--bg-subtle)]"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }}
            title={ape.peHeaderLiveLinkTitle}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {ape.peHeaderLiveLinkBtn}
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
          aria-label={ape.peHeaderCloseAria}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
