/**
 * 将上游商品挂载为本地已有商品 SKU 主/备货源的内联配置卡片
 */

import { GitBranch, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { type UpstreamItemRecord, upstreamApi } from '../../api/upstream.api';
import { fmt } from '../../i18n';
import { useAdminUpstreamI18n } from '../../i18n/namespaces/admin-upstream';
import type { ProductSpec } from '../../types';

export interface AdminProductBrief {
  id: number;
  title: string;
  specs: ProductSpec[];
}

interface UpstreamBindSkuCardProps {
  item: UpstreamItemRecord | null;
  products: AdminProductBrief[];
  onClose: () => void;
  onBound: () => Promise<void>;
  onStorefrontUpdated: () => void;
  showToast: (msg: string) => void;
}

export function UpstreamBindSkuCard({
  item,
  products,
  onClose,
  onBound,
  onStorefrontUpdated,
  showToast,
}: UpstreamBindSkuCardProps) {
  const au = useAdminUpstreamI18n();
  const [targetProductId, setTargetProductId] = useState<number>(products[0]?.id || 0);
  const [targetSpecId, setTargetSpecId] = useState<string>('default');
  const [upstreamSpecId, setUpstreamSpecId] = useState<string>('');
  const [mode, setMode] = useState<'local_first' | 'upstream_only'>('local_first');
  const [strategy, setStrategy] = useState<'priority' | 'lowest_cost'>('priority');
  const [priority, setPriority] = useState<number>(10);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    const firstProd = products[0];
    setTargetProductId(firstProd?.id || 0);
    setTargetSpecId(firstProd?.specs?.[0]?.id || 'default');
    setUpstreamSpecId(item.raw_specs?.[0]?.id || '');
    setMode('local_first');
    setStrategy('priority');
    setPriority(10);
  }, [item, products]);

  if (!item) return null;

  const selectedBindProduct = products.find((p) => p.id === targetProductId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProductId) return;
    setSaving(true);
    try {
      await upstreamApi.saveBinding({
        product_id: targetProductId,
        spec_id: targetSpecId || 'default',
        source_id: item.source_id,
        upstream_item_id: item.upstream_item_id,
        upstream_spec_id: upstreamSpecId,
        fulfillment_mode: mode,
        routing_strategy: strategy,
        priority,
      });
      onClose();
      await onBound();
      onStorefrontUpdated();
      showToast(au.bindSuccessToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : au.bindFailedFallback);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="paper-card rounded-2xl p-5 border space-y-4"
      style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
          <GitBranch className="w-4 h-4" />
          {fmt(au.bindTitle, { title: item.raw_title })}
        </div>
        <button type="button" onClick={onClose} className="p-1 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindTargetProduct}</div>
          <select
            value={targetProductId}
            onChange={(e) => {
              const pid = Number(e.target.value);
              setTargetProductId(pid);
              const p = products.find((x) => x.id === pid);
              setTargetSpecId(p?.specs?.[0]?.id || 'default');
            }}
            className="acct-input text-xs"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                #{p.id} {p.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindTargetSpec}</div>
          <select
            value={targetSpecId}
            onChange={(e) => setTargetSpecId(e.target.value)}
            className="acct-input text-xs"
          >
            {selectedBindProduct && selectedBindProduct.specs.length > 0 ? (
              selectedBindProduct.specs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id}) · ¥{s.price}
                </option>
              ))
            ) : (
              <option value="default">{au.bindDefaultSpec}</option>
            )}
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindUpstreamSpec}</div>
          {item.raw_specs && item.raw_specs.length > 0 ? (
            <select
              value={upstreamSpecId}
              onChange={(e) => setUpstreamSpecId(e.target.value)}
              className="acct-input text-xs"
            >
              <option value="">{au.bindWholeDefault}</option>
              {item.raw_specs.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} (¥{sp.price})
                </option>
              ))}
            </select>
          ) : (
            <input
              value={upstreamSpecId}
              onChange={(e) => setUpstreamSpecId(e.target.value)}
              placeholder={au.bindUpstreamSpecPh}
              className="acct-input text-xs"
            />
          )}
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindModeLabel}</div>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'local_first' | 'upstream_only')}
            className="acct-input text-xs"
          >
            <option value="local_first">{au.bindModeLocalFirst}</option>
            <option value="upstream_only">{au.bindModeUpstreamOnly}</option>
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindStrategyLabel}</div>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as 'priority' | 'lowest_cost')}
            className="acct-input text-xs"
          >
            <option value="priority">{au.bindStrategyPriority}</option>
            <option value="lowest_cost">{au.bindStrategyLowestCost}</option>
          </select>
        </div>
        <div>
          <div className="block text-[11px] font-semibold mb-1">{au.bindPriorityLabel}</div>
          <input
            type="number"
            min={1}
            max={999}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value) || 10)}
            className="acct-input font-mono-num text-xs"
          />
        </div>
        <div className="sm:col-span-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl border text-xs cursor-pointer"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            {au.cancelBtn}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {saving ? au.savingBtn : au.bindConfirmBtn}
          </button>
        </div>
      </form>
    </div>
  );
}
