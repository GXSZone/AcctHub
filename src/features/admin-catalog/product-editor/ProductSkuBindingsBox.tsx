/**
 * 商品 SKU 级多上游货源路由绑定面板（仅总管理员可见）
 */

import { GitBranch, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  type UpstreamBindingRecord,
  type UpstreamSourceRecord,
  upstreamApi,
} from '../../../api/upstream.api';
import { fmt } from '../../../i18n';
import { useAdminProductEditorI18n } from '../../../i18n/namespaces/admin-product-editor';
import type { ProductSpec } from '../../../types';

interface ProductSkuBindingsBoxProps {
  productId: number;
  specs: ProductSpec[];
  skuBindings: UpstreamBindingRecord[];
  upSources: UpstreamSourceRecord[];
  onReloadBindings: (pid: number) => Promise<void>;
}

export function ProductSkuBindingsBox({
  productId,
  specs,
  skuBindings,
  upSources,
  onReloadBindings,
}: ProductSkuBindingsBoxProps) {
  const ape = useAdminProductEditorI18n();
  const [newBindSpecId, setNewBindSpecId] = useState(specs[0]?.id || 'default');
  const [newBindSourceId, setNewBindSourceId] = useState(upSources[0]?.id || 0);
  const [newBindItemId, setNewBindItemId] = useState('');
  const [newBindUpSpecId, setNewBindUpSpecId] = useState('');
  const [newBindMode, setNewBindMode] = useState<'local_first' | 'upstream_only'>('local_first');
  const [newBindStrategy, setNewBindStrategy] = useState<'priority' | 'lowest_cost'>('priority');
  const [newBindPriority, setNewBindPriority] = useState(10);
  const [bindBusy, setBindBusy] = useState(false);

  const effectiveSourceId = newBindSourceId || upSources[0]?.id || 0;

  return (
    <div
      className="mt-4 p-4 rounded-2xl border space-y-3 text-xs"
      style={{
        borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border-color))',
        backgroundColor: 'var(--bg-canvas)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--accent)' }}>
          <GitBranch className="w-4 h-4" />
          {ape.peBindTitle}
        </div>
        <span className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
          {fmt(ape.peBindCount, { count: skuBindings.length })}
        </span>
      </div>

      {skuBindings.length > 0 && (
        <div className="space-y-2">
          {skuBindings.map((b) => (
            <div
              key={b.id}
              className="p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
            >
              <div className="min-w-0">
                <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                  <span
                    className="font-mono-num px-1.5 py-0.5 rounded text-[10.5px]"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    SKU: {b.spec_id}
                  </span>
                  <span>→ {b.source_name}</span>
                  <span className="font-mono-num text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                    ({b.upstream_item_id}
                    {b.upstream_spec_id ? `/${b.upstream_spec_id}` : ''})
                  </span>
                </div>
                <div className="text-[11px] mt-0.5 font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                  {fmt(ape.peBindMeta, {
                    priority: b.priority,
                    cost: Number(b.cached_cost).toFixed(2),
                    stock: b.cached_stock,
                    mode:
                      b.fulfillment_mode === 'upstream_only'
                        ? ape.peBindModeUpstream
                        : ape.peBindModeLocalFirst,
                    strategy:
                      b.routing_strategy === 'lowest_cost'
                        ? ape.peBindStrategyCost
                        : ape.peBindStrategyPriority,
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await upstreamApi.deleteBinding(b.id, productId);
                  await onReloadBindings(productId);
                }}
                className="p-1.5 rounded-lg cursor-pointer"
                style={{ color: 'var(--danger)' }}
                title={ape.peBindRemoveTitle}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {upSources.length > 0 && (
        <div
          className="grid grid-cols-1 sm:grid-cols-6 gap-2 pt-2 border-t"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <select
            value={newBindSpecId}
            onChange={(e) => setNewBindSpecId(e.target.value)}
            className="acct-input py-1.5 text-[11px] sm:col-span-2"
          >
            {specs.length > 0 ? (
              specs.map((s) => (
                <option key={s.id} value={s.id}>
                  SKU: {s.name} ({s.id})
                </option>
              ))
            ) : (
              <option value="default">{ape.peBindDefaultSpecOpt}</option>
            )}
          </select>
          <select
            value={effectiveSourceId}
            onChange={(e) => setNewBindSourceId(Number(e.target.value))}
            className="acct-input py-1.5 text-[11px] sm:col-span-2"
          >
            {upSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            value={newBindItemId}
            onChange={(e) => setNewBindItemId(e.target.value)}
            placeholder={ape.peBindItemIdPh}
            className="acct-input py-1.5 font-mono-num text-[11px]"
          />
          <input
            value={newBindUpSpecId}
            onChange={(e) => setNewBindUpSpecId(e.target.value)}
            placeholder={ape.peBindSpecIdPh}
            className="acct-input py-1.5 font-mono-num text-[11px]"
          />
          <select
            value={newBindMode}
            onChange={(e) => setNewBindMode(e.target.value as 'local_first' | 'upstream_only')}
            className="acct-input py-1.5 text-[11px] sm:col-span-2"
          >
            <option value="local_first">{ape.peBindOptLocalFirst}</option>
            <option value="upstream_only">{ape.peBindOptUpstreamOnly}</option>
          </select>
          <select
            value={newBindStrategy}
            onChange={(e) => setNewBindStrategy(e.target.value as 'priority' | 'lowest_cost')}
            className="acct-input py-1.5 text-[11px] sm:col-span-2"
          >
            <option value="priority">{ape.peBindOptPriority}</option>
            <option value="lowest_cost">{ape.peBindOptLowestCost}</option>
          </select>
          <input
            type="number"
            min={1}
            value={newBindPriority}
            onChange={(e) => setNewBindPriority(Number(e.target.value) || 10)}
            placeholder={ape.peBindPriorityPh}
            className="acct-input py-1.5 font-mono-num text-[11px]"
          />
          <button
            type="button"
            disabled={bindBusy || !newBindItemId.trim() || !effectiveSourceId}
            onClick={async () => {
              if (!newBindItemId.trim() || !effectiveSourceId) return;
              setBindBusy(true);
              try {
                await upstreamApi.saveBinding({
                  product_id: productId,
                  spec_id: newBindSpecId || 'default',
                  source_id: effectiveSourceId,
                  upstream_item_id: newBindItemId.trim(),
                  upstream_spec_id: newBindUpSpecId.trim(),
                  fulfillment_mode: newBindMode,
                  routing_strategy: newBindStrategy,
                  priority: newBindPriority,
                });
                setNewBindItemId('');
                setNewBindUpSpecId('');
                await onReloadBindings(productId);
              } finally {
                setBindBusy(false);
              }
            }}
            className="px-3 py-1.5 rounded-xl font-semibold cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {ape.peBindAddBtn}
          </button>
        </div>
      )}
    </div>
  );
}
