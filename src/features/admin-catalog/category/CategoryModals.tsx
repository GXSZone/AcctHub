/**
 * 商品分组与子分类新增/编辑原生弹窗组件
 */

import { Save, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { adminApi } from '../../../api/admin.api';
import { BrandBadge, buildBrandIconOptions } from '../../../components/BrandIcon';
import { fmt } from '../../../i18n';
import { useAdminCatalogI18n } from '../../../i18n/namespaces/admin-catalog';
import { useUiKitI18n } from '../../../i18n/namespaces/ui-kit';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../../lib/uiHelpers';
import type { AdminGroupItem } from './AdminCategoryManager';

interface GroupModalProps {
  mode: 'new' | 'edit' | null;
  editingId: number | null;
  form: { name: string; name_en: string; slug: string; sort_order: number };
  setForm: (next: { name: string; name_en: string; slug: string; sort_order: number }) => void;
  saving: boolean;
  setSaving: (v: boolean) => void;
  onClose: () => void;
  onCreatedGroup: (id: number) => void;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function CategoryGroupModal({
  mode,
  editingId,
  form,
  setForm,
  saving,
  setSaving,
  onClose,
  onCreatedGroup,
  onReload,
  onStorefrontUpdated,
  showToast,
}: GroupModalProps) {
  const act = useAdminCatalogI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (mode) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
    return attachDialogLightDismissFallback(dlg, onClose);
  }, [mode, onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="acct-dialog rounded-2xl p-0 w-full max-w-md"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            if (mode === 'edit' && editingId) {
              await adminApi.updateGroup(editingId, {
                name: form.name.trim(),
                name_en: form.name_en.trim() || form.name.trim(),
                sort_order: form.sort_order,
              });
              showToast(fmt(act.modalGrpUpdatedToast, { name: form.name }));
            } else {
              const res = (await adminApi.createGroup({
                name: form.name.trim(),
                name_en: form.name_en.trim() || form.name.trim(),
                slug: form.slug.trim() || `group-${Date.now().toString(36)}`,
                sort_order: form.sort_order,
              })) as { id?: number };
              if (res?.id) onCreatedGroup(Number(res.id));
              showToast(fmt(act.modalGrpCreatedToast, { name: form.name }));
            }
            await closeDialogSmoothly(dialogRef.current);
            onClose();
            await onReload();
            onStorefrontUpdated();
          } finally {
            setSaving(false);
          }
        }}
        className="p-6 space-y-4 text-xs"
      >
        <div
          className="flex items-center justify-between pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h3 className="font-editorial text-lg font-semibold">
            {mode === 'edit' ? act.modalGrpEditTitle : act.modalGrpCreateTitle}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-full cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <div className="block font-semibold mb-1">{act.modalGrpNameZhLabel}</div>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={act.modalGrpNameZhPlaceholder}
              className="acct-input"
            />
          </div>
          <div>
            <div className="block font-semibold mb-1">{act.modalGrpNameEnLabel}</div>
            <input
              value={form.name_en}
              onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              placeholder={act.modalGrpNameEnPlaceholder}
              className="acct-input"
            />
          </div>
          {mode === 'new' && (
            <div>
              <div className="block font-semibold mb-1">{act.modalGrpSlugLabel}</div>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder={act.modalGrpSlugPlaceholder}
                className="acct-input font-mono-num"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {act.modalCancelBtn}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? act.modalSaving : act.modalGrpSaveBtn}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export interface CategoryFormDraft {
  group_id: number;
  name: string;
  name_en: string;
  slug: string;
  icon: string;
  badge_text: string;
  schema_type: string;
  sort_order: number;
}

interface CategoryItemModalProps {
  mode: 'new' | 'edit' | null;
  editingId: number | null;
  form: CategoryFormDraft;
  setForm: (next: CategoryFormDraft) => void;
  sortedGroups: AdminGroupItem[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  onClose: () => void;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function CategoryItemModal({
  mode,
  editingId,
  form,
  setForm,
  sortedGroups,
  saving,
  setSaving,
  onClose,
  onReload,
  onStorefrontUpdated,
  showToast,
}: CategoryItemModalProps) {
  const act = useAdminCatalogI18n();
  const ui = useUiKitI18n();
  const brandIconOptions = buildBrandIconOptions(ui);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (mode) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
    return attachDialogLightDismissFallback(dlg, onClose);
  }, [mode, onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="acct-dialog rounded-2xl p-0 w-full max-w-lg"
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            if (mode === 'edit' && editingId) {
              await adminApi.updateCategory(editingId, {
                group_id: form.group_id,
                name: form.name.trim(),
                name_en: form.name_en.trim() || form.name.trim(),
                icon: form.icon,
                badge_text: form.badge_text.trim(),
                sort_order: form.sort_order,
              });
              showToast(fmt(act.modalCatUpdatedToast, { name: form.name }));
            } else {
              await adminApi.createCategory({
                group_id: form.group_id,
                slug: form.slug.trim() || `cat-${Date.now().toString(36)}`,
                name: form.name.trim(),
                name_en: form.name_en.trim() || form.name.trim(),
                icon: form.icon,
                badge_text: form.badge_text.trim(),
                schema_type: form.schema_type,
                sort_order: form.sort_order,
              });
              showToast(fmt(act.modalCatCreatedToast, { name: form.name }));
            }
            await closeDialogSmoothly(dialogRef.current);
            onClose();
            await onReload();
            onStorefrontUpdated();
          } finally {
            setSaving(false);
          }
        }}
        className="p-6 space-y-4 text-xs"
      >
        <div
          className="flex items-center justify-between pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2.5">
            <BrandBadge icon={form.icon} size="sm" />
            <h3 className="font-editorial text-lg font-semibold">
              {mode === 'edit' ? act.modalCatEditTitle : act.modalCatCreateTitle}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-full cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="block font-semibold mb-1">{act.modalCatParentGroupLabel}</div>
            <select
              value={form.group_id}
              onChange={(e) => setForm({ ...form, group_id: Number(e.target.value) })}
              className="acct-input"
            >
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="block font-semibold mb-1">{act.modalCatIconLabel}</div>
            <select
              value={form.icon}
              onChange={(e) => setForm({ ...form, icon: e.target.value })}
              className="acct-input"
            >
              {brandIconOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="block font-semibold mb-1">{act.modalCatNameZhLabel}</div>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={act.modalCatNameZhPlaceholder}
              className="acct-input"
            />
          </div>
          <div>
            <div className="block font-semibold mb-1">{act.modalCatNameEnLabel}</div>
            <input
              value={form.name_en}
              onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              placeholder={act.modalCatNameEnPlaceholder}
              className="acct-input"
            />
          </div>
          <div>
            <div className="block font-semibold mb-1">{act.modalCatBadgeLabel}</div>
            <input
              value={form.badge_text}
              onChange={(e) => setForm({ ...form, badge_text: e.target.value })}
              placeholder={act.modalCatBadgePlaceholder}
              className="acct-input"
            />
          </div>
          {mode === 'new' && (
            <div>
              <div className="block font-semibold mb-1">{act.modalCatSlugLabel}</div>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder={act.modalCatSlugPlaceholder}
                className="acct-input font-mono-num"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 rounded-xl border cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {act.modalCancelBtn}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? act.modalSaving : act.modalCatSaveBtn}
          </button>
        </div>
      </form>
    </dialog>
  );
}
