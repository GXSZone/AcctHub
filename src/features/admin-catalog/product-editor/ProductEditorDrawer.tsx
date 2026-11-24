/**
 * 商品全功能滑出式编辑器主壳（编辑模式 + 主站整页实时预览 + AI 优化 + 防亏拦截）
 */

import { discountDisplay } from '@shared/domain/money';
import { CheckCircle2, Loader2, Save, X } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { storefrontApi } from '../../../api/storefront.api';
import {
  type UpstreamBindingRecord,
  type UpstreamSourceRecord,
  upstreamApi,
} from '../../../api/upstream.api';
import { openConfirm } from '../../../components/ConfirmDialog';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import { useCommerceI18n } from '../../../i18n/namespaces/commerce';
import { toast } from '../../../lib/toast';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../../lib/uiHelpers';
import type { Product } from '../../../types';
import { ProductPreviewView } from '../../product/ProductPreviewView';
import { ProductAiAssistantPanel } from './ProductAiAssistantPanel';
import { ProductBasicSection } from './ProductBasicSection';
import { ProductContentSection, ProductFormsFaqSection } from './ProductContentFormsSection';
import { ProductEditorHeader } from './ProductEditorHeader';
import { ProductMarketingSection } from './ProductMarketingSection';
import { ProductSpecsSection } from './ProductSpecsSection';
import { computeProductMarginCheck, type EditableProduct } from './product-editor.types';

export type { EditableProduct } from './product-editor.types';

interface ProductEditorDrawerProps {
  open: boolean;
  product: EditableProduct | null;
  categories: Array<{ id: number; name: string }>;
  agentTiers?: Array<{ name: string; discount_rate: number }>;
  isSuperAdmin?: boolean;
  onClose: () => void;
  onSave: (draft: EditableProduct) => Promise<void>;
}

type EditorSection = 'basic' | 'specs' | 'marketing' | 'content' | 'forms';

