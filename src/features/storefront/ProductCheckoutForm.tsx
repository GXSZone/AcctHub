/**
 * 商品详情页右侧吸顶下单与收银台配置表单
 */

import type { PublicGroupBuySessionDto } from '@shared/contracts/commerce.contract';
import { resolveLocalizedField } from '@shared/domain/i18n';
import { discountDisplay, formatYuanPrice } from '@shared/domain/money';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { openConfirm } from '../../components/ConfirmDialog';
import { DemoCashierModal } from '../../components/DemoCashierModal';
import { TurnstileWidget } from '../../components/TurnstileWidget';
import { fmt, useI18n } from '../../i18n';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';
import { useExtensionsI18n } from '../../i18n/namespaces/extensions';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useDisplayCurrency } from '../../lib/currency';
import { toast } from '../../lib/toast';
import type { BootstrapPayload, OrderRecord, PaymentIntentInfo, Product, UserProfile } from '../../types';
import { CardSelectionPicker } from '../commerce/CardSelectionPicker';
import { GroupBuySelector } from '../commerce/ProductCommerceWidgets';
import { ProductBulkPromoBox } from './ProductBulkPromoBox';
import { ProductPaymentSection } from './ProductPaymentSection';
import { useProductCheckout } from './useProductCheckout';

interface ProductCheckoutFormProps {
  product: Product;
  bootstrap: BootstrapPayload | null;
  user: UserProfile | null;
  initialSpecId?: string;
  accessCode?: string;
  openGroupBuys?: PublicGroupBuySessionDto[];
  initialGroupBuyCode?: string;
  onOpenAuth: () => void;
  onDelivered: (order: OrderRecord, balance?: number) => void;
  onRequirePayment: (intent: PaymentIntentInfo) => void;
}

