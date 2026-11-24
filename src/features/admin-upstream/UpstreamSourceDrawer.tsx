/**
 * 上游货源连接器配置侧滑抽屉（4 标签页组合、保存与保存并同步）
 */

import { Code2, Filter, PlugZap, RefreshCw, Save, Sliders, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { type UpstreamSourceInput, type UpstreamSourceRecord, upstreamApi } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamDrawerI18n } from '../../i18n/namespaces/admin-upstream-drawer';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../../lib/uiHelpers';
import { UpstreamDrawerConnectionTab } from './UpstreamDrawerConnectionTab';
import { UpstreamDrawerProtocolTab } from './UpstreamDrawerProtocolTab';
import { UpstreamDrawerFiltersTab, UpstreamDrawerPricingTab } from './UpstreamDrawerRulesTab';
import { emptySourceDraft, type SourceEditorDraft } from './upstream-constants';

type DrawerTab = 'connection' | 'protocol' | 'filters' | 'pricing';

interface UpstreamSourceDrawerProps {
  editingSourceId: number | 'new' | null;
  editingSourceMeta: UpstreamSourceRecord | null;
  categories: Array<{ id: number; name: string }>;
  onClose: () => void;
  onSaved: (targetSourceId: number) => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

function buildDraftFromSource(src: UpstreamSourceRecord, fallbackCatId: number): SourceEditorDraft {
  return {
    name: src.name,
    adapter_type: src.adapter_type,
    auth_mode: src.auth_mode || 'header_bearer',
    app_id: src.app_id || '',
    base_url: src.base_url || '',
    order_url: src.order_url || '',
    query_order_url: src.query_order_url || '',
    balance_url: src.balance_url || '',
    api_key: '',
    api_secret: '',
    webhook_secret: '',
    proxy_relay_url: src.proxy_relay_url || '',
    proxy_relay_token: '',
    auth_header: src.auth_header || 'Authorization',
    auth_prefix: src.auth_prefix ?? 'Bearer ',
    field_mapping: {
      list_path: src.field_mapping?.list_path || '',
      id_field: src.field_mapping?.id_field || '',
      title_field: src.field_mapping?.title_field || '',
      category_field: src.field_mapping?.category_field || '',
      price_field: src.field_mapping?.price_field || '',
      stock_field: src.field_mapping?.stock_field || '',
      status_field: src.field_mapping?.status_field || '',
      desc_field: src.field_mapping?.desc_field || '',
      specs_field: src.field_mapping?.specs_field || 'specs',
    },
    filter_rules: {
      include_keywords: src.filter_rules?.include_keywords || [],
      exclude_keywords: src.filter_rules?.exclude_keywords || [],
      min_cost_price: Number(src.filter_rules?.min_cost_price || 0),
      max_cost_price: Number(src.filter_rules?.max_cost_price || 0),
    },
    pricing_rules: {
      markup_percent: Number(src.pricing_rules?.markup_percent ?? 20),
      markup_fixed: Number(src.pricing_rules?.markup_fixed ?? 0),
      rounding: (src.pricing_rules?.rounding as 'none' | 'integer' | 'point9') || 'point9',
      price_spike_guard_pct: Number(src.pricing_rules?.price_spike_guard_pct ?? 35),
    },
    order_template: {
      method: src.order_template?.method || 'POST',
      content_type: src.order_template?.content_type || 'json',
      body_template: src.order_template?.body_template,
    },
    response_mapping: {
      order_no_path: src.response_mapping?.order_no_path || '',
      cards_path: src.response_mapping?.cards_path || '',
      cost_path: src.response_mapping?.cost_path || '',
      balance_path: src.response_mapping?.balance_path || '',
      error_path: src.response_mapping?.error_path || '',
      status_path: src.response_mapping?.status_path || '',
    },
    out_of_stock_action: src.out_of_stock_action || 'mark_sold_out',
    auto_republish_on_restock: Boolean(src.auto_republish_on_restock),
    default_category_id: src.default_category_id || fallbackCatId,
    sync_interval_minutes: src.sync_interval_minutes || 15,
    auto_sync_enabled: Boolean(src.auto_sync_enabled),
    low_balance_threshold: Number(src.low_balance_threshold ?? 100),
    sandbox_mode: src.sandbox_mode || 'normal',
    status: src.status === 'active' ? 'active' : 'paused',
    body_template_text: src.order_template?.body_template
      ? JSON.stringify(src.order_template.body_template, null, 2)
      : '',
  };
}

export function UpstreamSourceDrawer({
  editingSourceId,
  editingSourceMeta,
  categories,
  onClose,
  onSaved,
  onStorefrontUpdated,
  showToast,
}: UpstreamSourceDrawerProps) {
  const d = useAdminUpstreamDrawerI18n();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const fallbackCategoryId = categories[0]?.id || 1;
  const creationIntent = useRef('');
  const createdSource = useRef<{ id: number; body: string } | null>(null);
  const [createdSourceId, setCreatedSourceId] = useState<number | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('connection');
  const [sourceDraft, setSourceDraft] = useState<SourceEditorDraft>(() =>
    emptySourceDraft(fallbackCategoryId)
  );
  const [includeInput, setIncludeInput] = useState('');
  const [excludeInput, setExcludeInput] = useState('');
  const [savingMode, setSavingMode] = useState<null | 'save' | 'save_sync'>(null);
  const [drawerError, setDrawerError] = useState('');

  useEffect(() => {
    creationIntent.current = editingSourceId === 'new' ? crypto.randomUUID() : '';
    createdSource.current = null;
    setCreatedSourceId(null);
    if (editingSourceId === 'new') {
      setSourceDraft(emptySourceDraft(fallbackCategoryId));
    } else if (editingSourceMeta) {
      setSourceDraft(buildDraftFromSource(editingSourceMeta, fallbackCategoryId));
    }
    setIncludeInput('');
    setExcludeInput('');
    setDrawerTab('connection');
    setDrawerError('');
  }, [editingSourceId, editingSourceMeta, fallbackCategoryId]);

  useEffect(() => {
    const dlg = drawerRef.current;
    if (!dlg) return;
    if (editingSourceId !== null) {
      if (!dlg.open) dlg.showModal();
    } else if (dlg.open) {
      dlg.close();
    }
    return attachDialogLightDismissFallback(dlg, onClose);
  }, [editingSourceId, onClose]);

  const closeEditorDrawer = () => {
    void closeDialogSmoothly(drawerRef.current).then(onClose);
  };

  const addKeywordChips = (kind: 'include' | 'exclude', rawText: string) => {
    const tokens = rawText
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;
    const field = kind === 'include' ? 'include_keywords' : 'exclude_keywords';
    const existing = sourceDraft.filter_rules[field] || [];
    setSourceDraft((prev) => ({
      ...prev,
      filter_rules: { ...prev.filter_rules, [field]: Array.from(new Set([...existing, ...tokens])) },
    }));
    if (kind === 'include') setIncludeInput('');
    else setExcludeInput('');
  };

  const removeKeywordChip = (kind: 'include' | 'exclude', word: string) => {
    const field = kind === 'include' ? 'include_keywords' : 'exclude_keywords';
    setSourceDraft((prev) => ({
      ...prev,
      filter_rules: {
        ...prev.filter_rules,
        [field]: (prev.filter_rules[field] || []).filter((w) => w !== word),
      },
    }));
  };

  const persistSource = async (andSync: boolean) => {
    setDrawerError('');
    if (!sourceDraft.name.trim()) {
      setDrawerTab('connection');
      setDrawerError(d.errNoName);
      return;
    }
    if (sourceDraft.adapter_type !== 'mock_sandbox' && !sourceDraft.base_url.trim()) {
      setDrawerTab('connection');
      setDrawerError(d.errNoUrl);
      return;
    }
    let parsedBodyTpl: Record<string, unknown> | undefined;
    if (sourceDraft.body_template_text.trim()) {
      try {
        parsedBodyTpl = JSON.parse(sourceDraft.body_template_text);
      } catch {
        setDrawerTab('protocol');
        setDrawerError(d.errInvalidBodyTpl);
        return;
      }
    }

    const extraInc = includeInput
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const extraExc = excludeInput
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const payload: UpstreamSourceInput = {
      name: sourceDraft.name.trim(),
      adapter_type: sourceDraft.adapter_type,
      auth_mode: sourceDraft.auth_mode,
      app_id: sourceDraft.app_id,
      base_url: sourceDraft.base_url,
      order_url: sourceDraft.order_url,
      query_order_url: sourceDraft.query_order_url,
      balance_url: sourceDraft.balance_url,
      ...(sourceDraft.api_key?.trim() ? { api_key: sourceDraft.api_key.trim() } : {}),
      ...(sourceDraft.api_secret?.trim() ? { api_secret: sourceDraft.api_secret.trim() } : {}),
      ...(sourceDraft.webhook_secret?.trim() ? { webhook_secret: sourceDraft.webhook_secret.trim() } : {}),
      proxy_relay_url: sourceDraft.proxy_relay_url,
      ...(sourceDraft.proxy_relay_token?.trim()
        ? { proxy_relay_token: sourceDraft.proxy_relay_token.trim() }
        : {}),
      auth_header: sourceDraft.auth_header,
      auth_prefix: sourceDraft.auth_prefix,
      field_mapping: sourceDraft.field_mapping,
      filter_rules: {
        ...sourceDraft.filter_rules,
        include_keywords: Array.from(
          new Set([...(sourceDraft.filter_rules.include_keywords || []), ...extraInc])
        ),
        exclude_keywords: Array.from(
          new Set([...(sourceDraft.filter_rules.exclude_keywords || []), ...extraExc])
        ),
      },
      pricing_rules: sourceDraft.pricing_rules,
      order_template: {
        method: sourceDraft.order_template?.method || 'POST',
        content_type: sourceDraft.order_template?.content_type || 'json',
        ...(parsedBodyTpl ? { body_template: parsedBodyTpl } : {}),
      },
      response_mapping: sourceDraft.response_mapping,
      out_of_stock_action: sourceDraft.out_of_stock_action,
      auto_republish_on_restock: sourceDraft.auto_republish_on_restock,
      default_category_id: sourceDraft.default_category_id,
      sync_interval_minutes: sourceDraft.sync_interval_minutes,
      auto_sync_enabled: sourceDraft.auto_sync_enabled,
      low_balance_threshold: sourceDraft.low_balance_threshold,
      sandbox_mode: sourceDraft.sandbox_mode,
      status: sourceDraft.status,
    };

    setSavingMode(andSync ? 'save_sync' : 'save');
    try {
      let targetId: number;
      if (editingSourceId === 'new') {
        const body = JSON.stringify(payload);
        if (createdSource.current) {
          targetId = createdSource.current.id;
          if (body !== createdSource.current.body) {
            await upstreamApi.updateSource(targetId, payload);
            createdSource.current = { id: targetId, body };
          }
        } else {
          const res = await upstreamApi.createSource(payload, creationIntent.current);
          targetId = res.id;
          createdSource.current = { id: targetId, body };
          setCreatedSourceId(targetId);
        }
      } else {
        targetId = editingSourceId as number;
        await upstreamApi.updateSource(targetId, payload);
      }
      if (andSync) {
        const syncRes = await upstreamApi.syncSource(targetId);
        if (!syncRes.ok) throw new Error(syncRes.message);
        showToast(fmt(d.savedAndSyncToast, { msg: syncRes.message }));
        onStorefrontUpdated();
      } else {
        showToast(
          editingSourceId === 'new'
            ? fmt(d.createdToast, { name: payload.name })
            : fmt(d.updatedToast, { name: payload.name })
        );
      }
      if (drawerRef.current) await closeDialogSmoothly(drawerRef.current);
      onClose();
      await onSaved(targetId);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : d.saveFailedFallback);
    } finally {
      setSavingMode(null);
    }
  };

