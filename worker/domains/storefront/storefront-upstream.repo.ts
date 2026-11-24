import { and, eq } from 'drizzle-orm';
import { productUpstreamBindings, upstreamSources } from '../../db/schema/index';
import type { Env } from '../../env';
import type { AppDatabase } from '../../infra/db';
import { isSupplierProcurementEnabled } from '../upstream/upstream.order.adapter';

export interface UpstreamStockMaps {
  byProduct: Map<number, number>;
  byProductSpec: Map<string, number>;
  upstreamOnlyProducts: Set<number>;
}

/** 汇总已放行、健康且余额充足的上游可用库存 */
export async function loadHealthyUpstreamStockMapsRepo(
  db: AppDatabase,
  env: Env
): Promise<UpstreamStockMaps> {
  const rows = await db
    .select({
      productId: productUpstreamBindings.productId,
      specId: productUpstreamBindings.specId,
      fulfillmentMode: productUpstreamBindings.fulfillmentMode,
      cachedCost: productUpstreamBindings.cachedCost,
      cachedStock: productUpstreamBindings.cachedStock,
      cachedBalance: upstreamSources.cachedBalance,
      source: { id: upstreamSources.id, adapter_type: upstreamSources.adapterType },
    })
    .from(productUpstreamBindings)
    .innerJoin(upstreamSources, eq(upstreamSources.id, productUpstreamBindings.sourceId))
    .where(
      and(
        eq(productUpstreamBindings.isEnabled, 1),
        eq(productUpstreamBindings.circuitBrokenReason, ''),
        eq(upstreamSources.status, 'active')
      )
    );

  const byProductSpec = new Map<string, number>();
  const upstreamOnlyProducts = new Set<number>();
  const procurementEnabledBySource = new Map<number, boolean>();

  for (const r of rows) {
    const pid = Number(r.productId);
    // 供应商关闭新采购后，仅上游绑定仍禁止回落到本地库存。
    if (r.fulfillmentMode === 'upstream_only') upstreamOnlyProducts.add(pid);
    let procurementEnabled = procurementEnabledBySource.get(r.source.id);
    if (procurementEnabled === undefined) {
      procurementEnabled = isSupplierProcurementEnabled(env, r.source);
      procurementEnabledBySource.set(r.source.id, procurementEnabled);
    }
    if (!procurementEnabled) continue;
    const bal = r.cachedBalance !== null && r.cachedBalance !== undefined ? Number(r.cachedBalance) : null;
    const cost = Number(r.cachedCost || 0);
    if (bal !== null && cost > 0 && bal + 0.001 < cost) continue;
    const maxAffordable = bal !== null && cost > 0 ? Math.floor(bal / cost) : Number(r.cachedStock || 0);
    const avail = Math.max(0, Math.min(Number(r.cachedStock || 0), maxAffordable));
    const key = `${pid}:${r.specId}`;
    byProductSpec.set(key, Math.max(byProductSpec.get(key) ?? 0, avail));
  }

  const byProduct = new Map<number, number>();
  for (const [key, stock] of byProductSpec.entries()) {
    const pid = Number(key.split(':')[0]);
    byProduct.set(pid, (byProduct.get(pid) ?? 0) + stock);
  }

  return { byProduct, byProductSpec, upstreamOnlyProducts };
}
