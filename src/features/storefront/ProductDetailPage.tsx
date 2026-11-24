/**
 * 商品独立详情与结账页容器（基于 TanStack Query v5 管理实时商品、口令解锁、一键复购与拼团场次）
 */

import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AsyncCashierModal } from '../../components/AsyncCashierModal';
import { useI18n } from '../../i18n';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useProductQuery } from '../../queries/storefront.queries';
import type { BootstrapPayload, PaymentIntentInfo, UserProfile } from '../../types';
import { ProductAccessGate } from '../commerce/ProductAccessGate';
import { ProductCheckoutForm } from './ProductCheckoutForm';
import { ProductDetailContent } from './ProductDetailContent';
import { notifyOrderCompletionToast } from './useProductCheckout';

interface ProductDetailPageProps {
  bootstrap: BootstrapPayload | null;
  user: UserProfile | null;
  onBalanceChange: (newBalance: number) => void;
  onRefreshUser: () => void;
  onOpenAuth: () => void;
}

export function ProductDetailPage({
  bootstrap,
  user,
  onBalanceChange,
  onRefreshUser,
  onOpenAuth,
}: ProductDetailPageProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const initialSpecId = (searchParams.get('spec') || '').trim();
  const isRebuy = searchParams.get('rebuy') === '1';
  const initialGroupBuyCode = (searchParams.get('gb') || '').trim().toUpperCase();
  const [accessCode, setAccessCode] = useState(() => (searchParams.get('code') || '').trim());
  const [attemptedUnlock, setAttemptedUnlock] = useState(false);

  const qc = useQueryClient();
  const { locale, messages: t } = useI18n();
  const sf = useStorefrontI18n();
  const cm = useCommerceI18n();

  const productQuery = useProductQuery(id, accessCode);
  const product = productQuery.data?.product ?? null;
  const accessLocked = Boolean(productQuery.data?.access_locked);
  const openGroupBuys = productQuery.data?.open_group_buys ?? [];

  const [activePaymentIntent, setActivePaymentIntent] = useState<PaymentIntentInfo | null>(null);

  if (productQuery.isLoading) {
    return (
      <div
        className="max-w-6xl mx-auto px-4 py-24 flex flex-col items-center gap-3"
        style={{ color: 'var(--ink-muted)' }}
      >
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
        <span className="text-sm">{sf.loadingProduct}</span>
      </div>
    );
  }

  if (productQuery.isError || !product) {
    const errText = productQuery.error instanceof Error ? productQuery.error.message : sf.productNotFound;
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="font-editorial text-2xl font-semibold">{errText}</h1>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full text-xs font-medium no-underline"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t.backToCatalog}
        </Link>
      </div>
    );
  }

  if (accessLocked) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-10">
        <ProductAccessGate
          productTitle={product.title}
          loading={productQuery.isFetching}
          hasAttemptedWrong={attemptedUnlock && Boolean(accessCode)}
          onUnlock={(code) => {
            setAttemptedUnlock(true);
            setAccessCode(code);
          }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* 面包屑导航 */}
      <div
        className="flex items-center justify-between gap-3 mb-6 text-xs"
        style={{ color: 'var(--ink-muted)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 font-medium hover:underline no-underline"
            style={{ color: 'var(--ink-secondary)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t.backToCatalog}
          </Link>
          <span>/</span>
          {product.category && (
            <>
              <span>
                {locale === 'en' && product.category.name_en
                  ? product.category.name_en
                  : product.category.name}
              </span>
              <span>/</span>
            </>
          )}
          <span className="truncate max-w-[260px] sm:max-w-md" style={{ color: 'var(--ink-primary)' }}>
            {product.title}
          </span>
        </div>
        <span className="font-mono-num hidden sm:inline">ITEM #{product.id}</span>
      </div>

      {isRebuy && (
        <div
          className="mb-5 px-4 py-3 rounded-2xl border flex items-center gap-2 text-xs font-medium"
          style={{
            borderColor: 'var(--success)',
            backgroundColor: 'var(--success-soft)',
            color: 'var(--success)',
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span>{cm.rebuyBannerTitle}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        <ProductDetailContent product={product} />
        <ProductCheckoutForm
          product={product}
          bootstrap={bootstrap}
          user={user}
          initialSpecId={initialSpecId}
          accessCode={accessCode}
          openGroupBuys={openGroupBuys}
          initialGroupBuyCode={initialGroupBuyCode}
          onOpenAuth={onOpenAuth}
          onDelivered={(_order, balance) => {
            if (typeof balance === 'number') onBalanceChange(balance);
            onRefreshUser();
            void productQuery.refetch();
          }}
          onRequirePayment={setActivePaymentIntent}
        />
      </div>

      <AsyncCashierModal
        intent={activePaymentIntent}
        onClose={() => setActivePaymentIntent(null)}
        onPaid={({ order, balance }) => {
          if (order) {
            notifyOrderCompletionToast(order, {
              isSignedIn: Boolean(user),
              sf,
            });
          }
          if (typeof balance === 'number') onBalanceChange(balance);
          setActivePaymentIntent(null);
          onRefreshUser();
          void qc.invalidateQueries({ queryKey: ['account'] });
          void productQuery.refetch();
        }}
      />
    </div>
  );
}
