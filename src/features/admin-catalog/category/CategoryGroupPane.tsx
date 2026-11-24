/**
 * 左侧商品分组树面板（支持拖拽与箭头排序）
 */

import { ArrowDown, ArrowUp, FolderTree, GripVertical, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '../../../api/admin.api';
import { openConfirm } from '../../../components/ConfirmDialog';
import { fmt } from '../../../i18n';
import { useAdminCatalogI18n } from '../../../i18n/namespaces/admin-catalog';
import type { AdminGroupItem } from './AdminCategoryManager';

interface CategoryGroupPaneProps {
  sortedGroups: AdminGroupItem[];
  categoriesCount: number;
  productsCount: number;
  selectedGroupId: number;
  statsByGroup: Map<number, { cats: number; products: number }>;
  reordering: boolean;
  onSelectGroup: (id: number) => void;
  onCreateGroup: () => void;
  onEditGroup: (g: AdminGroupItem) => void;
  onCommitOrder: (nextOrdered: AdminGroupItem[]) => Promise<void>;
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

export function CategoryGroupPane({
  sortedGroups,
  categoriesCount,
  productsCount,
  selectedGroupId,
  statsByGroup,
  reordering,
  onSelectGroup,
  onCreateGroup,
  onEditGroup,
  onCommitOrder,
  onReload,
  onStorefrontUpdated,
  showToast,
}: CategoryGroupPaneProps) {
  const act = useAdminCatalogI18n();
  const [dragGroupId, setDragGroupId] = useState<number | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  return (
    <div className="lg:col-span-5 xl:col-span-4 paper-card rounded-2xl overflow-hidden">
      <div
        className="px-5 py-4 border-b flex items-center justify-between gap-2"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <div className="flex items-center gap-1.5 font-editorial text-lg font-semibold">
            <FolderTree className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            {fmt(act.grpTitle, { count: sortedGroups.length })}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {act.grpHint}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateGroup}
          className="h-8 inline-flex items-center gap-1 px-3 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {act.grpAddBtn}
        </button>
      </div>

      <div className="p-3 space-y-1.5">
        <button
          type="button"
          onClick={() => onSelectGroup(0)}
          className="w-full px-3.5 py-2.5 rounded-xl border text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
          style={{
            borderColor: selectedGroupId === 0 ? 'var(--accent)' : 'transparent',
            backgroundColor: selectedGroupId === 0 ? 'var(--accent-soft)' : 'var(--bg-canvas)',
          }}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Layers
              className="w-3.5 h-3.5"
              style={{ color: selectedGroupId === 0 ? 'var(--accent)' : 'var(--ink-muted)' }}
            />
            <span style={{ color: selectedGroupId === 0 ? 'var(--accent)' : 'var(--ink-primary)' }}>
              {act.grpAllName}
            </span>
          </div>
          <span
            className="text-[11px] font-mono-num px-2 py-0.5 rounded-full"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
          >
            {fmt(act.grpAllStats, { cats: categoriesCount, products: productsCount })}
          </span>
        </button>

        <div className="h-px my-1" style={{ backgroundColor: 'var(--border-color)' }} />

        {sortedGroups.map((g, idx) => {
          const isSelected = selectedGroupId === g.id;
          const isDragTarget = dragOverGroupId === g.id && dragGroupId !== g.id;
          const st = statsByGroup.get(g.id) || { cats: 0, products: 0 };
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: 左侧分组卡片支持 HTML5 拖拽排序且内部嵌有独立按钮，由标题按钮提供完整键盘可达性
            <div
              key={g.id}
              draggable={!reordering}
              onDragStart={() => setDragGroupId(g.id)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragOverGroupId !== g.id) setDragOverGroupId(g.id);
              }}
              onDragLeave={() => {
                if (dragOverGroupId === g.id) setDragOverGroupId(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOverGroupId(null);
                if (dragGroupId === null || dragGroupId === g.id) return;
                const fromIdx = sortedGroups.findIndex((x) => x.id === dragGroupId);
                const toIdx = sortedGroups.findIndex((x) => x.id === g.id);
                setDragGroupId(null);
                if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
                await onCommitOrder(reorderList(sortedGroups, fromIdx, toIdx));
              }}
              onDragEnd={() => {
                setDragGroupId(null);
                setDragOverGroupId(null);
              }}
              className="group p-3 rounded-xl border transition-all flex items-center gap-2"
              style={{
                borderColor: isDragTarget || isSelected ? 'var(--accent)' : 'var(--border-color)',
                backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                boxShadow: isDragTarget
                  ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)'
                  : undefined,
                opacity: dragGroupId === g.id ? 0.55 : 1,
              }}
            >
              <span
                className="cursor-grab active:cursor-grabbing p-0.5 shrink-0"
                style={{ color: 'var(--ink-muted)' }}
                title={act.grpDragTitle}
              >
                <GripVertical className="w-3.5 h-3.5" />
              </span>

              <button
                type="button"
                onClick={() => onSelectGroup(g.id)}
                className="min-w-0 flex-1 text-left cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="text-xs font-semibold truncate"
                    style={{ color: isSelected ? 'var(--accent)' : 'var(--ink-primary)' }}
                  >
                    {g.name}
                  </span>
                </div>
                <div
                  className="text-[10.5px] font-mono-num mt-0.5 flex items-center gap-1.5"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <span>{fmt(act.grpItemCats, { count: st.cats })}</span>
                  <span>·</span>
                  <span>{fmt(act.grpItemProducts, { count: st.products })}</span>
                  <span className="truncate opacity-75">· {g.slug}</span>
                </div>
              </button>

              <fieldset
                className="flex items-center gap-0.5 shrink-0 border-0 p-0 m-0"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={idx === 0 || reordering}
                  onClick={() => void onCommitOrder(reorderList(sortedGroups, idx, idx - 1))}
                  className="p-1 rounded-md cursor-pointer disabled:opacity-25 hover:bg-black/5"
                  title={act.grpMoveUpTitle}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === sortedGroups.length - 1 || reordering}
                  onClick={() => void onCommitOrder(reorderList(sortedGroups, idx, idx + 1))}
                  className="p-1 rounded-md cursor-pointer disabled:opacity-25 hover:bg-black/5"
                  title={act.grpMoveDownTitle}
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onEditGroup(g)}
                  className="p-1 rounded-md cursor-pointer hover:bg-black/5"
                  style={{ color: 'var(--accent)' }}
                  title={act.grpEditTitle}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await openConfirm({
                      title: act.grpDeleteTitle,
                      description: fmt(act.grpDeleteDesc, { name: g.name, count: st.cats }),
                      confirmLabel: act.grpDeleteConfirm,
                      tone: 'danger',
                    });
                    if (!ok) return;
                    await adminApi.deleteGroup(g.id);
                    await onReload();
                    onStorefrontUpdated();
                    showToast(fmt(act.grpDeletedToast, { name: g.name }));
                  }}
                  className="p-1 rounded-md cursor-pointer hover:bg-black/5"
                  style={{ color: 'var(--danger)' }}
                  title={act.grpDeleteTitleAttr}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </fieldset>
            </div>
          );
        })}
      </div>
    </div>
  );
}
