import { resolveLocalizedField } from '@shared/domain/i18n';
import { BookOpen, HelpCircle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { RichContentRenderer } from '../components/RichContentRenderer';
import { useI18n } from '../i18n';
import { useHelpArticlesQuery } from '../queries/storefront.queries';

const ALL_CATEGORY_KEY = '__ALL__';

export function HelpCenterPage() {
  const { locale, messages: t } = useI18n();
  const helpQuery = useHelpArticlesQuery();
  const articles = helpQuery.data?.articles ?? [];
  const loading = helpQuery.isLoading;
  const [activeCat, setActiveCat] = useState(ALL_CATEGORY_KEY);

  const categories = [ALL_CATEGORY_KEY, ...Array.from(new Set(articles.map((a) => a.category)))];
  const filtered =
    activeCat === ALL_CATEGORY_KEY ? articles : articles.filter((a) => a.category === activeCat);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <div
          className="text-[11px] font-mono-num uppercase tracking-[0.14em]"
          style={{ color: 'var(--accent)' }}
        >
          {t.helpEyebrow}
        </div>
        <h1 className="font-editorial text-3xl font-semibold mt-1">{t.helpTitle}</h1>
        <p className="text-xs sm:text-sm mt-1.5" style={{ color: 'var(--ink-secondary)' }}>
          {t.helpSubtitle}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCat(cat)}
            className="px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer border"
            style={{
              backgroundColor: activeCat === cat ? 'var(--accent-soft)' : 'var(--bg-surface)',
              borderColor: activeCat === cat ? 'transparent' : 'var(--border-color)',
              color: activeCat === cat ? 'var(--accent)' : 'var(--ink-secondary)',
            }}
          >
            {cat === ALL_CATEGORY_KEY ? t.allCategories : cat}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((art) => (
            <article key={art.id} className="paper-card rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-medium px-2.5 py-0.5 rounded-full inline-flex items-center gap-1"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                >
                  <BookOpen className="w-3 h-3" />
                  {art.category}
                </span>
              </div>
              <h2 className="font-editorial text-xl font-semibold flex items-center gap-2">
                <HelpCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
                {resolveLocalizedField({
                  locale,
                  baseZh: art.title,
                  legacyEn: art.title_en,
                  translationsJson: art.translations_json,
                  field: 'title',
                })}
              </h2>
              <div className="mt-3">
                <RichContentRenderer
                  content={resolveLocalizedField({
                    locale,
                    baseZh: art.content,
                    legacyEn: art.content_en,
                    translationsJson: art.translations_json,
                    field: 'content',
                  })}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
