import type { WarrantyType } from '@shared/constants/enums';
import { defaultWarrantyValue, normalizeWarrantyType } from '@shared/domain/warranty';
import { ArrowLeft, Eye, Loader2, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { BrandBadge } from '../../components/BrandIcon';
import { RichContentRenderer } from '../../components/RichContentRenderer';
import { fmt } from '../../i18n';
import { useUiKitI18n } from '../../i18n/namespaces/ui-kit';
import type { ProductCustomField, ProductFaq } from '../../types';
import { ProductPreviewAside } from './ProductPreviewAside';

export interface ProductPreviewSpecItem {
  id: string;
  name: string;
  price: number;
  originalPrice?: number;
  stock: number;
  badge?: string;
  description?: string;
}

export interface ProductPreviewViewProps {
  bannerText: string;
  onBackToEdit: () => void;
  loading?: boolean;
  productId: number | null;
  categoryName?: string;
  title: string;
  subtitle?: string;
  iconKey?: string;
  accentColor?: string;
  tags: string[];
  deliveryType?: string;
  warrantyType?: WarrantyType;
  warrantyDays?: number;
  warrantySummary?: string;
  totalStock: number;
  stockLabel?: string;
  salesCount?: number;
  riskNotice?: string;
  detailHtml?: string;
  emptyDetailHint?: string;
  faq?: ProductFaq[];
  customFields?: ProductCustomField[];
  priceHeaderLabel: string;
  specs: ProductPreviewSpecItem[];
  activeSpecId: string;
  onSelectSpec: (specId: string) => void;
  fallbackBasePrice?: number;
  fallbackOriginalPrice?: number | null;
}

/**
 * Single shared full-page product storefront preview used by both
 * Super-Admin ProductEditorDrawer and Sub-Agent AgentPricingPanel.
 */
export function ProductPreviewView({
  bannerText,
  onBackToEdit,
  loading = false,
  productId,
  categoryName,
  title,
  subtitle,
  iconKey = 'sparkles',
  accentColor = '#D97757',
  tags,
  deliveryType = 'auto',
  warrantyType = 'full_period',
  warrantyDays = 30,
  warrantySummary,
  totalStock,
  stockLabel,
  salesCount = 0,
  riskNotice,
  detailHtml,
  emptyDetailHint,
  faq = [],
  customFields = [],
  priceHeaderLabel,
  specs,
  activeSpecId,
  onSelectSpec,
  fallbackBasePrice = 0,
  fallbackOriginalPrice,
}: ProductPreviewViewProps) {
  const ui = useUiKitI18n();
  const activeSpec = specs.find((s) => s.id === activeSpecId) || specs[0];
  const displayPrice = Number(activeSpec?.price ?? fallbackBasePrice ?? 0);
  const displayOriginalPrice = activeSpec?.originalPrice ?? fallbackOriginalPrice ?? null;

  const normalizedWarranty = normalizeWarrantyType(warrantyType);
  const warrantyUnits =
    Number.isFinite(warrantyDays) && warrantyDays > 0
      ? Math.floor(warrantyDays)
      : defaultWarrantyValue(normalizedWarranty);

  const deliveryMap: Record<string, string> = {
    auto: ui.deliveryAuto,
    api_key: ui.deliveryApiKey,
    manual: ui.deliveryManual,
    preorder: ui.deliveryPreorder,
  };
  const deliveryLabel = deliveryMap[deliveryType] || ui.deliveryAuto;

  const warrantyShortLabel =
    normalizedWarranty === 'none'
      ? ui.warrantyShortNone
      : normalizedWarranty === 'first_login'
        ? fmt(ui.warrantyShortFirstLogin, { hours: warrantyUnits })
        : normalizedWarranty === 'days'
          ? fmt(ui.warrantyShortDays, { days: warrantyUnits })
          : fmt(ui.warrantyShortFull, { days: warrantyUnits });

  const defaultWarrantySummary =
    normalizedWarranty === 'none'
      ? ui.warrantyTplNone
      : normalizedWarranty === 'first_login'
        ? fmt(ui.warrantyTplFirstLogin, { hours: warrantyUnits })
        : normalizedWarranty === 'days'
          ? fmt(ui.warrantyTplDays, { days: warrantyUnits })
          : fmt(ui.warrantyTplFull, { days: warrantyUnits });

  return (
    <div
      className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-5"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <div
        className="px-4 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs"
        style={{
          borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
          backgroundColor: 'var(--accent-soft)',
          color: 'var(--accent)',
        }}
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          {bannerText}
        </span>
        <button
          type="button"
          onClick={onBackToEdit}
          className="text-xs font-semibold underline cursor-pointer whitespace-nowrap"
        >
          {ui.previewBackToEdit}
        </button>
      </div>

      {loading ? (
        <div
          className="py-16 flex flex-col items-center justify-center gap-2 text-xs"
          style={{ color: 'var(--ink-muted)' }}
        >
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          {ui.previewLoadingInfo}
        </div>
      ) : (
        <>
          <div
            className="flex items-center justify-between gap-3 text-xs"
            style={{ color: 'var(--ink-muted)' }}
          >
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span
                className="inline-flex items-center gap-1 font-medium"
                style={{ color: 'var(--ink-secondary)' }}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {ui.previewBackCatalog}
              </span>
              <span>/</span>
              {categoryName && (
                <>
                  <span>{categoryName}</span>
                  <span>/</span>
                </>
              )}
              <span className="truncate max-w-md" style={{ color: 'var(--ink-primary)' }}>
                {title || ui.previewUntitledProduct}
              </span>
            </div>
            <span className="font-mono-num shrink-0">{productId ? `ITEM #${productId}` : 'NEW ITEM'}</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <article className="lg:col-span-7 xl:col-span-8 space-y-5">
              <div className="paper-card rounded-2xl p-5 sm:p-7">
                <div className="flex items-start gap-4">
                  <BrandBadge icon={iconKey} accentColor={accentColor} size="lg" />
                  <div className="min-w-0 flex-1">
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] px-2.5 py-0.5 rounded-md font-medium"
                            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <h1 className="font-editorial text-2xl sm:text-3xl font-semibold leading-snug">
                      {title || ui.previewPleaseAddTitle}
                    </h1>
                    {subtitle?.trim() && (
                      <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                        {subtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t text-center"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {ui.previewDeliveryMethodLabel}
                    </div>
                    <div className="text-sm font-semibold mt-0.5">{deliveryLabel}</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {ui.previewWarrantyAttrLabel}
                    </div>
                    <div
                      className="text-sm font-semibold mt-0.5"
                      style={{ color: warrantyType === 'none' ? 'var(--ink-muted)' : 'var(--success)' }}
                    >
                      {warrantyShortLabel}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {ui.previewStockNowLabel}
                    </div>
                    <div
                      className="text-sm font-mono-num font-semibold mt-0.5"
                      style={{ color: totalStock <= 0 ? 'var(--danger)' : 'var(--success)' }}
                    >
                      {stockLabel || (totalStock > 0 ? ui.previewStockInStock : ui.previewStockRestock)} (
                      {totalStock})
                    </div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                    <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {ui.previewSalesTotalLabel}
                    </div>
                    <div className="text-sm font-mono-num font-semibold mt-0.5">
                      {fmt(ui.previewSalesUnit, { count: salesCount })}
                    </div>
                  </div>
                </div>

                <div
                  className="mt-5 p-4 rounded-2xl border flex items-start gap-3"
                  style={{
                    backgroundColor: warrantyType === 'none' ? 'var(--bg-canvas)' : 'var(--success-soft)',
                    borderColor:
                      warrantyType === 'none'
                        ? 'var(--border-color)'
                        : 'color-mix(in srgb, var(--success) 32%, transparent)',
                  }}
                >
                  {warrantyType === 'none' ? (
                    <ShieldOff className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--ink-muted)' }} />
                  ) : (
                    <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
                  )}
                  <div className="min-w-0">
                    <div
                      className="text-xs font-semibold"
                      style={{ color: warrantyType === 'none' ? 'var(--ink-secondary)' : 'var(--success)' }}
                    >
                      {fmt(ui.previewWarrantyBlockTitle, { label: warrantyShortLabel })}
                    </div>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-primary)' }}>
                      {warrantySummary?.trim() || defaultWarrantySummary}
                    </p>
                  </div>
                </div>

                {riskNotice?.trim() && (
                  <div
                    className="mt-5 p-4 rounded-2xl border flex items-start gap-3"
                    style={{
                      backgroundColor: 'var(--warning-soft)',
                      borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
                    }}
                  >
                    <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
                        {ui.previewRiskBlockTitle}
                      </div>
                      <p
                        className="text-xs mt-1 leading-relaxed whitespace-pre-wrap"
                        style={{ color: 'var(--ink-primary)' }}
                      >
                        {riskNotice}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
                  <div
                    className="text-xs font-semibold uppercase tracking-wider mb-3"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {ui.previewDetailTitle}
                  </div>
                  {detailHtml?.trim() ? (
                    <RichContentRenderer content={detailHtml} className="text-sm leading-relaxed" />
                  ) : (
                    <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
                      {emptyDetailHint || ui.previewEmptyDetailDefault}
                    </p>
                  )}
                </div>
              </div>

              {faq.length > 0 && (
                <div className="paper-card rounded-2xl p-6 space-y-3">
                  <h4 className="font-editorial text-lg font-semibold">{ui.previewFaqTitle}</h4>
                  <div className="space-y-2.5">
                    {faq.map((f, i) => (
                      <div
                        key={`${f.q}-${i}`}
                        className="p-3.5 rounded-xl border"
                        style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                      >
                        <div className="text-xs font-semibold">{f.q}</div>
                        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                          {f.a}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>

            <ProductPreviewAside
              priceHeaderLabel={priceHeaderLabel}
              displayPrice={displayPrice}
              displayOriginalPrice={displayOriginalPrice}
              specs={specs}
              activeSpecId={activeSpecId}
              onSelectSpec={onSelectSpec}
              customFields={customFields}
            />
          </div>
        </>
      )}
    </div>
  );
}
