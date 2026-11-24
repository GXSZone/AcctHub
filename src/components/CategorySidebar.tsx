import { resolveLocalizedField } from '@shared/domain/i18n';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { useStorefrontI18n } from '../i18n/namespaces/storefront';
import type { CategoryGroup } from '../types';
import { CategoryIcon, resolveBrandTint } from './BrandIcon';

interface CategorySidebarProps {
  groups: CategoryGroup[];
  counts: { featured: number; all: number };
  activeCategory: string;
  onSelectCategory: (slug: string) => void;
}

export function CategorySidebar({ groups, counts, activeCategory, onSelectCategory }: CategorySidebarProps) {
  const { locale, messages: t } = useI18n();
  const sf = useStorefrontI18n();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});

  const toggleGroup = (id: number) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="w-full lg:w-[272px] shrink-0">
      <div className="paper-card rounded-2xl p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto overscroll-contain">
        <div className="px-2 pb-3 mb-3 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div
            className="text-[10px] font-mono-num uppercase tracking-[0.14em]"
            style={{ color: 'var(--ink-muted)' }}
          >
            CATEGORIES
          </div>
          <h2 className="font-editorial text-xl font-semibold mt-0.5">{t.categoriesHeading}</h2>
        </div>

        {/* Fixed quick scopes */}
        <div className="space-y-1 mb-4">
          <button
            type="button"
            onClick={() => onSelectCategory('featured')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: activeCategory === 'featured' ? 'var(--accent-soft)' : 'transparent',
              color: activeCategory === 'featured' ? 'var(--accent)' : 'var(--ink-primary)',
            }}
          >
            <span className="flex items-center gap-2.5 truncate">
              <CategoryIcon icon="star" className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.featured}</span>
            </span>
            <span
              className="text-[11px] font-mono-num px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: activeCategory === 'featured' ? 'var(--bg-surface)' : 'var(--bg-subtle)',
                color: activeCategory === 'featured' ? 'var(--accent)' : 'var(--ink-muted)',
              }}
            >
              {counts.featured}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectCategory('all')}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer"
            style={{
              backgroundColor: activeCategory === 'all' ? 'var(--bg-subtle)' : 'transparent',
              color: activeCategory === 'all' ? 'var(--ink-primary)' : 'var(--ink-secondary)',
            }}
          >
            <span className="flex items-center gap-2.5 truncate">
              <CategoryIcon icon="all" className="w-4 h-4 shrink-0" />
              <span className="truncate">{t.allProducts}</span>
            </span>
            <span
              className="text-[11px] font-mono-num px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
            >
              {counts.all}
            </span>
          </button>
        </div>

        {/* Dynamic Admin-Managed Groups */}
        <div className="space-y-3">
          {groups.map((group) => {
            const collapsed = Boolean(collapsedGroups[group.id]);
            const groupLabel = resolveLocalizedField({
              locale,
              baseZh: group.name,
              legacyEn: group.name_en,
              translationsJson: group.translations_json,
              field: 'title',
            });
            return (
              <div
                key={group.id}
                className="pt-2 border-t first:border-t-0 first:pt-0"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wider cursor-pointer"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  <span>{groupLabel}</span>
                  {collapsed ? (
                    <ChevronRight className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {!collapsed && (
                  <div className="mt-1 space-y-0.5">
                    {group.categories.map((cat) => {
                      const active = activeCategory === cat.slug;
                      const catLabel = resolveLocalizedField({
                        locale,
                        baseZh: cat.name,
                        legacyEn: cat.name_en,
                        translationsJson: cat.translations_json,
                        field: 'title',
                      });
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => onSelectCategory(cat.slug)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[13px] transition-colors cursor-pointer text-left"
                          style={{
                            backgroundColor: active ? 'var(--bg-subtle)' : 'transparent',
                            color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)',
                            fontWeight: active ? 600 : 500,
                          }}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                              style={{
                                backgroundColor: active
                                  ? 'var(--bg-surface)'
                                  : `color-mix(in srgb, ${resolveBrandTint(cat.icon)} 8%, var(--bg-canvas))`,
                                borderColor: active
                                  ? 'var(--border-strong)'
                                  : `color-mix(in srgb, ${resolveBrandTint(cat.icon)} 18%, var(--border-color))`,
                              }}
                            >
                              <CategoryIcon icon={cat.icon} className="w-4 h-4" />
                            </span>
                            <span className="truncate">{catLabel}</span>
                          </span>

                          <span className="flex items-center gap-1.5 shrink-0">
                            {cat.badge_text && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded-md font-medium hidden xl:inline-block"
                                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                              >
                                {cat.badge_text}
                              </span>
                            )}
                            <span
                              className="text-[11px] font-mono-num min-w-[22px] text-center px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-muted)' }}
                            >
                              {cat.product_count}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    {group.categories.length === 0 && (
                      <div className="px-3 py-2 text-xs italic" style={{ color: 'var(--ink-muted)' }}>
                        {sf.sidebarEmptyHint}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
