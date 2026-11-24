/**
 * 分站自营私有商品与自有加密卡密库存管理面板（复用统一商品创建/编辑器 ProductEditorDrawer）
 */

import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2, PackagePlus, Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { type AgentPrivateProductItem, tenantAgentApi } from '../../api/tenant-agent.api';
import { BrandBadge } from '../../components/BrandIcon';
import { openConfirm } from '../../components/ConfirmDialog';
import { PaginationBar } from '../../components/ui/PaginationBar';
import { fmt } from '../../i18n';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import { buildNewProductDraft } from '../admin/admin.types';
import type { EditableProduct } from '../admin-catalog/product-editor/product-editor.types';

const ProductEditorDrawer = lazy(() =>
  import('../admin-catalog/product-editor/ProductEditorDrawer').then((m) => ({
    default: m.ProductEditorDrawer,
  }))
);

const PRIVATE_PAGE_SIZE = 10;

function toPrivateEditableProduct(p: AgentPrivateProductItem): EditableProduct {
  return {
    id: p.id,
    category_id: p.category_id,
    slug: p.slug,
    title: p.title,
    title_en: p.title_en || '',
    subtitle: p.subtitle || '',
    subtitle_en: p.subtitle_en || '',
    icon_key: p.icon_key || 'sparkles',
    accent_color: p.accent_color || '#D97757',
    delivery_type: p.delivery_type || 'auto',
    tags: p.tags || [],
    base_price: p.base_price,
    original_price: p.original_price,
    cost_price: p.cost_price ?? null,
    stock_mode: p.stock_mode || 'cards',
    manual_stock: p.manual_stock ?? 0,
    seat_total: p.seat_total ?? 5,
    seat_used: p.seat_used ?? 0,
    summary_markdown: p.summary_markdown || '',
    detail_markdown: p.detail_markdown || '',
    risk_notice: p.risk_notice || '',
    warranty_type: p.warranty_type || 'full_period',
    warranty_days: p.warranty_days ?? 30,
    warranty_summary: p.warranty_summary || '',
    faq: p.faq || [],
    custom_fields: p.custom_fields || [],
    specs: p.specs || [],
    tier_pricing: p.tier_pricing || [],
    is_featured: p.is_featured ?? 1,
    is_active: p.is_active,
    sort_order: p.sort_order ?? 5,
    min_quantity: Math.max(1, Number(p.min_quantity || 1)),
    max_quantity: Math.max(0, Number(p.max_quantity || 0)),
    require_login: Boolean(p.require_login),
    is_hidden: Boolean(p.is_hidden),
    access_password: p.access_password || '',
    flash_sale_price: p.flash_sale_price ?? null,
    flash_sale_start_at: p.flash_sale_start_at || '',
    flash_sale_end_at: p.flash_sale_end_at || '',
    flash_sale_limit: Math.max(0, Number(p.flash_sale_limit || 0)),
    bundle_items: Array.isArray(p.bundle_items) ? p.bundle_items : [],
    group_buy_enabled: Boolean(p.group_buy_enabled),
    group_buy_size: Math.max(2, Number(p.group_buy_size || 2)),
    group_buy_price: p.group_buy_price ?? null,
    group_buy_hours: Math.max(1, Number(p.group_buy_hours || 24)),
    allow_card_selection: Boolean(p.allow_card_selection),
    card_select_fee: Math.max(0, Number(p.card_select_fee || 0)),
    member_price: p.member_price ?? null,
  };
}

