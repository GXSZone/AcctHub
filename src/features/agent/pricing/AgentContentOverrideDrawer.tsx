/**
 * 分站隔离生效的商品文案改写与整页实时预览抽屉
 */

import { ExternalLink, Eye, FileEdit, Loader2, RotateCcw, Save, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type AgentPricingProductRow, agentApi } from '../../../api/agent.api';
import { storefrontApi } from '../../../api/storefront.api';
import { openConfirm } from '../../../components/ConfirmDialog';
import { RichTextEditor } from '../../../components/editor/RichTextEditor';
import { fmt } from '../../../i18n';
import { useAgentPricingI18n } from '../../../i18n/namespaces/agent-pricing';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../../lib/uiHelpers';
import type { Product } from '../../../types';
import { ProductPreviewView } from '../../product/ProductPreviewView';

interface AgentContentOverrideDrawerProps {
  product: AgentPricingProductRow | null;
  drafts: Record<string, string>;
  tenantSlug?: string;
  storeName?: string;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}

export function AgentContentOverrideDrawer({
  product: editingProd,
  drafts,
  tenantSlug,
  storeName,
  onClose,
  onSaved,
  onError,
}: AgentContentOverrideDrawerProps) {
  const ap = useAgentPricingI18n();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [drawerMode, setDrawerMode] = useState<'edit' | 'preview'>('edit');
  const [overrideTitle, setOverrideTitle] = useState('');
  const [overrideSubtitle, setOverrideSubtitle] = useState('');
  const [overrideDetail, setOverrideDetail] = useState('');
  const [overrideRisk, setOverrideRisk] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSpecId, setPreviewSpecId] = useState<string>('');

  useEffect(() => {
    const dlg = drawerRef.current;
    if (!dlg) return;
    if (editingProd && !dlg.open) {
      setDrawerMode('edit');
      setOverrideTitle(editingProd.override?.custom_title || editingProd.original_title || '');
      setOverrideSubtitle(editingProd.override?.custom_subtitle || editingProd.original_subtitle || '');
      setOverrideDetail(
        editingProd.override?.custom_detail_markdown || editingProd.original_detail_markdown || ''
      );
      setOverrideRisk(editingProd.override?.custom_risk_notice || editingProd.original_risk_notice || '');
      setPreviewSpecId(editingProd.specs[0]?.spec_id || '');
      setPreviewProduct(null);
      setPreviewLoading(true);
      dlg.showModal();
      void storefrontApi
        .getProduct(String(editingProd.product_id))
        .then((res) => setPreviewProduct(res.product))
        .catch(() => setPreviewProduct(null))
        .finally(() => setPreviewLoading(false));
    } else if (!editingProd && dlg.open) {
      void closeDialogSmoothly(dlg);
    }
  }, [editingProd]);

  useEffect(() => {
    const dlg = drawerRef.current;
    if (!dlg) return;
    return attachDialogLightDismissFallback(dlg, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(drawerRef.current).then(() => {
      setDrawerMode('edit');
      setPreviewProduct(null);
      onClose();
    });
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProd) return;
    setSavingOverride(true);
    onError('');
    try {
      await agentApi.updateProductOverride(editingProd.product_id, {
        custom_title: overrideTitle.trim() === editingProd.original_title.trim() ? '' : overrideTitle,
        custom_subtitle:
          overrideSubtitle.trim() === editingProd.original_subtitle.trim() ? '' : overrideSubtitle,
        custom_detail_markdown:
          overrideDetail.trim() === editingProd.original_detail_markdown.trim() ? '' : overrideDetail,
        custom_risk_notice:
          overrideRisk.trim() === editingProd.original_risk_notice.trim() ? '' : overrideRisk,
      });
      await onSaved(ap.ovSavedToast);
      handleClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : ap.ovSaveFailErr);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleResetOverride = async () => {
    if (!editingProd) return;
    const ok = await openConfirm({
      title: ap.ovResetTitle,
      description: fmt(ap.ovResetDesc, { title: editingProd.title }),
      confirmLabel: ap.ovResetConfirm,
      tone: 'accent',
    });
    if (!ok) return;
    setSavingOverride(true);
    try {
      await agentApi.resetProductOverride(editingProd.product_id);
      await onSaved(ap.ovResetToast);
      handleClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : ap.ovResetFailErr);
    } finally {
      setSavingOverride(false);
    }
  };

  return (
    <dialog
      ref={drawerRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="acct-dialog acct-drawer transition-[max-width] duration-200"
      style={{ maxWidth: drawerMode === 'preview' ? 'min(96vw, 72rem)' : 'min(96vw, 52rem)' }}
      aria-labelledby="override-drawer-title"
    >
      {editingProd &&
        (() => {
          const liveTitle = overrideTitle.trim() || editingProd.original_title;
          const liveSubtitle = overrideSubtitle.trim() || editingProd.original_subtitle;
          const liveRisk = overrideRisk.trim();
          const liveDetail = overrideDetail.trim() || editingProd.original_detail_markdown;
          const previewSpecs = editingProd.specs.map((s) => {
            const key = `${editingProd.product_id}:${s.spec_id}`;
            const rawDraft = Number(drafts[key]);
            const sellPrice = !Number.isNaN(rawDraft) && rawDraft > 0 ? rawDraft : s.effective_sell_price;
            const liveMeta = previewProduct?.specs?.find((ps) => ps.id === s.spec_id);
            return {
              ...s,
              sellPrice,
              stock: previewProduct?.spec_stock?.[s.spec_id] ?? previewProduct?.available_stock ?? 0,
              badge: liveMeta?.badge,
            };
          });
          const activePreviewSpec = previewSpecs.find((s) => s.spec_id === previewSpecId) || previewSpecs[0];
          const livePageUrl = tenantSlug
            ? `/item/${editingProd.product_id}?tenant=${encodeURIComponent(tenantSlug)}`
            : `/item/${editingProd.product_id}`;

          return (
            <form onSubmit={handleSaveOverride} className="h-full flex flex-col">
              <div
                className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div className="min-w-0">
                  <h3 id="override-drawer-title" className="font-editorial text-xl font-semibold">
                    {ap.ovDrawerTitle}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {ap.ovDrawerSubtitle}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <div
                    className="inline-flex items-center p-0.5 rounded-full border text-xs"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setDrawerMode('edit')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium cursor-pointer transition-colors whitespace-nowrap"
                      style={{
                        backgroundColor: drawerMode === 'edit' ? 'var(--accent)' : 'transparent',
                        color: drawerMode === 'edit' ? '#FAF9F5' : 'var(--ink-secondary)',
                      }}
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                      {ap.ovEditTab}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawerMode('preview')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium cursor-pointer transition-colors whitespace-nowrap"
                      style={{
                        backgroundColor: drawerMode === 'preview' ? 'var(--accent)' : 'transparent',
                        color: drawerMode === 'preview' ? '#FAF9F5' : 'var(--ink-secondary)',
                      }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {ap.ovPreviewTab}
                    </button>
                  </div>

                  <a
                    href={livePageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-medium no-underline whitespace-nowrap transition-colors hover:bg-[var(--bg-subtle)]"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-secondary)' }}
                    title={ap.ovLiveLinkTitle}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {ap.ovLiveLinkBtn}
                  </a>

                  <button
                    type="button"
                    onClick={handleClose}
                    className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                    aria-label={ap.ovCloseDrawerAria}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {drawerMode === 'edit' ? (
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  <div>
                    <div className="block text-xs font-semibold mb-1">{ap.ovFieldTitleLabel}</div>
                    <input
                      type="text"
                      value={overrideTitle}
                      onChange={(e) => setOverrideTitle(e.target.value)}
                      placeholder={editingProd.original_title}
                      className="acct-input"
                    />
                  </div>
                  <div>
                    <div className="block text-xs font-semibold mb-1">{ap.ovFieldSubtitleLabel}</div>
                    <input
                      type="text"
                      value={overrideSubtitle}
                      onChange={(e) => setOverrideSubtitle(e.target.value)}
                      placeholder={editingProd.original_subtitle}
                      className="acct-input"
                    />
                  </div>
                  <div>
                    <div className="block text-xs font-semibold mb-1">{ap.ovFieldRiskLabel}</div>
                    <textarea
                      rows={3}
                      value={overrideRisk}
                      onChange={(e) => setOverrideRisk(e.target.value)}
                      placeholder={editingProd.original_risk_notice || ap.ovFieldRiskPlaceholder}
                      className="acct-input text-xs leading-relaxed"
                    />
                  </div>
                  <div>
                    <div className="block text-xs font-semibold mb-1.5">{ap.ovFieldDetailLabel}</div>
                    <RichTextEditor
                      value={overrideDetail}
                      onChange={setOverrideDetail}
                      placeholder={ap.ovFieldDetailPlaceholder}
                      minHeight={260}
                    />
                  </div>
                </div>
              ) : (
                <ProductPreviewView
                  bannerText={fmt(ap.ovPreviewBanner, {
                    store: storeName ? `「${storeName}」` : ap.ovPreviewDefaultStore,
                  })}
                  onBackToEdit={() => setDrawerMode('edit')}
                  loading={previewLoading && !previewProduct}
                  productId={editingProd.product_id}
                  categoryName={previewProduct?.category?.name}
                  title={liveTitle}
                  subtitle={liveSubtitle}
                  iconKey={previewProduct?.icon_key}
                  accentColor={previewProduct?.accent_color}
                  tags={previewProduct?.tags || []}
                  deliveryType={previewProduct?.delivery_type}
                  warrantyType={previewProduct?.warranty_type}
                  warrantyDays={previewProduct?.warranty_days}
                  warrantySummary={previewProduct?.warranty_summary}
                  totalStock={previewProduct?.available_stock ?? 0}
                  stockLabel={previewProduct?.stock_label}
                  salesCount={previewProduct?.sales_count ?? 0}
                  riskNotice={liveRisk}
                  detailHtml={liveDetail}
                  emptyDetailHint={ap.ovPreviewEmptyDetail}
                  faq={previewProduct?.faq || []}
                  priceHeaderLabel={
                    storeName
                      ? fmt(ap.ovPreviewPriceHeaderStore, { store: storeName })
                      : ap.ovPreviewPriceHeaderDefault
                  }
                  specs={previewSpecs.map((s) => ({
                    id: s.spec_id,
                    name: s.spec_name,
                    price: s.sellPrice,
                    stock: s.stock,
                    badge: s.badge,
                  }))}
                  activeSpecId={activePreviewSpec?.spec_id || ''}
                  onSelectSpec={setPreviewSpecId}
                  fallbackOriginalPrice={previewProduct?.original_price}
                />
              )}

              <div
                className="px-6 py-4 border-t flex flex-wrap items-center justify-between gap-2 shrink-0"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <button
                  type="button"
                  disabled={savingOverride}
                  onClick={() => void handleResetOverride()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-medium cursor-pointer"
                  style={{
                    borderColor: 'var(--border-strong)',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {ap.ovResetToUpstreamBtn}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 rounded-xl border text-xs font-medium cursor-pointer"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    {ap.ovCancelBtn}
                  </button>
                  <button
                    type="submit"
                    disabled={savingOverride}
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                  >
                    {savingOverride ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    {ap.ovSaveOverrideBtn}
                  </button>
                </div>
              </div>
            </form>
          );
        })()}
    </dialog>
  );
}
