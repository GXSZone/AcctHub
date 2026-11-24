/**
 * 右侧商品子分类列表面板（支持搜索、拖拽与箭头排序、一键跳转商品）
 */

import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GripVertical,
  Layers,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '../../../api/admin.api';
import { BrandBadge } from '../../../components/BrandIcon';
import { openConfirm } from '../../../components/ConfirmDialog';
import { fmt } from '../../../i18n';
import { useAdminCatalogI18n } from '../../../i18n/namespaces/admin-catalog';
import type { AdminCategoryItem, AdminGroupItem } from './AdminCategoryManager';

interface CategoryListPaneProps {
  activeGroup: AdminGroupItem | null;
  selectedGroupId: number;
  visibleCategories: AdminCategoryItem[];
  catQuery: string;
  canReorderCats: boolean;
  reordering: boolean;
  productCountByCat: Map<number, { total: number; active: number }>;
  groupNameMap: Map<number, string>;
  onQueryChange: (v: string) => void;
  onCreateCategory: () => void;
  onEditCategory: (c: AdminCategoryItem) => void;
  onCommitOrder: (nextOrdered: AdminCategoryItem[]) => Promise<void>;
  onJumpToCategoryProducts: (categoryId: number) => void;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

function reorderList<T>(list: T[], fromIdx: number, toIdx: number): T[] {
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function CategoryListPane({
  activeGroup,
  selectedGroupId,
  visibleCategories,
  catQuery,
  canReorderCats,
  reordering,
  productCountByCat,
  groupNameMap,
  onQueryChange,
  onCreateCategory,
  onEditCategory,
  onCommitOrder,
  onJumpToCategoryProducts,
  onReload,
  onStorefrontUpdated,
  showToast,
}: CategoryListPaneProps) {
  const act = useAdminCatalogI18n();
  const [dragCatId, setDragCatId] = useState<number | null>(null);
  const [dragOverCatId, setDragOverCatId] = useState<number | null>(null);

  return (
    <div className="lg:col-span-7 xl:col-span-8 paper-card rounded-2xl overflow-hidden">
      <div
        className="px-5 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-editorial text-lg font-semibold truncate">
              {activeGroup
                ? fmt(act.catPaneTitleScoped, { groupName: activeGroup.name })
                : act.catPaneTitleAll}
            </h2>
            <span
              className="text-[11px] font-mono-num px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            >
              {fmt(act.catCountBadge, { count: visibleCategories.length })}
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {canReorderCats ? act.catHintScoped : act.catHintAll}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-muted)' }}
            />
            <input
              value={catQuery}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={act.catSearchPlaceholder}
              className="acct-input h-8 pl-8 pr-2.5 py-0 text-xs w-40 sm:w-48"
            />
          </div>
          <button
            type="button"
            onClick={onCreateCategory}
            className="h-8 inline-flex items-center gap-1 px-3.5 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {act.catAddBtn}
          </button>
        </div>
      </div>

      <div className="p-4">
        {visibleCategories.length === 0 ? (
          <div className="py-12 text-center space-y-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
            <Layers className="w-8 h-8 mx-auto opacity-35" />
            <div>
              {activeGroup ? fmt(act.catEmptyScoped, { groupName: activeGroup.name }) : act.catEmptySearch}
            </div>
            <button
              type="button"
              onClick={onCreateCategory}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer mt-1"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {act.catCreateNowBtn}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {visibleCategories.map((c, idx) => {
              const counts = productCountByCat.get(c.id) || { total: 0, active: 0 };
              const isDragTarget = dragOverCatId === c.id && dragCatId !== c.id;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 拖拽排序列表项需监听拖放事件，同时提供键盘可达的上下移按钮
                <div
                  key={c.id}
                  draggable={canReorderCats && !reordering}
                  onDragStart={() => canReorderCats && setDragCatId(c.id)}
                  onDragOver={(e) => {
                    if (!canReorderCats) return;
                    e.preventDefault();
                    if (dragOverCatId !== c.id) setDragOverCatId(c.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverCatId === c.id) setDragOverCatId(null);
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setDragOverCatId(null);
                    if (!canReorderCats || dragCatId === null || dragCatId === c.id) return;
                    const fromIdx = visibleCategories.findIndex((x) => x.id === dragCatId);
                    const toIdx = visibleCategories.findIndex((x) => x.id === c.id);
                    setDragCatId(null);
                    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
                    await onCommitOrder(reorderList(visibleCategories, fromIdx, toIdx));
                  }}
                  onDragEnd={() => {
                    setDragCatId(null);
                    setDragOverCatId(null);
                  }}
                  className="p-3.5 rounded-xl border flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 transition-all"
                  style={{
                    borderColor: isDragTarget ? 'var(--accent)' : 'var(--border-color)',
                    backgroundColor: 'var(--bg-canvas)',
                    boxShadow: isDragTarget
                      ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)'
                      : undefined,
                    opacity: dragCatId === c.id ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {canReorderCats && (
                      <span
                        className="cursor-grab active:cursor-grabbing p-0.5 shrink-0"
                        style={{ color: 'var(--ink-muted)' }}
                        title={act.catDragTitle}
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                    )}
                    <BrandBadge icon={c.icon || 'sparkles'} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-semibold truncate">{c.name}</span>
                        {c.badge_text && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          >
                            {c.badge_text}
                          </span>
                        )}
                        {selectedGroupId === 0 && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                          >
                            {groupNameMap.get(c.group_id) || act.catUngrouped}
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[11px] font-mono-num mt-0.5 truncate"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {c.name_en || c.name} · slug: {c.slug}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-auto">
                    <button
                      type="button"
                      onClick={() => onJumpToCategoryProducts(c.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono-num font-medium cursor-pointer transition-colors"
                      style={{
                        backgroundColor: counts.total > 0 ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                        color: counts.total > 0 ? 'var(--ink-primary)' : 'var(--ink-muted)',
                        border: '1px solid var(--border-color)',
                      }}
                      title={act.catJumpProductsTitle}
                    >
                      <Package className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                      {fmt(act.catProdRatio, { active: counts.active, total: counts.total })}
                      <ArrowRight className="w-3 h-3 opacity-60" />
                    </button>

                    {canReorderCats && (
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0 || reordering}
                          onClick={() => void onCommitOrder(reorderList(visibleCategories, idx, idx - 1))}
                          className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-25"
                          style={{
                            borderColor: 'var(--border-color)',
                            backgroundColor: 'var(--bg-surface)',
                          }}
                          title={act.catMoveUpTitle}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === visibleCategories.length - 1 || reordering}
                          onClick={() => void onCommitOrder(reorderList(visibleCategories, idx, idx + 1))}
                          className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-25"
                          style={{
                            borderColor: 'var(--border-color)',
                            backgroundColor: 'var(--bg-surface)',
                          }}
                          title={act.catMoveDownTitle}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => onEditCategory(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {act.catEditBtn}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const extra =
                          counts.total > 0 ? fmt(act.catDeleteExtraWithProds, { count: counts.total }) : '';
                        const ok = await openConfirm({
                          title: act.catDeleteTitle,
                          description: fmt(act.catDeleteDesc, { name: c.name, extra }),
                          confirmLabel: act.catDeleteConfirm,
                          tone: 'danger',
                        });
                        if (!ok) return;
                        await adminApi.deleteCategory(c.id);
                        await onReload();
                        onStorefrontUpdated();
                        showToast(fmt(act.catDeletedToast, { name: c.name }));
                      }}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--danger)' }}
                      title={act.catDeleteTitleAttr}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