  const drawerTabs: Array<{
    id: DrawerTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'connection', label: d.tabConnection, icon: PlugZap },
    { id: 'protocol', label: d.tabProtocol, icon: Code2 },
    { id: 'filters', label: d.tabFilters, icon: Filter },
    { id: 'pricing', label: d.tabPricing, icon: Sliders },
  ];

  return (
    <dialog
      ref={drawerRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      className="acct-dialog acct-drawer"
      style={{ maxWidth: 'min(96vw, 48rem)' }}
    >
      <div className="h-full flex flex-col">
        <div
          className="px-6 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div>
            <div
              className="text-[10.5px] font-mono-num uppercase tracking-widest"
              style={{ color: 'var(--accent)' }}
            >
              UPSTREAM CONNECTOR ENGINE
            </div>
            <h2 className="font-editorial text-xl font-semibold">
              {editingSourceId === 'new' && createdSourceId === null
                ? d.drawerTitleNew
                : fmt(d.drawerTitleEdit, { name: sourceDraft.name })}
            </h2>
          </div>
          <button
            type="button"
            onClick={closeEditorDrawer}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div
          className="px-6 py-2.5 border-b flex items-center gap-1.5 overflow-x-auto shrink-0"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          {drawerTabs.map((t) => {
            const Icon = t.icon;
            const active = drawerTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setDrawerTab(t.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-surface)',
                  color: active ? '#FAF9F5' : 'var(--ink-secondary)',
                  border: `1px solid ${active ? 'transparent' : 'var(--border-color)'}`,
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4 text-xs">
          {drawerError && (
            <div
              className="p-3 rounded-xl"
              style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              {drawerError}
            </div>
          )}

          {drawerTab === 'connection' && (
            <UpstreamDrawerConnectionTab
              sourceDraft={sourceDraft}
              setSourceDraft={setSourceDraft}
              editingSourceMeta={editingSourceMeta}
            />
          )}
          {drawerTab === 'protocol' && (
            <UpstreamDrawerProtocolTab
              sourceDraft={sourceDraft}
              setSourceDraft={setSourceDraft}
              editingSourceMeta={editingSourceMeta}
            />
          )}
          {drawerTab === 'filters' && (
            <UpstreamDrawerFiltersTab
              sourceDraft={sourceDraft}
              setSourceDraft={setSourceDraft}
              includeInput={includeInput}
              setIncludeInput={setIncludeInput}
              excludeInput={excludeInput}
              setExcludeInput={setExcludeInput}
              onAddKeywords={addKeywordChips}
              onRemoveKeyword={removeKeywordChip}
            />
          )}
          {drawerTab === 'pricing' && (
            <UpstreamDrawerPricingTab
              sourceDraft={sourceDraft}
              setSourceDraft={setSourceDraft}
              categories={categories}
            />
          )}
        </div>

        <div
          className="px-6 py-4 border-t flex items-center justify-end gap-2 shrink-0"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <button
            type="button"
            onClick={closeEditorDrawer}
            className="px-4 py-2 rounded-xl border text-xs font-medium cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {d.cancelBtn}
          </button>
          <button
            type="button"
            disabled={savingMode !== null}
            onClick={() => void persistSource(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer"
            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            <Save className="w-3.5 h-3.5" />
            {savingMode === 'save' ? d.savingBtn : d.saveOnlyBtn}
          </button>
          <button
            type="button"
            disabled={savingMode !== null}
            onClick={() => void persistSource(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${savingMode === 'save_sync' ? 'animate-spin' : ''}`} />
            {savingMode === 'save_sync' ? d.saveSyncingBtn : d.saveSyncBtn}
          </button>
        </div>
      </div>
    </dialog>
  );
}
