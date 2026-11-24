/**
 * 分站商品选品与多 SKU 自主定价状态管理 Hook
 */

import { useEffect, useMemo, useState } from 'react';
import { type AgentPricingProductRow, agentApi } from '../../../api/agent.api';
import { openConfirm } from '../../../components/ConfirmDialog';
import { fmt } from '../../../i18n';
import { useAgentPricingI18n } from '../../../i18n/namespaces/agent-pricing';
import { toast as globalToast } from '../../../lib/toast';
import { useAgentPricingQuery } from '../../../queries/agent.queries';

const PRICING_PAGE_SIZE = 10;

export function useAgentPricingState() {
  const ap = useAgentPricingI18n();
  const pricingQuery = useAgentPricingQuery(true);
  const items = pricingQuery.data?.items ?? [];
  const tierName = pricingQuery.data?.tier_name ?? '';
  const discountRate = pricingQuery.data?.discount_rate ?? 0.9;

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingProductId, setSavingProductId] = useState<number | null>(null);
  const [savingAllDirty, setSavingAllDirty] = useState(false);
  const [togglingProductId, setTogglingProductId] = useState<number | null>(null);

  // 默认全部折叠，仅由用户点击展开或“全部展开规格”触发
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const [query, setQueryRaw] = useState('');
  const [listingFilter, setListingFilterRaw] = useState<'all' | 'listed' | 'hidden'>('all');
  const [page, setPage] = useState(1);
  const setQuery = (v: string) => {
    setQueryRaw(v);
    setPage(1);
  };
  const setListingFilter = (v: 'all' | 'listed' | 'hidden') => {
    setListingFilterRaw(v);
    setPage(1);
  };
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const [batchMode, setBatchMode] = useState<'markup_cost_pct' | 'markup_main_pct' | 'markup_cost_fixed'>(
    'markup_cost_pct'
  );
  const [batchValue, setBatchValue] = useState<number>(25);
  const [batchRounding, setBatchRounding] = useState<'none' | 'integer' | 'point9'>('point9');
  const [batchApplying, setBatchApplying] = useState(false);
  const [editingProd, setEditingProd] = useState<AgentPricingProductRow | null>(null);

  useEffect(() => {
    if (!pricingQuery.data?.items) return;
    const nextDrafts: Record<string, string> = {};
    for (const p of pricingQuery.data.items) {
      for (const s of p.specs) {
        nextDrafts[`${p.product_id}:${s.spec_id}`] = String(s.effective_sell_price);
      }
    }
    setDrafts(nextDrafts);
  }, [pricingQuery.data]);

  const pricingErr = pricingQuery.error instanceof Error ? pricingQuery.error.message : '';
  useEffect(() => {
    if (pricingErr) globalToast.error(pricingErr);
  }, [pricingErr]);

  const showToast = (msg: string) => {
    globalToast.auto(msg);
  };

  const setError = (msg: string) => {
    if (msg) globalToast.error(msg);
    else globalToast.clearErrors();
  };

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((p) => {
        if (listingFilter === 'listed' && !p.is_listed) return false;
        if (listingFilter === 'hidden' && p.is_listed) return false;
        if (!q) return true;
        if (p.title.toLowerCase().includes(q) || p.original_title.toLowerCase().includes(q)) return true;
        return p.specs.some((s) => s.spec_name.toLowerCase().includes(q));
      })
      .map((p) => {
        if (!q || p.title.toLowerCase().includes(q) || p.original_title.toLowerCase().includes(q)) return p;
        return { ...p, specs: p.specs.filter((s) => s.spec_name.toLowerCase().includes(q)) };
      });
  }, [items, query, listingFilter]);

  const allSpecEntries = useMemo(() => {
    const list: Array<{
      key: string;
      product_id: number;
      spec_id: string;
      cost_price: number;
      effective_sell_price: number;
    }> = [];
    for (const p of items) {
      for (const s of p.specs) {
        list.push({
          key: `${p.product_id}:${s.spec_id}`,
          product_id: p.product_id,
          spec_id: s.spec_id,
          cost_price: s.cost_price,
          effective_sell_price: s.effective_sell_price,
        });
      }
    }
    return list;
  }, [items]);

  const filteredSpecEntries = useMemo(() => {
    const list: Array<{ key: string; product_id: number; spec_id: string }> = [];
    for (const p of filteredProducts) {
      for (const s of p.specs) {
        list.push({ key: `${p.product_id}:${s.spec_id}`, product_id: p.product_id, spec_id: s.spec_id });
      }
    }
    return list;
  }, [filteredProducts]);

  const dirtySpecList = useMemo(
    () =>
      allSpecEntries.filter((e) => {
        const val = Number(drafts[e.key]);
        if (Number.isNaN(val) || val < e.cost_price) return false;
        return Math.abs(val - e.effective_sell_price) > 0.001;
      }),
    [allSpecEntries, drafts]
  );

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRICING_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedProducts = useMemo(
    () => filteredProducts.slice((safePage - 1) * PRICING_PAGE_SIZE, safePage * PRICING_PAGE_SIZE),
    [filteredProducts, safePage]
  );

  const allFilteredSelected =
    filteredSpecEntries.length > 0 && filteredSpecEntries.every((e) => selectedKeys.has(e.key));
  // 只要当前筛选列表中存在已展开项，按钮即显示「全部收起规格」并一键收起；全部折叠时显示「全部展开规格」
  const anyExpanded =
    filteredProducts.length > 0 && filteredProducts.some((p) => expandedIds.has(p.product_id));
  const toggleExpandAll = () => {
    setExpandedIds(anyExpanded ? new Set() : new Set(filteredProducts.map((p) => p.product_id)));
  };

  const toggleSelectAllFiltered = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const e of filteredSpecEntries) {
        if (allFilteredSelected) next.delete(e.key);
        else next.add(e.key);
      }
      return next;
    });
  };

  const toggleSelectProduct = (p: AgentPricingProductRow) => {
    const keys = p.specs.map((s) => `${p.product_id}:${s.spec_id}`);
    const allChecked = keys.length > 0 && keys.every((k) => selectedKeys.has(k));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (allChecked) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const resolveBatchScope = ():
    | { targets: Array<{ product_id: number; spec_id: string }> }
    | { scope: 'all' } => {
    if (selectedKeys.size > 0) {
      return {
        targets: allSpecEntries
          .filter((e) => selectedKeys.has(e.key))
          .map((e) => ({ product_id: e.product_id, spec_id: e.spec_id })),
      };
    }
    if (query.trim() || listingFilter !== 'all') {
      return { targets: filteredSpecEntries.map((e) => ({ product_id: e.product_id, spec_id: e.spec_id })) };
    }
    return { scope: 'all' };
  };
  const batchScope = resolveBatchScope();
  const batchTargetCount = 'targets' in batchScope ? batchScope.targets.length : allSpecEntries.length;

  const batchScopeLabel =
    selectedKeys.size > 0
      ? fmt(ap.stateScopeSelected, { count: selectedKeys.size })
      : query.trim() || listingFilter !== 'all'
        ? fmt(ap.stateScopeFiltered, { count: filteredSpecEntries.length })
        : fmt(ap.stateScopeAll, { count: allSpecEntries.length });

  const handleSaveSpec = async (productId: number, specId: string) => {
    const key = `${productId}:${specId}`;
    const val = Number(drafts[key]);
    if (Number.isNaN(val) || val <= 0) {
      setError(ap.stateInvalidPriceErr);
      return;
    }
    setSavingKey(key);
    setError('');
    try {
      await agentApi.setCustomPrice({ product_id: productId, spec_id: specId, custom_price: val });
      await pricingQuery.refetch();
      showToast(ap.statePriceSavedToast);
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.statePriceSaveErr);
    } finally {
      setSavingKey(null);
    }
  };

  const handleResetSpec = async (productId: number, specId: string) => {
    const key = `${productId}:${specId}`;
    setSavingKey(key);
    setError('');
    try {
      await agentApi.setCustomPrice({ product_id: productId, spec_id: specId, custom_price: null });
      await pricingQuery.refetch();
      showToast(ap.stateResetSingleToast);
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateResetErr);
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveProductDirty = async (p: AgentPricingProductRow) => {
    const dirty = p.specs.filter((s) => {
      const val = Number(drafts[`${p.product_id}:${s.spec_id}`]);
      return !Number.isNaN(val) && val >= s.cost_price && Math.abs(val - s.effective_sell_price) > 0.001;
    });
    if (dirty.length === 0) return;
    setSavingProductId(p.product_id);
    setError('');
    try {
      for (const s of dirty) {
        await agentApi.setCustomPrice({
          product_id: p.product_id,
          spec_id: s.spec_id,
          custom_price: Number(drafts[`${p.product_id}:${s.spec_id}`]),
        });
      }
      await pricingQuery.refetch();
      showToast(fmt(ap.stateBatchProdSavedToast, { title: p.title, count: dirty.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateBatchProdErr);
    } finally {
      setSavingProductId(null);
    }
  };

  const handleSaveAllDirty = async () => {
    if (dirtySpecList.length === 0) return;
    setSavingAllDirty(true);
    setError('');
    try {
      for (const entry of dirtySpecList) {
        await agentApi.setCustomPrice({
          product_id: entry.product_id,
          spec_id: entry.spec_id,
          custom_price: Number(drafts[entry.key]),
        });
      }
      await pricingQuery.refetch();
      showToast(fmt(ap.stateSaveAllToast, { count: dirtySpecList.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateSaveAllErr);
    } finally {
      setSavingAllDirty(false);
    }
  };

  const handleBatchApply = async () => {
    if (batchTargetCount === 0) return;
    setBatchApplying(true);
    setError('');
    try {
      const res = await agentApi.batchSetPricing({
        mode: batchMode,
        value: batchValue,
        rounding: batchRounding,
        ...batchScope,
      });
      await pricingQuery.refetch();
      setSelectedKeys(new Set());
      showToast(fmt(ap.stateBatchAppliedToast, { count: res.updated_count }));
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateBatchFailErr);
    } finally {
      setBatchApplying(false);
    }
  };

  const handleBatchReset = async () => {
    if (batchTargetCount === 0) return;
    const ok = await openConfirm({
      title: ap.stateResetBatchTitle,
      description: fmt(ap.stateResetBatchDesc, { scope: batchScopeLabel }),
      confirmLabel: ap.stateResetBatchConfirm,
      tone: 'accent',
    });
    if (!ok) return;
    setBatchApplying(true);
    setError('');
    try {
      await agentApi.batchSetPricing({ mode: 'reset_all', ...batchScope });
      await pricingQuery.refetch();
      setSelectedKeys(new Set());
      showToast(fmt(ap.stateResetBatchToast, { scope: batchScopeLabel }));
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateResetBatchErr);
    } finally {
      setBatchApplying(false);
    }
  };

  const handleToggleListing = async (p: AgentPricingProductRow) => {
    setTogglingProductId(p.product_id);
    setError('');
    try {
      await agentApi.updateProductOverride(p.product_id, { is_listed: !p.is_listed });
      await pricingQuery.refetch();
      showToast(
        p.is_listed
          ? fmt(ap.stateToggleUnlistedToast, { title: p.title })
          : fmt(ap.stateToggleListedToast, { title: p.title })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : ap.stateToggleErr);
    } finally {
      setTogglingProductId(null);
    }
  };

  return {
    pricingQuery,
    items,
    tierName,
    discountRate,
    drafts,
    setDrafts,
    savingKey,
    savingProductId,
    savingAllDirty,
    togglingProductId,
    showToast,
    setError,
    expandedIds,
    setExpandedIds,
    query,
    setQuery,
    listingFilter,
    setListingFilter,
    selectedKeys,
    setSelectedKeys,
    batchMode,
    setBatchMode,
    batchValue,
    setBatchValue,
    batchRounding,
    setBatchRounding,
    batchApplying,
    editingProd,
    setEditingProd,
    filteredProducts,
    pagedProducts,
    page: safePage,
    totalPages,
    setPage,
    allSpecEntries,
    filteredSpecEntries,
    dirtySpecList,
    allFilteredSelected,
    anyExpanded,
    toggleExpandAll,
    batchScopeLabel,
    batchTargetCount,
    listedCount: items.filter((p) => p.is_listed).length,
    toggleSelectAllFiltered,
    toggleSelectProduct,
    handleSaveSpec,
    handleResetSpec,
    handleSaveProductDirty,
    handleSaveAllDirty,
    handleBatchApply,
    handleBatchReset,
    handleToggleListing,
  };
}