export function ProductCheckoutForm({
  product,
  bootstrap,
  user,
  initialSpecId,
  accessCode,
  openGroupBuys = [],
  initialGroupBuyCode,
  onOpenAuth,
  onDelivered,
  onRequirePayment,
}: ProductCheckoutFormProps) {
  const { locale } = useI18n();
  const sf = useStorefrontI18n();
  const cm = useCommerceI18n();
  const pc = useExtensionsI18n();
  const rf = useRiskControlI18n();
  const { currency, formatMoney } = useDisplayCurrency();
  const fmtPrice = (cny: number) => (currency === 'CNY' ? formatYuanPrice(cny) : formatMoney(cny));
  const c = useProductCheckout({
    product,
    bootstrap,
    user,
    initialSpecId,
    accessCode,
    initialGroupBuyCode,
    onDelivered,
    onRequirePayment,
  });
  const [demoCashierOpen, setDemoCashierOpen] = useState(false);
  const productRequiresLogin = !user && (Boolean(product.require_login) || c.groupBuyMode !== 'regular');
  const guestRequiresLogin = !user && (bootstrap?.mail_delivery_enabled === false || productRequiresLogin);

  const handleFormSubmit = (e: React.FormEvent) => {
    if (guestRequiresLogin) {
      e.preventDefault();
      toast.warning(
        c.groupBuyMode !== 'regular'
          ? cm.groupBuyLoginHint
          : productRequiresLogin
            ? rf.prodLoginOnlyHint
            : sf.guestLoginRequiredToast
      );
      onOpenAuth();
      return;
    }
    if (
      __ACCTHUB_SANDBOX__ &&
      c.paymentMethod === 'demo_instant' &&
      c.totalAmount > 0 &&
      c.activeSpecStock >= c.quantity
    ) {
      e.preventDefault();
      setDemoCashierOpen(true);
      return;
    }
    void c.handleCheckout(e);
  };

  return (
    <aside className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20">
      <form onSubmit={handleFormSubmit} className="paper-card rounded-2xl p-6 space-y-5">
        <div
          className="flex items-end justify-between gap-2 pb-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="text-[11px] font-medium" style={{ color: 'var(--ink-muted)' }}>
              {c.userIsAgent
                ? c.agentTier
                  ? fmt(sf.cardTierDiscount, {
                      tier: c.agentTier.name,
                      ...discountDisplay(c.agentTier.discount_rate),
                    })
                  : sf.agentPriceLabel
                : sf.specUnitPriceLabel}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-mono-num text-3xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
                {fmtPrice(c.unitPrice)}
              </span>
              {c.activeSpec?.original_price && c.activeSpec.original_price > c.unitPrice && (
                <span className="font-mono-num text-sm line-through" style={{ color: 'var(--ink-muted)' }}>
                  {fmtPrice(c.activeSpec.original_price)}
                </span>
              )}
            </div>
            {product.member_price && product.member_price < c.retailUnitPrice && (
              <div className="text-[11px] font-medium mt-1" style={{ color: 'var(--success)' }}>
                {user ? (
                  pc.memberPriceActiveHint
                ) : (
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="underline cursor-pointer font-semibold"
                    style={{ color: 'var(--success)' }}
                  >
                    {fmt(pc.memberPriceLoginHint, { price: fmtPrice(product.member_price) })}
                  </button>
                )}
              </div>
            )}
          </div>
          <span
            className="text-xs font-medium px-2.5 py-1 rounded-full font-mono-num"
            style={{
              backgroundColor: c.activeSpecStock > 0 ? 'var(--success-soft)' : 'var(--danger-soft)',
              color: c.activeSpecStock > 0 ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {c.activeSpecStock > 0 ? `${sf.inStockPrefix} ${c.activeSpecStock}` : sf.outOfStockBadge}
          </span>
        </div>

        {/* 规格选择器 */}
        {product.specs.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-2">{sf.selectSpecTitle}</div>
            <div className="space-y-2">
              {product.specs.map((spec) => {
                const selected = spec.id === c.activeSpec?.id;
                const specCards =
                  product.stock_mode === 'cards' && product.delivery_type !== 'api_key'
                    ? (product.spec_stock?.[spec.id] ??
                      (product.specs.length <= 1 ? (product.spec_stock?.default ?? 0) : 0))
                    : undefined;
                const soldOut = typeof specCards === 'number' && specCards <= 0;
                return (
                  <button
                    key={spec.id}
                    type="button"
                    onClick={() => c.setSelectedSpecId(spec.id)}
                    className="w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer"
                    style={{
                      borderColor: selected ? 'var(--accent)' : 'var(--border-color)',
                      backgroundColor: selected ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                      opacity: soldOut ? 0.6 : 1,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">
                        {resolveLocalizedField({
                          locale,
                          baseZh: spec.name,
                          legacyEn: spec.name_en,
                          field: 'title',
                        })}
                      </span>
                      <span className="font-mono-num text-sm font-semibold shrink-0">
                        {fmtPrice(spec.price)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                        {spec.description || spec.badge || sf.instantDelivery}
                      </span>
                      {typeof specCards === 'number' && (
                        <span
                          className="text-[10.5px] font-mono-num font-medium"
                          style={{ color: soldOut ? 'var(--danger)' : 'var(--success)' }}
                        >
                          {soldOut ? sf.soldOutLabel : `${sf.inStockPrefix} ${specCards}`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 拼团合租模式与公开拼团选择 */}
        <GroupBuySelector
          config={product.group_buy}
          openSessions={openGroupBuys}
          mode={c.groupBuyMode}
          selectedCode={c.groupBuyCode}
          isSignedIn={Boolean(user)}
          onSelectMode={c.selectGroupBuyMode}
        />

        {/* 卡密预选选号器 */}
        {c.groupBuyMode === 'regular' && (
          <CardSelectionPicker
            productId={product.id}
            specId={c.activeSpec?.id || 'default'}
            enabled={Boolean(product.allow_card_selection)}
            selectedCardId={c.selectedCardId}
            onSelect={c.selectCard}
          />
        )}

        {/* 购买数量 */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold">{sf.quantityTitle}</span>
            <span className="ml-2 text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
              {c.minBuyQty > 1 ? `${fmt(rf.prodMinQtyHint, { min: c.minBuyQty })} · ` : ''}(max {c.maxBuyQty})
            </span>
          </div>
          <div
            className="inline-flex items-center rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <button
              type="button"
              disabled={c.quantity <= c.minBuyQty}
              onClick={() => c.setQuantity((q) => Math.max(c.minBuyQty, q - 1))}
              className="px-3 py-1.5 cursor-pointer disabled:opacity-35"
              aria-label={sf.decQtyAria}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="px-4 font-mono-num text-sm font-semibold">{c.quantity}</span>
            <button
              type="button"
              disabled={c.quantity >= c.maxBuyQty || c.activeSpecStock <= 0}
              onClick={() => c.setQuantity((q) => Math.min(c.maxBuyQty, q + 1))}
              className="px-3 py-1.5 cursor-pointer disabled:opacity-35"
              aria-label={sf.incQtyAria}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <ProductBulkPromoBox
          maxBuyQty={c.maxBuyQty}
          tiers={c.bulkDisplayTiers}
          quantity={c.quantity}
          appliedBulkTier={
            c.bulkDisplayTiers.find((tier) => tier.min_qty === c.unitEval.appliedBulkTier?.min_qty) ?? null
          }
          nextBulkTier={c.unitEval.nextBulkTier}
          user={user}
          usePromoBalance={c.usePromoBalance}
          promoUsedPreview={c.promoUsedPreview}
          onSelectQty={(q) => c.setQuantity(Math.min(c.maxBuyQty, Math.max(1, q)))}
          onTogglePromoBalance={c.setUsePromoBalance}
        />
        {c.canRecover && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-xl border px-4 py-2 text-sm"
              disabled={c.submitting}
              onClick={() => void c.handleRecoverCheckout()}
            >
              {sf.checkoutRestore}
            </button>
            <button
              type="button"
              className="px-2 py-2 text-sm underline"
              disabled={c.submitting}
              onClick={async () => {
                if (
                  await openConfirm({
                    title: sf.checkoutStartNew,
                    description: sf.checkoutStartNewConfirm,
                    confirmLabel: sf.checkoutStartNew,
                    tone: 'accent',
                  })
                ) {
                  c.startNewCheckout();
                }
              }}
            >
              {sf.checkoutStartNew}
            </button>
          </div>
        )}

        {/* 动态自定义表单字段 */}
        {product.custom_fields.map((field) => (
          <div key={field.key}>
            <label htmlFor={`cf-${field.key}`} className="block text-xs font-semibold mb-1">
              {resolveLocalizedField({
                locale,
                baseZh: field.label,
                legacyEn: field.label_en,
                field: 'title',
              })}
              {field.required && <span style={{ color: 'var(--accent)' }}> *</span>}
            </label>
            <input
              id={`cf-${field.key}`}
              type={field.type === 'email' ? 'email' : 'text'}
              required={field.required}
              placeholder={field.placeholder}
              value={c.customInputs[field.key] || ''}
              onChange={(e) => c.setCustomInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
              className="acct-input"
            />
          </div>
        ))}

        {/* 收货与查单信息 */}
        <div>
          <label htmlFor="order-email" className="block text-xs font-semibold mb-1">
            {sf.contactEmailLabel} <span style={{ color: 'var(--accent)' }}>*</span>
          </label>
          <span
            id="order-email-hint"
            className="block text-[11px] mb-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            {sf.contactEmailHint}
          </span>
          <input
            id="order-email"
            type="email"
            required
            autoComplete="email"
            value={c.contactEmail}
            onChange={(e) => c.setContactEmail(e.target.value)}
            aria-describedby="order-email-hint"
            data-error="order-email-err"
            placeholder="you@example.com"
            className="acct-input"
          />
          <div id="order-email-err" className="acct-field-error">
            <span role="img" aria-label={sf.errIconAria}>
              !
            </span>{' '}
            {sf.contactEmailInvalid}
          </div>
        </div>

        <div>
          <label htmlFor="order-pass" className="block text-xs font-semibold mb-1">
            {sf.queryPasswordLabel}
          </label>
          <input
            id="order-pass"
            type="text"
            value={c.queryPassword}
            onChange={(e) => c.setQueryPassword(e.target.value)}
            placeholder={sf.queryPasswordPlaceholder}
            className="acct-input"
          />
        </div>

        <ProductPaymentSection
          availablePayments={c.availablePayments}
          paymentMethod={c.paymentMethod}
          user={user}
          agentTier={c.agentTier}
          couponInput={c.couponInput}
          appliedCoupon={c.appliedCoupon}
          couponError={c.couponError}
          validatingCoupon={c.validatingCoupon}
          retailUnitPrice={c.retailUnitPrice}
          quantity={c.quantity}
          totalSaved={c.totalSaved}
          promoUsedPreview={c.promoUsedPreview}
          totalAmount={c.totalAmount}
          paymentFeeRatePct={c.paymentFeeRatePct}
          paymentFeeAmount={c.paymentFeeAmount}
          payableWithFee={c.payableWithFee}
          balanceInsufficient={Boolean(c.balanceInsufficient)}
          submitError={c.submitError}
          guestRequiresLogin={guestRequiresLogin}
          guestLoginReason={productRequiresLogin ? rf.prodLoginOnlyHint : undefined}
          activeSpecStock={c.activeSpecStock}
          restockEmail={c.restockEmail}
          restockDoneMsg={c.restockDoneMsg}
          restockLoading={c.restockLoading}
          submitting={c.submitting}
          onSelectPayment={c.setPaymentMethod}
          onOpenAuth={onOpenAuth}
          onCouponInputChange={(val) => {
            c.setCouponInput(val);
            c.setCouponError('');
          }}
          onApplyCoupon={() => void c.handleApplyCoupon()}
          onRestockEmailChange={c.setRestockEmail}
          onRestockSubscribe={() => void c.handleRestockSubscribe()}
        />
        {!user && c.activeSpecStock > 0 && (
          <TurnstileWidget
            enabled={bootstrap?.security?.turnstile_enabled}
            siteKey={bootstrap?.security?.turnstile_site_key}
            action="order_create"
            resetSignal={c.turnstileReset}
            onToken={c.setTurnstileToken}
          />
        )}
      </form>
      {__ACCTHUB_SANDBOX__ && (
        <DemoCashierModal
          open={demoCashierOpen}
          amount={c.totalAmount}
          productTitle={product.title}
          specName={c.activeSpec?.name || ''}
          quantity={c.quantity}
          contactEmail={c.contactEmail}
          submitting={c.submitting}
          onCancel={() => {
            if (!c.submitting) setDemoCashierOpen(false);
          }}
          onConfirmPay={() => {
            void c.handleCheckout().finally(() => setDemoCashierOpen(false));
          }}
        />
      )}
    </aside>
  );
}
