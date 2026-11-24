/**
 * 主从双栏商品分组与子分类管理总控组件
 */

import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../../api/admin.api';
import { useAdminCatalogI18n } from '../../../i18n/namespaces/admin-catalog';
import { CategoryGroupPane } from './CategoryGroupPane';
import { CategoryListPane } from './CategoryListPane';
import { type CategoryFormDraft, CategoryGroupModal, CategoryItemModal } from './CategoryModals';

export interface AdminGroupItem {
  id: number;
  slug: string;
  name: string;
  name_en: string;
  sort_order: number;
}

export interface AdminCategoryItem {
  id: number;
  group_id: number;
  slug: string;
  name: string;
  name_en: string;
  icon: string;
  badge_text: string;
  schema_type: string;
  sort_order: number;
}

interface AdminCategoryManagerProps {
  groups: AdminGroupItem[];
  categories: AdminCategoryItem[];
  products: Array<{ id: number; category_id: number; is_active: number }>;
  onReload: () => Promise<void>;
  onStorefrontUpdated: () => void;
  onJumpToCategoryProducts: (categoryId: number) => void;
  showToast: (msg: string) => void;
}

export function AdminCategoryManager({
  groups,
  categories,
  products,
  onReload,
  onStorefrontUpdated,
  onJumpToCategoryProducts,
  showToast,
}: AdminCategoryManagerProps) {
  const act = useAdminCatalogI18n();
  const [selectedGroupId, setSelectedGroupId] = useState<number>(() => groups[0]?.id ?? 0);
  const [catQuery, setCatQuery] = useState('');
  const [reordering, setReordering] = useState(false);

  const [groupModalMode, setGroupModalMode] = useState<'new' | 'edit' | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', name_en: '', slug: '', sort_order: 1 });
  const [savingGroup, setSavingGroup] = useState(false);

  const [catModalMode, setCatModalMode] = useState<'new' | 'edit' | null>(null);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [catForm, setCatForm] = useState<CategoryFormDraft>({
    group_id: groups[0]?.id || 1,
    name: '',
    name_en: '',
    slug: '',
    icon: 'sparkles',
    badge_text: '',
    schema_type: 'ai_subscription',
    sort_order: 1,
  });
  const [savingCat, setSavingCat] = useState(false);

  useEffect(() => {
    if (selectedGroupId > 0 && !groups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? 0);
    }
  }, [groups, selectedGroupId]);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [groups]
  );

  const productCountByCat = useMemo(() => {
    const m = new Map<number, { total: number; active: number }>();
    for (const p of products) {
      const cur = m.get(p.category_id) || { total: 0, active: 0 };
      cur.total += 1;
      if (p.is_active) cur.active += 1;
      m.set(p.category_id, cur);
    }
    return m;
  }, [products]);

  const statsByGroup = useMemo(() => {
    const m = new Map<number, { cats: number; products: number }>();
    for (const c of categories) {
      const cur = m.get(c.group_id) || { cats: 0, products: 0 };
      cur.cats += 1;
      cur.products += productCountByCat.get(c.id)?.total ?? 0;
      m.set(c.group_id, cur);
    }
    return m;
  }, [categories, productCountByCat]);

  const groupNameMap = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const visibleCategories = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    return [...categories]
      .filter((c) => {
        if (selectedGroupId > 0 && c.group_id !== selectedGroupId) return false;
        if (q && !`${c.name} ${c.name_en} ${c.slug} ${c.badge_text}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (selectedGroupId === 0 && a.group_id !== b.group_id) {
          const ga = sortedGroups.findIndex((g) => g.id === a.group_id);
          const gb = sortedGroups.findIndex((g) => g.id === b.group_id);
          return ga - gb;
        }
        return a.sort_order - b.sort_order || a.id - b.id;
      });
  }, [categories, selectedGroupId, catQuery, sortedGroups]);

  const canReorderCats = selectedGroupId > 0 && !catQuery.trim();
  const activeGroup = sortedGroups.find((g) => g.id === selectedGroupId) || null;

  const commitGroupOrder = async (nextOrdered: AdminGroupItem[]) => {
    setReordering(true);
    try {
      await adminApi.reorderGroups(nextOrdered.map((g) => g.id));
      await onReload();
      onStorefrontUpdated();
      showToast(act.catGroupOrderSyncedToast);
    } finally {
      setReordering(false);
    }
  };

  const commitCategoryOrder = async (nextOrdered: AdminCategoryItem[]) => {
    setReordering(true);
    try {
      await adminApi.reorderCategories(nextOrdered.map((c) => c.id));
      await onReload();
      onStorefrontUpdated();
      showToast(act.catListOrderSyncedToast);
    } finally {
      setReordering(false);
    }
  };

  const openCreateGroup = () => {
    setEditingGroupId(null);
    setGroupForm({ name: '', name_en: '', slug: '', sort_order: sortedGroups.length + 1 });
    setGroupModalMode('new');
  };

  const openEditGroup = (g: AdminGroupItem) => {
    setEditingGroupId(g.id);
    setGroupForm({ name: g.name, name_en: g.name_en || '', slug: g.slug, sort_order: g.sort_order });
    setGroupModalMode('edit');
  };

  const openCreateCategory = () => {
    const defaultGid = selectedGroupId > 0 ? selectedGroupId : sortedGroups[0]?.id || 1;
    const siblingCount = categories.filter((c) => c.group_id === defaultGid).length;
    setEditingCatId(null);
    setCatForm({
      group_id: defaultGid,
      name: '',
      name_en: '',
      slug: '',
      icon: 'sparkles',
      badge_text: '',
      schema_type: 'ai_subscription',
      sort_order: siblingCount + 1,
    });
    setCatModalMode('new');
  };

  const openEditCategory = (c: AdminCategoryItem) => {
    setEditingCatId(c.id);
    setCatForm({
      group_id: c.group_id,
      name: c.name,
      name_en: c.name_en || '',
      slug: c.slug,
      icon: c.icon || 'sparkles',
      badge_text: c.badge_text || '',
      schema_type: c.schema_type || 'ai_subscription',
      sort_order: c.sort_order,
    });
    setCatModalMode('edit');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <CategoryGroupPane
          sortedGroups={sortedGroups}
          categoriesCount={categories.length}
          productsCount={products.length}
          selectedGroupId={selectedGroupId}
          statsByGroup={statsByGroup}
          reordering={reordering}
          onSelectGroup={setSelectedGroupId}
          onCreateGroup={openCreateGroup}
          onEditGroup={openEditGroup}
          onCommitOrder={commitGroupOrder}
          onReload={onReload}
          onStorefrontUpdated={onStorefrontUpdated}
          showToast={showToast}
        />

        <CategoryListPane
          activeGroup={activeGroup}
          selectedGroupId={selectedGroupId}
          visibleCategories={visibleCategories}
          catQuery={catQuery}
          canReorderCats={canReorderCats}
          reordering={reordering}
          productCountByCat={productCountByCat}
          groupNameMap={groupNameMap}
          onQueryChange={setCatQuery}
          onCreateCategory={openCreateCategory}
          onEditCategory={openEditCategory}
          onCommitOrder={commitCategoryOrder}
          onJumpToCategoryProducts={onJumpToCategoryProducts}
          onReload={onReload}
          onStorefrontUpdated={onStorefrontUpdated}
          showToast={showToast}
        />
      </div>

      <CategoryGroupModal
        mode={groupModalMode}
        editingId={editingGroupId}
        form={groupForm}
        setForm={setGroupForm}
        saving={savingGroup}
        setSaving={setSavingGroup}
        onClose={() => setGroupModalMode(null)}
        onCreatedGroup={setSelectedGroupId}
        onReload={onReload}
        onStorefrontUpdated={onStorefrontUpdated}
        showToast={showToast}
      />

      <CategoryItemModal
        mode={catModalMode}
        editingId={editingCatId}
        form={catForm}
        setForm={setCatForm}
        sortedGroups={sortedGroups}
        saving={savingCat}
        setSaving={setSavingCat}
        onClose={() => setCatModalMode(null)}
        onReload={onReload}
        onStorefrontUpdated={onStorefrontUpdated}
        showToast={showToast}
      />
    </div>
  );
}
