/**
 * 商品详情页左侧主体内容区：核心指标、售后质保、风控提示、席位视图、API 算力测算器、富文本详情与 FAQ
 */

import { BUSINESS_LIMITS } from '@shared/constants/limits';
import { resolveLocalizedField } from '@shared/domain/i18n';
import { Cpu, HelpCircle, ShieldAlert, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { useState } from 'react';
import { BrandBadge } from '../../components/BrandIcon';
import { RichContentRenderer } from '../../components/RichContentRenderer';
import { formatWarrantyTypeShort } from '../../components/TicketOrderCard';
import { fmt, useI18n } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useDisplayCurrency } from '../../lib/currency';
import type { Product } from '../../types';
import { FlashSaleBanner } from '../commerce/FlashSaleBanner';
import { BundleItemsBox } from '../commerce/ProductCommerceWidgets';

interface ProductDetailContentProps {
  product: Product;
}

export function ProductDetailContent({ product }: ProductDetailContentProps) {
  const { locale } = useI18n();
  const sf = useStorefrontI18n();
  const { formatMoney } = useDisplayCurrency();
  const [monthlyMillions, setMonthlyMillions] = useState(12);
  const officialApiCost = Number((monthlyMillions * 9.5).toFixed(0));
  const poolApiCost = Number((officialApiCost * 0.52).toFixed(0));
  const displayTitle = resolveLocalizedField({
    locale,
    baseZh: product.title,
    legacyEn: product.title_en,
    translationsJson: product.translations_json,
    field: 'title',
  });
  const displaySubtitle = resolveLocalizedField({
    locale,
    baseZh: product.subtitle,
    legacyEn: product.subtitle_en,
    translationsJson: product.translations_json,
    field: 'subtitle',
  });

  return (
    <article className="lg:col-span-7 xl:col-span-8 space-y-6">
      <FlashSaleBanner flashSale={product.flash_sale} />
      <div className="paper-card rounded-2xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <BrandBadge icon={product.icon_key} accentColor={product.accent_color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[11px] px-2.5 py-0.5 rounded-md font-medium"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-semibold leading-snug">{displayTitle}</h1>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {displaySubtitle}
            </p>
          </div>
        </div>

        {/* 核心属性指标栏 */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t text-center"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sf.deliveryMethod}
            </div>
            <div className="text-sm font-semibold mt-0.5">
              {product.delivery_type === 'api_key'
                ? sf.deliveryApiKey
                : product.delivery_type === 'manual'
                  ? sf.deliveryManual
                  : sf.deliveryAutoCard}
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sf.warrantyAttr}
            </div>
            <div
              className="text-sm font-semibold mt-0.5"
              style={{ color: product.warranty_type === 'none' ? 'var(--ink-muted)' : 'var(--success)' }}
            >
              {formatWarrantyTypeShort(product.warranty_type, product.warranty_days)}
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sf.liveStock}
            </div>
            <div
              className="text-sm font-mono-num font-semibold mt-0.5"
              style={{ color: product.available_stock <= 0 ? 'var(--danger)' : 'var(--success)' }}
            >
              {product.stock_label} ({product.available_stock})
            </div>
          </div>
          <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
            <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              {sf.totalDelivered}
            </div>
            <div className="text-sm font-mono-num font-semibold mt-0.5">
              {product.sales_count} {sf.salesUnit}
            </div>
          </div>
        </div>

        {/* 组合套餐子商品清单 */}
        <BundleItemsBox items={product.bundle_items} />

        {/* 售后质保说明横幅 */}
        <div
          className="mt-5 p-4 rounded-2xl border flex items-start gap-3"
          style={{
            backgroundColor: product.warranty_type === 'none' ? 'var(--bg-canvas)' : 'var(--success-soft)',
            borderColor:
              product.warranty_type === 'none'
                ? 'var(--border-color)'
                : 'color-mix(in srgb, var(--success) 32%, transparent)',
          }}
        >
          {product.warranty_type === 'none' ? (
            <ShieldOff className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--ink-muted)' }} />
          ) : (
            <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
          )}
          <div className="min-w-0">
            <span
              className="text-xs font-semibold"
              style={{ color: product.warranty_type === 'none' ? 'var(--ink-secondary)' : 'var(--success)' }}
            >
              {sf.warrantyTitlePrefix} ·{' '}
              {formatWarrantyTypeShort(product.warranty_type, product.warranty_days)}
            </span>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-primary)' }}>
              {product.warranty_summary ||
                (product.warranty_type === 'none' ? sf.warrantyNoneDefault : sf.warrantyAutoDefault)}
            </p>
          </div>
        </div>

        {/* 风控提示卡片 */}
        {product.risk_notice && (
          <div
            className="mt-6 p-4 rounded-2xl border flex items-start gap-3"
            style={{
              backgroundColor: 'var(--warning-soft)',
              borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
            }}
          >
            <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--warning)' }} />
            <div>
              <div className="text-xs font-semibold" style={{ color: 'var(--warning)' }}>
                {sf.riskNoticeTitle}
              </div>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-primary)' }}>
                {product.risk_notice}
              </p>
            </div>
          </div>
        )}

        {/* 精品车队实时席位视图 */}
        {product.stock_mode === 'seats' && product.seat_total > 0 && (
          <div
            className="mt-6 p-5 rounded-2xl border"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Users className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                {sf.fleetSeatsTitle}
              </div>
              <span className="text-xs font-mono-num" style={{ color: 'var(--success)' }}>
                {fmt(sf.fleetSeatsAvail, {
                  avail: Math.max(0, product.seat_total - product.seat_used),
                  total: product.seat_total,
                })}
              </span>
            </div>
            {product.seat_total <= BUSINESS_LIMITS.MAX_PRODUCT_SEATS && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {Array.from({ length: product.seat_total }).map((_, idx) => {
                  const taken = idx < product.seat_used;
                  return (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border text-center"
                      style={{
                        borderColor: taken ? 'var(--border-color)' : 'var(--success)',
                        backgroundColor: taken ? 'var(--bg-subtle)' : 'var(--success-soft)',
                      }}
                    >
                      <div className="font-mono-num text-xs font-semibold">
                        {fmt(sf.seatLabel, { index: idx + 1 })}
                      </div>
                      <div
                        className="text-[11px] mt-1 font-medium"
                        style={{ color: taken ? 'var(--ink-muted)' : 'var(--success)' }}
                      >
                        {taken ? sf.seatTaken : sf.seatAvailable}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* API 算力成本交互测算器 */}
        {product.delivery_type === 'api_key' && (
          <div
            className="mt-6 p-5 rounded-2xl border"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Cpu className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                {sf.apiCalcTitle}
              </div>
              <span className="text-xs font-mono-num font-semibold" style={{ color: 'var(--accent)' }}>
                {fmt(sf.apiCalcMonthly, { millions: monthlyMillions })}
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={100}
              step={2}
              value={monthlyMillions}
              onChange={(e) => setMonthlyMillions(Number(e.target.value))}
              className="w-full cursor-pointer"
              aria-label={sf.apiCalcSliderAria}
            />
            <div className="grid grid-cols-3 gap-3 mt-4 text-xs">
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <div style={{ color: 'var(--ink-muted)' }}>{sf.apiCalcOfficial}</div>
                <div className="font-mono-num text-base font-semibold mt-0.5 line-through">
                  {formatMoney(officialApiCost)}
                </div>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--accent-soft)' }}>
                <div style={{ color: 'var(--accent)' }}>{sf.apiCalcHubPool}</div>
                <div
                  className="font-mono-num text-base font-semibold mt-0.5"
                  style={{ color: 'var(--accent)' }}
                >
                  {formatMoney(poolApiCost)}
                </div>
              </div>
              <div className="p-3 rounded-xl" style={{ backgroundColor: 'var(--success-soft)' }}>
                <div style={{ color: 'var(--success)' }}>{sf.apiCalcSaved}</div>
                <div
                  className="font-mono-num text-base font-semibold mt-0.5"
                  style={{ color: 'var(--success)' }}
                >
                  {formatMoney(officialApiCost - poolApiCost)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 图文详情正文 */}
        <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-color)' }}>
          {product.summary_markdown && (
            <p
              className="font-editorial text-lg leading-relaxed mb-5 pb-4 border-b"
              style={{ color: 'var(--ink-primary)', borderColor: 'var(--border-color)' }}
            >
              {product.summary_markdown}
            </p>
          )}
          <RichContentRenderer content={product.detail_markdown} />
        </div>
      </div>

      {/* 常见问题 */}
      {product.faq.length > 0 && (
        <div className="paper-card rounded-2xl p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4">
            <HelpCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="font-editorial text-xl font-semibold">{sf.faqTitle}</h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
            {product.faq.map((item, idx) => (
              <details key={idx} className="py-3.5 group" open={idx === 0}>
                <summary className="text-sm font-semibold cursor-pointer list-none flex items-center justify-between gap-2">
                  <span>{item.q}</span>
                  <span className="text-xs font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                    {sf.expandLabel}
                  </span>
                </summary>
                <p
                  className="text-xs sm:text-[13px] mt-2.5 leading-relaxed"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
