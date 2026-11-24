/**
 * 上游货源池卡片网格、余额监控与契约测试预览视图
 */

import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  type UpstreamNormalizedPreview,
  type UpstreamSourceRecord,
  upstreamApi,
} from '../../api/upstream.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import { useAdminUpstreamDrawerI18n } from '../../i18n/namespaces/admin-upstream-drawer';
import { buildAdapterLabelMap } from './upstream-constants';

interface UpstreamSourcesTabProps {
  sources: UpstreamSourceRecord[];
  syncingId: number | null;
  onEditSource: (src: UpstreamSourceRecord) => void;
  onSyncSource: (src: UpstreamSourceRecord) => Promise<void>;
  onReloadSources: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function UpstreamSourcesTab({
  sources,
  syncingId,
  onEditSource,
  onSyncSource,
  onReloadSources,
  showToast,
}: UpstreamSourcesTabProps) {
  const au = useAdminUpstreamI18n();
  const drawerDict = useAdminUpstreamDrawerI18n();
  const adapterLabelMap = buildAdapterLabelMap(drawerDict);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [checkingBalId, setCheckingBalId] = useState<number | null>(null);
  const [copiedWebhookId, setCopiedWebhookId] = useState<number | null>(null);
  const [testPreview, setTestPreview] = useState<{
    sourceName: string;
    count: number;
    balance?: number | null;
    preview: UpstreamNormalizedPreview[];
  } | null>(null);

  const webhookBaseOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  const handleTestSource = async (src: UpstreamSourceRecord) => {
    setTestingId(src.id);
    try {
      const res = await upstreamApi.testSource(src.id);
      setTestPreview({ sourceName: src.name, count: res.count, balance: res.balance, preview: res.preview });
      showToast(
        fmt(au.testSuccessToast, {
          count: res.count,
          balPart:
            res.balance !== null && res.balance !== undefined
              ? fmt(au.testSuccessBalPart, { balance: res.balance })
              : '',
        })
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.testFailedFallback);
    } finally {
      setTestingId(null);
    }
  };

  const handleCheckBalance = async (src: UpstreamSourceRecord) => {
    setCheckingBalId(src.id);
    try {
      const res = await upstreamApi.checkBalance(src.id);
      if (res.error) {
        showToast(fmt(au.balErrToast, { error: res.error }));
      } else if (res.balance !== null) {
        showToast(
          fmt(au.balOkToast, {
            name: src.name,
            balance: res.balance.toFixed(2),
            lowPart: res.low_balance ? au.balLowPart : '',
          })
        );
        await onReloadSources();
      } else {
        showToast(au.balMissingToast);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.balFailedFallback);
    } finally {
      setCheckingBalId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sources.map((src) => {
          const adapterMeta = adapterLabelMap[src.adapter_type] || {
            label: src.adapter_type,
            short: src.adapter_type,
          };
          const isLowBal =
            src.cached_balance !== null &&
            src.cached_balance !== undefined &&
            src.low_balance_threshold > 0 &&
            src.cached_balance < src.low_balance_threshold;
          const webhookUrl = `${webhookBaseOrigin}/api/webhooks/upstream/${src.id}`;

          return (
            <div
              key={src.id}
              className="paper-card rounded-2xl p-5 border space-y-4"
              style={{ borderColor: isLowBal ? 'var(--danger)' : 'var(--border-color)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-editorial text-lg font-semibold truncate">{src.name}</h3>
                    <span
                      className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: src.status === 'active' ? 'var(--success-soft)' : 'var(--bg-subtle)',
                        color: src.status === 'active' ? 'var(--success)' : 'var(--ink-muted)',
                      }}
                    >
                      {src.status === 'active' ? au.statusActive : au.statusDisabled}
                    </span>
                    {src.proxy_relay_url && (
                      <span
                        className="text-[10.5px] font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        title={fmt(au.relayTitle, { url: src.proxy_relay_url })}
                      >
                        {au.relayBadge}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[11px] font-mono-num mt-1 truncate"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    {adapterMeta.short} ({src.auth_mode || 'header_bearer'}) ·{' '}
                    {src.base_url || 'sandbox://builtin'}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onEditSource(src)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {au.editSourceBtn}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await openConfirm({
                        title: au.deleteConfirmTitle,
                        description: fmt(au.deleteConfirmDesc, { name: src.name }),
                        confirmLabel: au.deleteConfirmBtn,
                        tone: 'danger',
                      });
                      if (!ok) return;
                      await upstreamApi.deleteSource(src.id);
                      showToast(fmt(au.deleteSuccessToast, { name: src.name }));
                      await onReloadSources();
                    }}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--danger)' }}
                    title={au.deleteSourceTooltip}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div
                  className="p-2.5 rounded-xl border"
                  style={{
                    backgroundColor: isLowBal ? 'var(--danger-soft)' : 'var(--bg-canvas)',
                    borderColor: isLowBal ? 'var(--danger)' : 'transparent',
                  }}
                >
                  <div
                    className="text-[10.5px] flex items-center justify-center gap-1"
                    style={{ color: isLowBal ? 'var(--danger)' : 'var(--ink-muted)' }}
                  >
                    <Wallet className="w-3 h-3" />
                    {au.kpiBalance}
                  </div>
                  <div
                    className="font-mono-num text-sm font-bold mt-0.5"
                    style={{ color: isLowBal ? 'var(--danger)' : 'var(--ink-primary)' }}
                  >
                    {src.cached_balance !== null && src.cached_balance !== undefined
                      ? `¥${Number(src.cached_balance).toFixed(2)}`
                      : au.kpiBalanceUnset}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                  <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {au.kpiTotalItems}
                  </div>
                  <div className="font-mono-num text-sm font-semibold mt-0.5">{src.total_items}</div>
                </div>
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                  <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {au.kpiActiveBindings}
                  </div>
                  <div
                    className="font-mono-num text-sm font-semibold mt-0.5"
                    style={{ color: 'var(--success)' }}
                  >
                    {src.active_bindings ?? src.collected_items}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                  <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    {au.kpiSoldOut}
                  </div>
                  <div
                    className="font-mono-num text-sm font-semibold mt-0.5"
                    style={{ color: 'var(--danger)' }}
                  >
                    {src.sold_out_items}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span
                  className="px-2 py-0.5 rounded-md font-mono-num"
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  {fmt(au.markupChip, { pct: src.pricing_rules?.markup_percent ?? 20 })}
                </span>
                <span
                  className="px-2 py-0.5 rounded-md font-mono-num"
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  {fmt(au.lowBalChip, { threshold: src.low_balance_threshold ?? 100 })}
                </span>
                <span
                  className="px-2 py-0.5 rounded-md font-mono-num"
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
                  {src.auto_sync_enabled
                    ? fmt(au.syncCron, { mins: src.sync_interval_minutes })
                    : au.syncManual}
                </span>
                {src.adapter_type === 'mock_sandbox' && src.sandbox_mode !== 'normal' && (
                  <span
                    className="px-2 py-0.5 rounded-md font-mono-num"
                    style={{ backgroundColor: 'var(--warning-soft)', color: 'var(--warning)' }}
                  >
                    {fmt(au.sandboxModeTag, { mode: src.sandbox_mode })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(webhookUrl);
                    setCopiedWebhookId(src.id);
                    showToast(au.webhookCopiedToast);
                    setTimeout(() => setCopiedWebhookId(null), 1500);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--ink-secondary)' }}
                  title={webhookUrl}
                >
                  {copiedWebhookId === src.id ? (
                    <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {au.copyWebhookBtn}
                </button>
              </div>

              <div
                className="pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-[11px]"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div
                  className="min-w-0 flex-1 truncate"
                  style={{ color: 'var(--ink-muted)' }}
                  title={src.last_sync_message || ''}
                >
                  {src.last_sync_at ? `${src.last_sync_at} · ${src.last_sync_message || ''}` : au.neverSynced}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={checkingBalId === src.id}
                    onClick={() => void handleCheckBalance(src)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-50"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    {checkingBalId === src.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wallet className="w-3.5 h-3.5" />
                    )}
                    {au.checkBalanceBtn}
                  </button>
                  <button
                    type="button"
                    disabled={testingId === src.id}
                    onClick={() => void handleTestSource(src)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-50"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    {testingId === src.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    {au.testContractBtn}
                  </button>
                  <button
                    type="button"
                    disabled={syncingId === src.id}
                    onClick={() => void onSyncSource(src)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingId === src.id ? 'animate-spin' : ''}`} />
                    {au.syncBtn}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {testPreview && (
        <div
          className="paper-card rounded-2xl p-5 border space-y-3"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--success)' }} />
              {fmt(au.previewTitlePrefix, { name: testPreview.sourceName, count: testPreview.count })}
              {testPreview.balance !== null && testPreview.balance !== undefined
                ? fmt(au.previewBalanceSuffix, { balance: testPreview.balance })
                : ''}
              {au.previewTitleClose}
            </div>
            <button type="button" onClick={() => setTestPreview(null)} className="p-1 rounded cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-3">{au.previewColId}</th>
                  <th className="py-2 pr-3">{au.previewColTitle}</th>
                  <th className="py-2 pr-3">{au.previewColCost}</th>
                  <th className="py-2 pr-3">{au.previewColStock}</th>
                  <th className="py-2">{au.previewColStatus}</th>
                </tr>
              </thead>
              <tbody>
                {testPreview.preview.map((row) => (
                  <tr
                    key={row.upstream_item_id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <td className="py-2 pr-3 font-mono-num">{row.upstream_item_id}</td>
                    <td className="py-2 pr-3 font-medium">{row.raw_title}</td>
                    <td className="py-2 pr-3 font-mono-num">¥{row.raw_price}</td>
                    <td className="py-2 pr-3 font-mono-num">{row.raw_stock}</td>
                    <td className="py-2">{row.raw_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
