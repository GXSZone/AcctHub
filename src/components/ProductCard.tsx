import { BUSINESS_LIMITS } from '@shared/constants/limits';
import { resolveLocalizedField } from '@shared/domain/i18n';
import { discountDisplay, formatYuanPrice } from '@shared/domain/money';
import { ArrowUpRight, KeyRound, ShieldCheck, Users, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmt, useI18n } from '../i18n';
import { useCommerceI18n } from '../i18n/namespaces/commerce';
import { useExtensionsI18n } from '../i18n/namespaces/extensions';
import { useStorefrontI18n } from '../i18n/namespaces/storefront';
import { classifyProductTagTone } from '../i18n/namespaces/storefront/tag-filters';
import { useDisplayCurrency } from '../lib/currency';
import type { AgentTierInfo, Product } from '../types';
import { BrandBadge } from './BrandIcon';

interface ProductCardProps {
  product: Product;
  viewMode: 'list' | 'grid';
  showWholesale?: boolean;
  agentRate?: number | null;
  agentTier?: AgentTierInfo | null;
}

function getTagStyle(tag: string) {
  const tone = classifyProductTagTone(tag);
  if (tone === 'success') {
    return { bg: 'var(--success-soft)', color: 'var(--success)' };
  }
  if (tone === 'accent') {
    return { bg: 'var(--accent-soft)', color: 'var(--accent)' };
  }
  return { bg: 'var(--bg-subtle)', color: 'var(--ink-secondary)' };
}

function SeatDots({ total, used, tooltip }: { total: number; used: number; tooltip: string }) {
  if (total <= 0) return null;
  const visibleCount = Math.min(total, BUSINESS_LIMITS.MAX_PRODUCT_SEATS);
  const visibleUsed = Math.round((Math.min(used, total) / total) * visibleCount);
  return (
    <span className="inline-flex items-center gap-1" title={tooltip}>
      {Array.from({ length: visibleCount }).map((_, i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full inline-block"
          style={{
            backgroundColor: i < visibleUsed ? 'var(--border-strong)' : 'var(--success)',
          }}
        />
      ))}
    </span>
  );
}

