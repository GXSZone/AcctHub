import { resolveLocalizedField } from '@shared/domain/i18n';
import { LayoutGrid, LayoutList, Loader2, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AnnouncementTicker } from '../components/AnnouncementTicker';
import { CategorySidebar } from '../components/CategorySidebar';
import { ProductCard } from '../components/ProductCard';
import { getStorefrontAgentRate } from '../features/storefront/agent-pricing';
import { fmt, useI18n } from '../i18n';
import { useStorefrontI18n } from '../i18n/namespaces/storefront';
import { CATALOG_TAG_FILTERS } from '../i18n/namespaces/storefront/tag-filters';
import { useProductsQuery } from '../queries/storefront.queries';
import type { Announcement, BootstrapPayload, UserProfile } from '../types';

interface CatalogPageProps {
  bootstrap: BootstrapPayload | null;
  user: UserProfile | null;
  onOpenSearch: () => void;
  onOpenAnnouncements: () => void;
  onSelectAnnouncement: (item: Announcement) => void;
  onOpenWelcomePopup: () => void;
}

export function CatalogPage({
  bootstrap,
  user,
  onOpenSearch,
  onOpenAnnouncements,
  onSelectAnnouncement,
  onOpenWelcomePopup,
}: CatalogPageProps) {
  const { locale, messages: t } = useI18n();
  const sf = useStorefrontI18n();
  const [activeCategory, setActiveCategory] = useState<string>('featured');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      const saved = localStorage.getItem('accthub_view_mode');
      if (saved === 'list' || saved === 'grid') return saved;
    } catch (err) {
      console.warn('Failed to read view mode:', err);
    }
    return (bootstrap?.settings?.default_view_mode as 'list' | 'grid') || 'list';
  });
  const [searchInput, setSearchInput] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [activeTag, setActiveTag] = useState('');

  useEffect(() => {
    if (bootstrap?.settings?.default_view_mode && !localStorage.getItem('accthub_view_mode')) {
      setViewMode(bootstrap.settings.default_view_mode === 'grid' ? 'grid' : 'list');
    }
  }, [bootstrap?.settings?.default_view_mode]);

  const productsQuery = useProductsQuery({
    category: appliedQuery ? 'all' : activeCategory,
    q: appliedQuery || undefined,
    tag: activeTag || undefined,
  });
  const products = productsQuery.data?.items ?? [];
  const loading = productsQuery.isLoading;

  const activeCategoryMeta = useMemo(() => {
    if (appliedQuery) {
      return {
        eyebrow: 'SEARCH RESULTS',
        title: fmt(sf.catSearchTitle, { query: appliedQuery }),
        subtitle: fmt(sf.catSearchSub, { count: products.length }),
      };
    }
    if (activeCategory === 'featured') {
      return {
        eyebrow: 'CURATED CATALOG',
        title:
          locale === 'zh-CN'
            ? t.featured
            : bootstrap?.settings?.hero_title_en && locale === 'en'
              ? bootstrap.settings.hero_title_en
              : t.featured,
        subtitle: resolveLocalizedField({
          locale,
          baseZh: bootstrap?.settings?.hero_subtitle || '',
          legacyEn: bootstrap?.settings?.hero_subtitle_en,
          field: 'subtitle',
        }),
      };
    }
    if (activeCategory === 'all') {
      return {
        eyebrow: 'ALL SEATS & COMPUTE',
        title: t.allProducts,
        subtitle: sf.catAllSub,
      };
    }
    for (const g of bootstrap?.groups || []) {
      const found = g.categories.find((c) => c.slug === activeCategory);
      if (found) {
        return {
          eyebrow: resolveLocalizedField({
            locale,
            baseZh: g.name,
            legacyEn: g.name_en,
            translationsJson: g.translations_json,
            field: 'title',
          }).toUpperCase(),
          title: resolveLocalizedField({
            locale,
            baseZh: found.name,
            legacyEn: found.name_en,
            translationsJson: found.translations_json,
            field: 'title',
          }),
          subtitle: found.badge_text
            ? fmt(sf.catChannelFeature, { badge: found.badge_text })
            : sf.catDefaultSub,
        };
      }
    }
    return { eyebrow: 'CATALOG', title: t.catalogHeading, subtitle: '' };
  }, [activeCategory, appliedQuery, bootstrap, locale, products.length, sf, t]);

  const switchView = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    try {
      localStorage.setItem('accthub_view_mode', mode);
    } catch (err) {
      console.warn('Failed to persist view mode:', err);
    }
  };

  const agentRate = getStorefrontAgentRate(user, bootstrap?.tenant);
  const banner = bootstrap?.settings?.announcement_banner;
  const tickerEnabled = (bootstrap?.settings?.ticker_enabled ?? 'true') !== 'false';
  const tickerIncludeNotices = (bootstrap?.settings?.ticker_include_notices ?? 'true') !== 'false';
  const showSmartBar = bootstrap?.settings?.show_smart_bar !== 'false';

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Multi-Notice Scrolling Ticker Bar */}
      {tickerEnabled && (
        <AnnouncementTicker
          announcements={tickerIncludeNotices ? bootstrap?.announcements || [] : []}
          extraBannerText={banner}
          mode={bootstrap?.settings?.ticker_mode || 'vertical'}
          onOpenAll={onOpenAnnouncements}
          onSelectAnnouncement={onSelectAnnouncement}
          onOpenWelcomePopup={onOpenWelcomePopup}
        />
      )}

      {/* Main Two-Column Layout: Grouped Category Sidebar + Main Product Area */}
      <div className="flex flex-col lg:flex-row items-start gap-6">
        <CategorySidebar
          groups={bootstrap?.groups || []}
          counts={bootstrap?.counts || { featured: 0, all: 0 }}
          activeCategory={appliedQuery ? '' : activeCategory}
          onSelectCategory={(slug) => {
            setAppliedQuery('');
            setSearchInput('');
            setActiveCategory(slug);
          }}
        />

        <main className="flex-1 min-w-0 w-full">
          <div className="paper-card rounded-2xl overflow-hidden">
            {/* Catalog Top Header Bar */}
            <div className="p-5 sm:p-6 border-b" style={{ borderColor: 'var(--border-color)' }}>
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <div
                    className="text-[10.5px] font-mono-num uppercase tracking-[0.15em]"
                    style={{ color: 'var(--accent)' }}
                  >
                    {activeCategoryMeta.eyebrow}
                  </div>
                  <h1 className="font-editorial text-2xl sm:text-[28px] font-semibold mt-1 leading-tight">
                    {activeCategoryMeta.title}
                  </h1>
                  {activeCategoryMeta.subtitle && (
                    <p className="text-xs sm:text-[13px] mt-1.5" style={{ color: 'var(--ink-secondary)' }}>
                      {activeCategoryMeta.subtitle}
                    </p>
                  )}
                </div>

                {/* Search + View Mode Switcher */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setAppliedQuery(searchInput.trim());
                    }}
                    className="flex items-center rounded-full border p-1 pl-3.5 transition-colors"
                    style={{
                      borderColor: 'var(--border-color)',
                      backgroundColor: 'var(--bg-canvas)',
                    }}
                  >
                    <Search className="w-3.5 h-3.5 mr-2 shrink-0" style={{ color: 'var(--ink-muted)' }} />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder={sf.catSearchPlaceholder}
                      className="bg-transparent border-0 outline-none text-xs w-36 sm:w-48"
                      style={{ color: 'var(--ink-primary)' }}
                    />
                    {appliedQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchInput('');
                          setAppliedQuery('');
                        }}
                        className="p-1 cursor-pointer"
                        style={{ color: 'var(--ink-muted)' }}
                        aria-label={sf.catClearSearchAria}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--ink-primary)', color: 'var(--bg-canvas)' }}
                    >
                      {t.searchBtn}
                    </button>
                  </form>

                  {/* Item List / Grid Cards Toggle */}
                  <fieldset
                    className="inline-flex items-center p-1 rounded-full border m-0"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                    aria-label={sf.catViewSwitchAria}
                  >
                    <button
                      type="button"
                      onClick={() => switchView('list')}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors"
                      style={{
                        backgroundColor: viewMode === 'list' ? 'var(--bg-surface)' : 'transparent',
                        color: viewMode === 'list' ? 'var(--ink-primary)' : 'var(--ink-muted)',
                        boxShadow: viewMode === 'list' ? '0 1px 3px rgb(0 0 0 / 0.08)' : 'none',
                      }}
                    >
                      <LayoutList className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t.viewList}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => switchView('grid')}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors"
                      style={{
                        backgroundColor: viewMode === 'grid' ? 'var(--bg-surface)' : 'transparent',
                        color: viewMode === 'grid' ? 'var(--ink-primary)' : 'var(--ink-muted)',
                        boxShadow: viewMode === 'grid' ? '0 1px 3px rgb(0 0 0 / 0.08)' : 'none',
                      }}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t.viewGrid}</span>
                    </button>
                  </fieldset>
                </div>
              </div>

              {/* Filter Pills + Claude Concierge Entry */}
              <div
                className="mt-4 pt-4 border-t flex flex-wrap items-center justify-between gap-3"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] mr-1"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    {sf.catFilterLabel}
                  </span>
                  {CATALOG_TAG_FILTERS.map((tagItem) => {
                    const active = activeTag === tagItem.value;
                    return (
                      <button
                        key={tagItem.key}
                        type="button"
                        onClick={() => setActiveTag(tagItem.value)}
                        className="px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors"
                        style={{
                          backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                          color: active ? 'var(--accent)' : 'var(--ink-secondary)',
                          border: `1px solid ${active ? 'transparent' : 'var(--border-color)'}`,
                        }}
                      >
                        {sf[tagItem.key]}
                      </button>
                    );
                  })}
                </div>

                {showSmartBar && (
                  <button
                    type="button"
                    onClick={onOpenSearch}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium cursor-pointer border transition-colors"
                    style={{
                      borderColor: 'var(--border-strong)',
                      backgroundColor: 'var(--bg-canvas)',
                      color: 'var(--ink-primary)',
                    }}
                  >
                    <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    {sf.catTrySmartMatch}
                  </button>
                )}
              </div>
            </div>

            {/* Product List / Grid Body */}
            {loading ? (
              <div
                className="py-20 flex flex-col items-center justify-center gap-3"
                style={{ color: 'var(--ink-muted)' }}
              >
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
                <span className="text-xs">{sf.catSyncingStock}</span>
              </div>
            ) : products.length === 0 ? (
              <div className="py-20 px-6 text-center">
                <p className="font-editorial text-xl font-medium">{sf.catEmptyTitle}</p>
                <p className="text-xs mt-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {sf.catEmptyDesc}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTag('');
                    setAppliedQuery('');
                    setSearchInput('');
                    setActiveCategory('all');
                  }}
                  className="mt-4 px-4 py-2 rounded-full text-xs font-medium cursor-pointer"
                  style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                >
                  {sf.catViewAllBtn}
                </button>
              </div>
            ) : viewMode === 'list' ? (
              <div>
                <div
                  className="hidden sm:flex items-center justify-between px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider border-b"
                  style={{
                    borderColor: 'var(--border-color)',
                    backgroundColor: 'var(--bg-canvas)',
                    color: 'var(--ink-muted)',
                  }}
                >
                  <span>{sf.catListColSpec}</span>
                  <div className="flex items-center gap-7 pr-4">
                    <span className="min-w-[78px] text-right">{t.price}</span>
                    <span className="min-w-[64px] text-center">{t.stock}</span>
                    <span className="min-w-[96px] text-right">{sf.catListColAction}</span>
                  </div>
                </div>
                <div>
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      viewMode="list"
                      showWholesale={agentRate !== null}
                      agentRate={agentRate}
                      agentTier={user?.agent_tier}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div
                className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                style={{ backgroundColor: 'var(--bg-canvas)' }}
              >
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    viewMode="grid"
                    showWholesale={agentRate !== null}
                    agentRate={agentRate}
                    agentTier={user?.agent_tier}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