export function ProductEditorDrawer({
  open,
  product,
  categories,
  agentTiers = [],
  isSuperAdmin = false,
  onClose,
  onSave,
}: ProductEditorDrawerProps) {
  const ape = useAdminProductEditorI18n();
  const cm = useCommerceI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [drawerMode, setDrawerMode] = useState<'edit' | 'preview'>('edit');
  const [section, setSection] = useState<EditorSection>('basic');
  const [draft, setDraft] = useState<EditableProduct | null>(null);
  const [tagsText, setTagsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [liveProductMeta, setLiveProductMeta] = useState<Product | null>(null);
  const [previewSpecId, setPreviewSpecId] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiAppliedBanner, setAiAppliedBanner] = useState('');
  const [bindingSnapshot, setBindingSnapshot] = useState<{
    productId: number;
    rows: UpstreamBindingRecord[];
  } | null>(null);
  const bindingRequest = useRef(0);
  const [upSources, setUpSources] = useState<UpstreamSourceRecord[]>([]);
  const activeProductId = open && isSuperAdmin ? product?.id : undefined;
  const currentBindingProductId = useRef(activeProductId);
  const skuBindings = bindingSnapshot?.productId === activeProductId ? (bindingSnapshot?.rows ?? []) : [];

  useLayoutEffect(() => {
    currentBindingProductId.current = activeProductId;
  }, [activeProductId]);

  const reloadProductBindings = useCallback(async (pid: number) => {
    if (pid !== currentBindingProductId.current) return;
    const requestId = ++bindingRequest.current;
    try {
      const [bRes, sRes] = await Promise.all([upstreamApi.listBindings(pid), upstreamApi.listSources()]);
      if (requestId !== bindingRequest.current || pid !== currentBindingProductId.current) return;
      setBindingSnapshot({
        productId: pid,
        rows: bRes.bindings.filter((binding) => binding.product_id === pid),
      });
      setUpSources(sRes.sources);
    } catch (err) {
      if (requestId === bindingRequest.current) setBindingSnapshot(null);
      console.warn('load SKU upstream bindings failed:', err);
    }
  }, []);

  useEffect(() => {
    setBindingSnapshot(null);
    if (activeProductId) void reloadProductBindings(activeProductId);
    return () => {
      bindingRequest.current += 1;
    };
  }, [activeProductId, reloadProductBindings]);

  useEffect(() => {
    if (!product) return;
    setDraft({ ...product });
    setTagsText((product.tags || []).join(', '));
    setDrawerMode('edit');
    setSection('basic');
    toast.clearErrors();
    setAiOpen(false);
    setAiAppliedBanner('');
    setPreviewSpecId(product.specs?.[0]?.id || 'default');
    setLiveProductMeta(null);
    if (product.id) {
      void storefrontApi
        .getProduct(String(product.id))
        .then((res) => setLiveProductMeta(res.product))
        .catch(() => setLiveProductMeta(null));
    }
  }, [product]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) void closeDialogSmoothly(dialog);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  const lowestTier = useMemo(() => {
    if (!agentTiers || agentTiers.length === 0)
      return { name: ape.peLowestTierFallback, discount_rate: 0.72 };
    return [...agentTiers].sort((a, b) => a.discount_rate - b.discount_rate)[0];
  }, [agentTiers, ape.peLowestTierFallback]);

  const marginCheck = useMemo(
    () => computeProductMarginCheck(draft, lowestTier, ape),
    [draft, lowestTier, ape]
  );

  if (!draft) return <dialog ref={dialogRef} className="acct-dialog acct-drawer" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    toast.clearErrors();

    let allowBelowCost = false;
    if (marginCheck.issues.length > 0) {
      const top = marginCheck.issues[0];
      const ok = await openConfirm({
        title: ape.peWarnTitle,
        description: fmt(ape.peWarnDesc, {
          count: marginCheck.issues.length,
          tierName: lowestTier.name,
          ...discountDisplay(lowestTier.discount_rate),
        }),
        detail: fmt(ape.peWarnDetail, {
          label: top.label,
          sell: top.sell,
          agentPrice: top.agentPrice,
          cost: top.cost,
          loss: top.loss,
          safeSell: top.safeSell,
        }),
        confirmLabel: ape.peWarnConfirm,
        cancelLabel: ape.peWarnCancel,
        tone: 'danger',
      });
      if (!ok) return;
      allowBelowCost = true;
    }

    setSaving(true);
    try {
      const parsedTags = tagsText
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
      await onSave({ ...draft, tags: parsedTags, allow_below_cost: allowBelowCost });
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ape.peSaveFailErr, { alertRole: false });
    } finally {
      setSaving(false);
    }
  };

  const sectionTabs: Array<{ id: EditorSection; label: string }> = [
    { id: 'basic', label: ape.peTabBasic },
    { id: 'specs', label: fmt(ape.peTabSpecs, { count: draft.specs.length }) },
    { id: 'marketing', label: cm.editorSectionMarketing },
    { id: 'content', label: ape.peTabContent },
    { id: 'forms', label: fmt(ape.peTabForms, { count: draft.faq.length + draft.custom_fields.length }) },
  ];

  const previewTags = tagsText
    .split(/[,，\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const previewCategoryName = categories.find((c) => c.id === draft.category_id)?.name || '';
  const previewSpecsList =
    draft.specs.length > 0
      ? draft.specs
      : [
          {
            id: 'default',
            name: ape.peStdSpecName,
            price: Number(draft.base_price || 0),
            original_price: draft.original_price ?? undefined,
          },
        ];
  const activePreviewSpec = previewSpecsList.find((s) => s.id === previewSpecId) || previewSpecsList[0];
  const previewTotalStock =
    draft.stock_mode === 'seats'
      ? Math.max(0, Number(draft.seat_total || 0) - Number(draft.seat_used || 0))
      : draft.stock_mode === 'manual_stock' || draft.delivery_type === 'api_key'
        ? Math.max(0, Number(draft.manual_stock || 0))
        : (liveProductMeta?.available_stock ?? 0);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="product-editor-title"
      className="acct-dialog acct-drawer transition-[max-width] duration-200"
      style={{ maxWidth: drawerMode === 'preview' ? 'min(96vw, 72rem)' : 'min(96vw, 52rem)' }}
    >
      <form onSubmit={handleSubmit} className="h-full flex flex-col">
        <ProductEditorHeader
          productId={draft.id}
          title={draft.title}
          isSuperAdmin={isSuperAdmin}
          drawerMode={drawerMode}
          aiOpen={aiOpen}
          onToggleAi={() => {
            if (drawerMode === 'preview') {
              setDrawerMode('edit');
              setAiOpen(true);
            } else {
              setAiOpen((o) => !o);
            }
          }}
          onChangeMode={setDrawerMode}
          onClose={handleClose}
        />

        {drawerMode === 'edit' && (
          <div
            className="px-6 py-2.5 border-b flex items-center gap-1.5 overflow-x-auto shrink-0"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            {sectionTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id)}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                style={{
                  backgroundColor: section === t.id ? 'var(--accent)' : 'var(--bg-surface)',
                  color: section === t.id ? '#FAF9F5' : 'var(--ink-secondary)',
                  border: `1px solid ${section === t.id ? 'transparent' : 'var(--border-color)'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {drawerMode === 'edit' ? (
          <div className="p-6 overflow-y-auto flex-1 space-y-5">
            {aiAppliedBanner && (
              <div
                className="p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2"
                style={{
                  borderColor: 'var(--success)',
                  backgroundColor: 'var(--success-soft)',
                  color: 'var(--success)',
                }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {aiAppliedBanner}
                </span>
                <button
                  type="button"
                  onClick={() => setAiAppliedBanner('')}
                  className="cursor-pointer opacity-75"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isSuperAdmin && aiOpen && (
              <ProductAiAssistantPanel
                draft={draft}
                tagsText={tagsText}
                categories={categories}
                onClose={() => setAiOpen(false)}
                onApply={(nextDraft, nextTags, count) => {
                  setDraft(nextDraft);
                  setTagsText(nextTags);
                  setAiOpen(false);
                  if (count > 0) {
                    setAiAppliedBanner(fmt(ape.peAiAppliedBanner, { count }));
                  }
                }}
              />
            )}

            {section === 'basic' && (
              <ProductBasicSection
                draft={draft}
                setDraft={setDraft}
                tagsText={tagsText}
                setTagsText={setTagsText}
                categories={categories}
                lowestTier={lowestTier}
                marginCheck={marginCheck}
              />
            )}

            {section === 'specs' && (
              <ProductSpecsSection
                draft={draft}
                setDraft={setDraft}
                lowestTier={lowestTier}
                isSuperAdmin={isSuperAdmin && draft.id === activeProductId}
                skuBindings={skuBindings}
                upSources={upSources}
                onReloadBindings={reloadProductBindings}
              />
            )}

            {section === 'marketing' && <ProductMarketingSection draft={draft} setDraft={setDraft} />}
            {section === 'content' && <ProductContentSection draft={draft} setDraft={setDraft} />}
            {section === 'forms' && <ProductFormsFaqSection draft={draft} setDraft={setDraft} />}
          </div>
        ) : (
          <ProductPreviewView
            bannerText={ape.pePreviewBanner}
            onBackToEdit={() => setDrawerMode('edit')}
            productId={draft.id}
            categoryName={previewCategoryName}
            title={draft.title.trim() || ape.peUnnamedProd}
            subtitle={draft.subtitle}
            iconKey={draft.icon_key}
            accentColor={draft.accent_color}
            tags={previewTags}
            deliveryType={draft.delivery_type}
            warrantyType={draft.warranty_type}
            warrantyDays={draft.warranty_days}
            warrantySummary={draft.warranty_summary}
            totalStock={previewTotalStock}
            salesCount={liveProductMeta?.sales_count ?? 0}
            riskNotice={draft.risk_notice}
            detailHtml={draft.detail_markdown}
            emptyDetailHint={ape.pePreviewEmptyDetail}
            faq={draft.faq}
            customFields={draft.custom_fields}
            priceHeaderLabel={ape.pePreviewPriceHeader}
            specs={previewSpecsList.map((s) => ({
              id: s.id,
              name: s.name,
              price: Number(s.price || 0),
              originalPrice: s.original_price,
              stock:
                draft.stock_mode === 'cards'
                  ? (liveProductMeta?.spec_stock?.[s.id] ?? previewTotalStock)
                  : previewTotalStock,
              badge: s.badge,
              description: s.description,
            }))}
            activeSpecId={activePreviewSpec?.id || ''}
            onSelectSpec={setPreviewSpecId}
            fallbackBasePrice={draft.base_price}
            fallbackOriginalPrice={draft.original_price}
          />
        )}

        <div
          className="px-6 py-4 border-t flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
        >
          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ape.peFooterHint}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl text-xs font-medium border cursor-pointer"
              style={{ borderColor: 'var(--border-color)' }}
            >
              {ape.peCancelBtn}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {draft.id ? ape.peSaveEditBtn : ape.pePublishNewBtn}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