export function ProductCard({ product, viewMode, showWholesale, agentTier, agentRate }: ProductCardProps) {
  const { locale, messages: t } = useI18n();
  const sf = useStorefrontI18n();
  const cm = useCommerceI18n();
  const pc = useExtensionsI18n();
  const { currency, formatMoney } = useDisplayCurrency();
  const formatCardPrice = (cny: number) => (currency === 'CNY' ? formatYuanPrice(cny) : formatMoney(cny));
  const detailUrl = `/item/${product.id}`;
  const isFlashActive = product.flash_sale?.status === 'active';
  const isBundle = Boolean(product.bundle_items && product.bundle_items.length > 0);
  const isGroupBuy = Boolean(product.group_buy?.enabled);
  const hasMemberPrice = Boolean(product.member_price && product.member_price < product.price);
  const title = resolveLocalizedField({
    locale,
    baseZh: product.title,
    legacyEn: product.title_en,
    translationsJson: product.translations_json,
    field: 'title',
  });
  const subtitle = resolveLocalizedField({
    locale,
    baseZh: product.subtitle,
    legacyEn: product.subtitle_en,
    translationsJson: product.translations_json,
    field: 'subtitle',
  });
  const rate = agentRate ?? agentTier?.discount_rate;
  const tierPrice =
    rate === undefined
      ? product.wholesale_price
      : Number(((product.specs[0]?.base_price ?? product.base_price) * rate).toFixed(2));
  const tierLabel = agentTier
    ? fmt(sf.cardTierDiscount, {
        tier: agentTier.name.split(' ')[0],
        ...discountDisplay(agentTier.discount_rate),
      })
    : sf.cardAgentWholesale;

  const isOut = product.available_stock <= 0;
  const isPreorder = product.delivery_type === 'preorder';
  const stockColor = isOut
    ? isPreorder
      ? 'var(--warning)'
      : 'var(--danger)'
    : product.available_stock <= 5
      ? 'var(--accent)'
      : 'var(--success)';
  const stockBg = isOut ? (isPreorder ? 'var(--warning-soft)' : 'var(--danger-soft)') : 'var(--success-soft)';
  const ctaLabel = isOut ? (isPreorder ? t.actionPreorder : sf.cardOutOfStockBtn) : t.actionBuy;

  if (viewMode === 'grid') {
    return (
      <Link
        to={detailUrl}
        className="group paper-card paper-card-hover rounded-2xl p-5 flex flex-col justify-between gap-4 no-underline"
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <BrandBadge icon={product.icon_key} accentColor={product.accent_color} size="md" />
            <div className="flex items-center gap-1.5">
              {product.stock_mode === 'seats' && (
                <SeatDots
                  total={product.seat_total}
                  used={product.seat_used}
                  tooltip={fmt(sf.cardSeatTooltip, { used: product.seat_used, total: product.seat_total })}
                />
              )}
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: stockBg,
                  color: stockColor,
                }}
              >
                {product.stock_label}
              </span>
            </div>
          </div>

          <h3
            className="font-editorial text-[17px] font-semibold mt-3.5 leading-snug group-hover:underline decoration-1 underline-offset-4"
            style={{ color: 'var(--ink-primary)' }}
          >
            {title}
          </h3>
          {subtitle && (
            <p
              className="text-xs mt-1.5 line-clamp-2 leading-relaxed"
              style={{ color: 'var(--ink-secondary)' }}
            >
              {subtitle}
            </p>
          )}

          <div className="flex flex-wrap gap-1.5 mt-3">
            {isFlashActive && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {cm.badgeFlashSale}
              </span>
            )}
            {isBundle && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {cm.badgeBundle}
              </span>
            )}
            {isGroupBuy && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
              >
                {cm.badgeGroupBuy}
              </span>
            )}
            {product.tags.slice(0, 4).map((tag) => {
              const st = getTagStyle(tag);
              return (
                <span
                  key={tag}
                  className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                  style={{ backgroundColor: st.bg, color: st.color }}
                >
                  {tag}
                </span>
              );
            })}
          </div>
        </div>

        <div
          className="pt-3.5 border-t flex items-end justify-between gap-2"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono-num text-xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {formatCardPrice(product.price)}
              </span>
              {product.original_price && product.original_price > product.price && (
                <span className="font-mono-num text-xs line-through" style={{ color: 'var(--ink-muted)' }}>
                  {formatCardPrice(product.original_price)}
                </span>
              )}
            </div>
            {hasMemberPrice && product.member_price && (
              <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--success)' }}>
                {pc.memberPriceBadge} {formatCardPrice(product.member_price)}
              </div>
            )}
            {showWholesale && (
              <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--accent)' }}>
                {tierLabel} {formatCardPrice(tierPrice)}
              </div>
            )}
          </div>

          <span
            className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              backgroundColor: isOut && !isPreorder ? 'var(--bg-subtle)' : 'var(--ink-primary)',
              color: isOut && !isPreorder ? 'var(--ink-muted)' : 'var(--bg-canvas)',
            }}
          >
            {ctaLabel}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </Link>
    );
  }

  // 列表行视图（Editorial List Row View）
  return (
    <Link
      to={detailUrl}
      className="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 border-b last:border-b-0 transition-colors no-underline"
      style={{ borderColor: 'var(--border-color)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--bg-canvas)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* Left: Icon + Title + Subtitle + Tags */}
      <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
        <div className="mt-0.5 sm:mt-0">
          <BrandBadge icon={product.icon_key} accentColor={product.accent_color} size="md" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="text-[15px] font-semibold leading-snug group-hover:underline decoration-1 underline-offset-4 truncate max-w-full"
              style={{ color: 'var(--ink-primary)' }}
            >
              {title}
            </h3>
            {product.delivery_type === 'api_key' && (
              <KeyRound className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {isFlashActive && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                {cm.badgeFlashSale}
              </span>
            )}
            {isBundle && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {cm.badgeBundle}
              </span>
            )}
            {isGroupBuy && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
              >
                {cm.badgeGroupBuy}
              </span>
            )}
            {product.tags.map((tag) => {
              const st = getTagStyle(tag);
              return (
                <span
                  key={tag}
                  className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                  style={{ backgroundColor: st.bg, color: st.color }}
                >
                  {tag}
                </span>
              );
            })}
            {product.stock_mode === 'seats' && (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] ml-1"
                style={{ color: 'var(--ink-muted)' }}
              >
                <Users className="w-3 h-3" />
                <SeatDots
                  total={product.seat_total}
                  used={product.seat_used}
                  tooltip={fmt(sf.cardSeatTooltip, { used: product.seat_used, total: product.seat_total })}
                />
              </span>
            )}
            {product.delivery_type === 'auto' && (
              <span
                className="hidden xl:inline-flex items-center gap-1 text-[11px] ml-1"
                style={{ color: 'var(--ink-muted)' }}
              >
                <Zap className="w-3 h-3" style={{ color: 'var(--success)' }} />
                {fmt(sf.cardSoldCount, { count: product.sales_count })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Price + Stock + Action CTA */}
      <div className="flex items-center justify-between sm:justify-end gap-5 sm:gap-7 shrink-0 pl-[54px] sm:pl-0">
        <div className="text-left sm:text-right min-w-[78px]">
          <div className="font-mono-num text-[16px] font-semibold" style={{ color: 'var(--ink-primary)' }}>
            {formatCardPrice(product.price)}
          </div>
          {hasMemberPrice && product.member_price && !showWholesale && (
            <div className="text-[10.5px] font-mono-num" style={{ color: 'var(--success)' }}>
              {pc.memberPriceBadge} {formatCardPrice(product.member_price)}
            </div>
          )}
          {showWholesale ? (
            <div className="text-[10.5px] font-mono-num" style={{ color: 'var(--accent)' }}>
              {tierLabel} {formatCardPrice(tierPrice)}
            </div>
          ) : (
            product.original_price &&
            product.original_price > product.price && (
              <div className="font-mono-num text-[11px] line-through" style={{ color: 'var(--ink-muted)' }}>
                {formatCardPrice(product.original_price)}
              </div>
            )
          )}
        </div>

        <div className="text-center min-w-[64px]">
          <span
            className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
            style={{
              backgroundColor: isOut ? stockBg : 'var(--bg-subtle)',
              color: stockColor,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stockColor }} />
            {product.stock_label}
          </span>
        </div>

        <span
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all group-hover:translate-x-0.5"
          style={{
            backgroundColor: isOut ? 'var(--bg-subtle)' : 'var(--accent)',
            color: isOut ? (isPreorder ? 'var(--ink-primary)' : 'var(--ink-muted)') : '#FAF9F5',
          }}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          {ctaLabel}
        </span>
      </div>
    </Link>
  );
}
