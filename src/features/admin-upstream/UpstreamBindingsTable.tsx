/**
 * SKU 级多上游路由矩阵与一键预拉囤货表格组件
 */

import { AlertTriangle, Download, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type UpstreamBindingRecord, upstreamApi } from '../../api/upstream.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';

interface UpstreamBindingsTableProps {
  bindings: UpstreamBindingRecord[];
  onReloadAll: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function UpstreamBindingsTable({
  bindings,
  onReloadAll,
  onStorefrontUpdated,
  showToast,
}: UpstreamBindingsTableProps) {
  const au = useAdminUpstreamI18n();
  const [pullQtyMap, setPullQtyMap] = useState<Record<number, number>>({});
  const [pullingBindingId, setPullingBindingId] = useState<number | null>(null);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<number, number>>({});

  const handlePullCards = async (b: UpstreamBindingRecord) => {
    const qty = Math.max(1, Math.min(50, Number(pullQtyMap[b.id] || 5)));
    const ok = await openConfirm({
      title: au.pullConfirmTitle,
      description: fmt(au.pullConfirmDesc, {
        sourceName: b.source_name,
        qty,
        estCost: (b.cached_cost * qty).toFixed(2),
      }),
      confirmLabel: fmt(au.pullConfirmBtn, { qty }),
      tone: 'accent',
    });
    if (!ok) return;
    setPullingBindingId(b.id);
    try {
      const res = await upstreamApi.pullCards(b.id, qty);
      showToast(
        fmt(au.pullSuccessToast, {
          imported: res.imported,
          orderNo: res.upstreamOrderNo,
          cost: res.cost,
        })
      );
      await onReloadAll();
      onStorefrontUpdated();
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.pullFailedFallback);
    } finally {
      setPullingBindingId(null);
    }
  };

  return (
    <div className="paper-card rounded-2xl p-5 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h3 className="font-editorial text-lg font-semibold">{au.bindingsTitle}</h3>
          <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
            {au.bindingsDesc}
          </p>
        </div>
        <span className="text-xs font-mono-num" style={{ color: 'var(--ink-muted)' }}>
          {fmt(au.bindingsCount, { count: bindings.length })}
        </span>
      </div>

      {bindings.length === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: 'var(--ink-muted)' }}>
          {au.bindingsEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-3">{au.colLocalSku}</th>
                <th className="py-2 pr-3">{au.colSourceCode}</th>
                <th className="py-2 pr-3">{au.colModeStrategy}</th>
                <th className="py-2 pr-3">{au.colCostStock}</th>
                <th className="py-2 pr-3">{au.colStatus}</th>
                <th className="py-2 text-right">{au.colPullOps}</th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((b) => (
                <tr
                  key={b.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold max-w-[180px] truncate">
                        {b.product_title || fmt(au.fallbackProductTitle, { id: b.product_id })}
                      </span>
                    </div>
                    <div
                      className="text-[11px] font-mono-num flex items-center gap-1.5 mt-0.5"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      <span>{fmt(au.skuPriorityLabel, { specId: b.spec_id })}</span>
                      <input
                        type="number"
                        min={1}
                        max={999}
                        value={priorityDrafts[b.id] ?? b.priority}
                        onChange={(e) =>
                          setPriorityDrafts((prev) => ({ ...prev, [b.id]: Number(e.target.value) || 10 }))
                        }
                        onBlur={async () => {
                          const nextVal = Math.max(
                            1,
                            Math.min(999, Number(priorityDrafts[b.id] ?? b.priority))
                          );
                          if (nextVal !== b.priority) {
                            await upstreamApi.updateBinding(b.id, b.product_id, { priority: nextVal });
                            await onReloadAll();
                            showToast(fmt(au.prioritySavedToast, { val: nextVal }));
                          }
                        }}
                        className="acct-input w-12 py-0.5 px-1 text-[11px] font-mono-num text-center"
                        title={au.priorityTitle}
                      />
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{b.source_name}</div>
                    <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                      {b.upstream_item_id}
                      {b.upstream_spec_id ? ` / ${b.upstream_spec_id}` : ''}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <select
                        value={b.fulfillment_mode}
                        onChange={async (e) => {
                          await upstreamApi.updateBinding(b.id, b.product_id, {
                            fulfillment_mode: e.target.value as 'local_first' | 'upstream_only',
                          });
                          await onReloadAll();
                          onStorefrontUpdated();
                          showToast(au.modeChangedToast);
                        }}
                        className="acct-input py-1 px-2 text-[11px] w-auto"
                      >
                        <option value="local_first">{au.modeLocalFirst}</option>
                        <option value="upstream_only">{au.modeUpstreamOnly}</option>
                      </select>
                      <select
                        value={b.routing_strategy}
                        onChange={async (e) => {
                          await upstreamApi.updateBinding(b.id, b.product_id, {
                            routing_strategy: e.target.value as 'priority' | 'lowest_cost',
                          });
                          await onReloadAll();
                          showToast(au.strategyChangedToast);
                        }}
                        className="acct-input py-1 px-2 text-[11px] w-auto"
                      >
                        <option value="priority">{au.strategyPriority}</option>
                        <option value="lowest_cost">{au.strategyLowestCost}</option>
                      </select>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono-num">
                    <div className="font-semibold">¥{Number(b.cached_cost).toFixed(2)}</div>
                    <div
                      className="text-[11px]"
                      style={{ color: b.cached_stock > 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {fmt(au.cachedStockLabel, { stock: b.cached_stock })}
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    {b.circuit_broken_reason ? (
                      <div className="space-y-1">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                          title={b.circuit_broken_reason}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {au.circuitBroken}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await upstreamApi.updateBinding(b.id, b.product_id, {
                              is_enabled: true,
                              reset_circuit: true,
                            });
                            await onReloadAll();
                            showToast(au.resetCircuitToast);
                          }}
                          className="block text-[10.5px] underline cursor-pointer"
                          style={{ color: 'var(--accent)' }}
                        >
                          {au.resetCircuitBtn}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await upstreamApi.updateBinding(b.id, b.product_id, { is_enabled: !b.is_enabled });
                          await onReloadAll();
                          onStorefrontUpdated();
                        }}
                        className="px-2 py-0.5 rounded-full text-[10.5px] font-medium cursor-pointer"
                        style={{
                          backgroundColor: b.is_enabled ? 'var(--success-soft)' : 'var(--bg-subtle)',
                          color: b.is_enabled ? 'var(--success)' : 'var(--ink-muted)',
                        }}
                      >
                        {b.is_enabled ? au.routeEnabled : au.routePaused}
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={pullQtyMap[b.id] ?? 5}
                        onChange={(e) =>
                          setPullQtyMap((prev) => ({
                            ...prev,
                            [b.id]: Math.max(1, Number(e.target.value) || 1),
                          }))
                        }
                        className="acct-input w-14 py-1 px-1.5 text-[11px] font-mono-num text-center"
                        title={au.pullQtyTitle}
                      />
                      <button
                        type="button"
                        disabled={pullingBindingId === b.id || b.adapter_type === 'mock_sandbox'}
                        onClick={() => void handlePullCards(b)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        {pullingBindingId === b.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3" />
                        )}
                        {au.pullBtn}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await upstreamApi.deleteBinding(b.id, b.product_id);
                          await onReloadAll();
                          onStorefrontUpdated();
                          showToast(au.routeDeletedToast);
                        }}
                        className="p-1 rounded cursor-pointer"
                        style={{ color: 'var(--danger)' }}
                        title={au.deleteRouteTooltip}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