export function AgentPrivateCatalogTab({
  agentTiers = [],
  onToast,
  onError,
}: {
  agentTiers?: Array<{ name: string; discount_rate: number }>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const ss = useSaasI18n();
  const rf = useRiskControlI18n();
  const ac = useAdminCoreI18n();

  const productsQuery = useQuery({
    queryKey: ['agent', 'private-products'],
    queryFn: () => tenantAgentApi.listPrivateProducts(),
  });
  const items = productsQuery.data?.items ?? [];
  const categories = productsQuery.data?.categories ?? [];

  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorProduct, setEditorProduct] = useState<EditableProduct | null>(null);

  const [cardsProduct, setCardsProduct] = useState<AgentPrivateProductItem | null>(null);
  const [cardsSpecId, setCardsSpecId] = useState('default');
  const [cardsList, setCardsList] = useState<
    Array<{
      id: number;
      spec_id: string;
      card_content: string;
      status: string;
      is_loop?: number;
      order_no: string | null;
    }>
  >([]);
  const [cardsDraft, setCardsDraft] = useState('');
  const [cardsDedupe, setCardsDedupe] = useState(true);
  const [cardsLoop, setCardsLoop] = useState(false);
  const [importing, setImporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(items.length / PRIVATE_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedItems = useMemo(
    () => items.slice((safePage - 1) * PRIVATE_PAGE_SIZE, safePage * PRIVATE_PAGE_SIZE),
    [items, safePage]
  );

  const openCreateEditor = () => {
    const draft = buildNewProductDraft(categories[0]?.id || 1, ac);
    setEditorProduct({ ...draft, sort_order: 5 });
    setEditorOpen(true);
  };

  const openEditEditor = (prod: AgentPrivateProductItem) => {
    setEditorProduct(toPrivateEditableProduct(prod));
    setEditorOpen(true);
  };

  const handleSaveProduct = async (draft: EditableProduct) => {
    const { id, ...rest } = draft;
    const payload: Record<string, unknown> = {
      ...rest,
      slug: rest.slug?.trim() || undefined,
    };
    if (id) {
      await tenantAgentApi.updatePrivateProduct(id, payload);
      onToast(ss.privUpdatedToast);
    } else {
      await tenantAgentApi.createPrivateProduct(payload);
      onToast(ss.privCreatedToast);
    }
    await productsQuery.refetch();
  };

  const openCards = async (prod: AgentPrivateProductItem) => {
    setCardsProduct(prod);
    setCardsSpecId(prod.specs?.[0]?.id || 'default');
    try {
      const res = await tenantAgentApi.listPrivateCards(prod.id);
      setCardsList(res.cards || []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const handleImportCards = async () => {
    if (!cardsProduct || !cardsDraft.trim()) return;
    setImporting(true);
    try {
      const res = await tenantAgentApi.importPrivateCards(
        cardsProduct.id,
        cardsDraft,
        cardsSpecId || 'default',
        {
          is_loop: cardsLoop,
          dedupe: cardsDedupe,
        }
      );
      setCardsDraft('');
      const refreshed = await tenantAgentApi.listPrivateCards(cardsProduct.id);
      setCardsList(refreshed.cards || []);
      await productsQuery.refetch();
      onToast(fmt(ss.privCardsImportedToast, { count: res.imported }));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteProduct = async (prod: AgentPrivateProductItem) => {
    const ok = await openConfirm({
      title: ss.privDeleteConfirmTitle,
      description: fmt(ss.privDeleteConfirmDesc, { title: prod.title }),
      confirmLabel: ss.privDeleteBtn,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await tenantAgentApi.deletePrivateProduct(prod.id);
      if (cardsProduct?.id === prod.id) setCardsProduct(null);
      await productsQuery.refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed');
    }
  };

  if (productsQuery.isPending) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div
          className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <PackagePlus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <h2 className="font-editorial text-xl font-semibold">{ss.privTitle}</h2>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
              {ss.privDesc}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateEditor}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shrink-0"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Plus className="w-3.5 h-3.5" />
            {ss.privCreateBtn}
          </button>
        </div>

        {items.length === 0 ? (
          <div className="py-10 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ss.privEmpty}
          </div>
        ) : (
          <div className="space-y-2.5">
            {pagedItems.map((p) => (
              <div
                key={p.id}
                className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <BrandBadge
                    icon={p.icon_key || 'sparkles'}
                    accentColor={p.accent_color || '#D97757'}
                    size="sm"
                  />
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-semibold flex items-center gap-2 flex-wrap">
                      <span className="truncate">{p.title}</span>
                      <span className="font-mono-num text-[11px]" style={{ color: 'var(--accent)' }}>
                        ¥{Number(p.base_price).toFixed(2)}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10.5px] font-mono-num"
                        style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                      >
                        {fmt(ss.privCardsAvailable, { count: p.available_cards })}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num truncate" style={{ color: 'var(--ink-muted)' }}>
                      /{p.slug}
                      {p.subtitle ? ` · ${p.subtitle}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditEditor(p)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Pencil className="w-3 h-3" />
                    {ss.privEditBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openCards(p)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer"
                    style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <KeyRound className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                    {ss.privCardsBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteProduct(p)}
                    className="p-1.5 rounded-lg border cursor-pointer"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                    aria-label={ss.privDeleteBtn}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <PaginationBar
              page={safePage}
              totalPages={totalPages}
              totalItems={items.length}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      {cardsProduct && (
        <div className="paper-card rounded-2xl p-6 space-y-4">
          <div
            className="flex items-center justify-between gap-2 pb-3 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <h3 className="font-editorial text-lg font-semibold">
              {ss.privCardsModalTitle} · {cardsProduct.title}
            </h3>
            <button
              type="button"
              onClick={() => setCardsProduct(null)}
              className="p-1.5 rounded-lg cursor-pointer"
              style={{ color: 'var(--ink-muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="inline-flex items-center gap-2">
              <span className="font-semibold">{ss.privSpecLabel}</span>
              <select
                value={cardsSpecId}
                onChange={(e) => setCardsSpecId(e.target.value)}
                className="acct-input py-1.5 text-xs w-auto"
              >
                {(cardsProduct.specs && cardsProduct.specs.length > 0
                  ? cardsProduct.specs
                  : [{ id: 'default', name: ss.privDefaultSpecName }]
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cardsDedupe}
                onChange={(e) => setCardsDedupe(e.target.checked)}
              />
              <span>{rf.cardDedupeLabel}</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={cardsLoop} onChange={(e) => setCardsLoop(e.target.checked)} />
              <Repeat className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>{rf.cardLoopLabel}</span>
            </label>
          </div>
          <textarea
            rows={4}
            value={cardsDraft}
            onChange={(e) => setCardsDraft(e.target.value)}
            placeholder={ss.privCardsInputPlaceholder}
            className="acct-input font-mono-num text-xs"
          />
          <button
            type="button"
            disabled={importing || !cardsDraft.trim()}
            onClick={() => void handleImportCards()}
            className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {ss.privCardsImportBtn}
          </button>

          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {cardsList.map((c) => (
              <div
                key={c.id}
                className="p-2.5 rounded-lg border flex items-center justify-between gap-2 text-[11px] font-mono-num"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <span className="truncate">{c.card_content}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span style={{ color: 'var(--ink-muted)' }}>{c.spec_id}</span>
                  {Number(c.is_loop || 0) === 1 && (
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {rf.cardLoopBadge}
                    </span>
                  )}
                  <span style={{ color: c.status === 'available' ? 'var(--success)' : 'var(--ink-muted)' }}>
                    {c.status}
                  </span>
                  {c.status === 'available' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await tenantAgentApi.deletePrivateCard(c.id);
                        const refreshed = await tenantAgentApi.listPrivateCards(cardsProduct.id);
                        setCardsList(refreshed.cards || []);
                        await productsQuery.refetch();
                      }}
                      className="text-[var(--danger)] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        <ProductEditorDrawer
          open={editorOpen}
          product={editorProduct}
          categories={categories}
          agentTiers={agentTiers}
          onClose={() => setEditorOpen(false)}
          onSave={handleSaveProduct}
        />
      </Suspense>
    </div>
  );
}
