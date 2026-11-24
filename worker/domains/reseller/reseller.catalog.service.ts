import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { loadHealthyUpstreamStockMapsRepo } from '../storefront/storefront.repo';
import { type ActiveResellerAgent, loadResellerCatalogRaw } from './reseller.repo';

/** 查询 B2B 批采商品目录及各规格实时可用库存（含健康上游直供库存） */
export async function listResellerProducts(env: Env, agent: ActiveResellerAgent) {
  const db = createDb(env.DB);
  const tierDiscount = agent.tierDiscountRate;
  const [{ productRows, cardAggRows }, upStockMaps] = await Promise.all([
    loadResellerCatalogRaw(db),
    loadHealthyUpstreamStockMapsRepo(db, env),
  ]);

  const specStockByProduct = new Map<number, Map<string, number>>();
  const totalCardByProduct = new Map<number, number>();
  for (const r of cardAggRows) {
    const pid = Number(r.productId);
    const cnt = Number(r.c);
    totalCardByProduct.set(pid, (totalCardByProduct.get(pid) ?? 0) + cnt);
    let specMap = specStockByProduct.get(pid);
    if (!specMap) {
      specMap = new Map<string, number>();
      specStockByProduct.set(pid, specMap);
    }
    specMap.set(r.specId, cnt);
  }

  const items = productRows
    .filter((p) => p.deliveryType !== 'api_key')
    .map((p) => {
      const pid = p.id;
      const upProdStock = upStockMaps.byProduct.get(pid) ?? 0;
      const isUpOnly = upStockMaps.upstreamOnlyProducts.has(pid);
      let stock = Number(p.manualStock || 0);
      const specStockMap = specStockByProduct.get(pid) ?? new Map<string, number>();

      if (p.stockMode === 'cards') {
        const localTot = totalCardByProduct.get(pid) ?? 0;
        stock = isUpOnly ? upProdStock : localTot + upProdStock;
      } else if (p.stockMode === 'seats') {
        stock = Math.max(0, Number(p.seatTotal || 5) - Number(p.seatUsed || 0));
      } else if (upProdStock > 0) {
        stock = Math.max(stock, upProdStock);
      }

      const specs = safeJsonParse<ProductSpec[]>(p.specsJson || '[]', []);
      return {
        id: pid,
        slug: p.slug,
        title: p.title,
        delivery_type: p.deliveryType,
        retail_price: Number(p.basePrice),
        wholesale_price: Number((Number(p.basePrice) * tierDiscount).toFixed(2)),
        available_stock: stock,
        specs: specs.map((s) => {
          const localSpecStock =
            p.stockMode === 'cards'
              ? (specStockMap.get(s.id) ?? (specs.length <= 1 ? (specStockMap.get('default') ?? 0) : 0))
              : stock;
          const upSpecStock =
            upStockMaps.byProductSpec.get(`${pid}:${s.id}`) ??
            upStockMaps.byProductSpec.get(`${pid}:default`) ??
            upStockMaps.byProductSpec.get(`${pid}:upstream_std`) ??
            0;
          return {
            id: s.id,
            name: s.name,
            retail_price: s.price,
            wholesale_price: Number((s.price * tierDiscount).toFixed(2)),
            available_stock:
              p.stockMode === 'cards'
                ? isUpOnly
                  ? upSpecStock
                  : localSpecStock + upSpecStock
                : Math.max(localSpecStock, upSpecStock),
          };
        }),
      };
    });

  return {
    agent: agent.slug,
    tier_name: agent.tierName,
    discount_rate: tierDiscount,
    count: items.length,
    products: items,
  };
}

/** 异次元（AcgFaka）/ 独角数卡（Dujiaoka）扁平目录兼容接口 */
export async function getResellerCompatCatalog(env: Env, agent: ActiveResellerAgent) {
  const db = createDb(env.DB);
  const tierDiscount = agent.tierDiscountRate;
  const [{ productRows, cardAggRows }, upStockMaps] = await Promise.all([
    loadResellerCatalogRaw(db),
    loadHealthyUpstreamStockMapsRepo(db, env),
  ]);

  const cardBySpec = new Map<string, number>();
  for (const r of cardAggRows) cardBySpec.set(`${r.productId}:${r.specId}`, Number(r.c));

  const flatGoods: Array<{
    goods_id: string;
    product_id: number;
    spec_id: string;
    name: string;
    price: number;
    stock: number;
    delivery: string;
  }> = [];

  for (const p of productRows) {
    if (p.deliveryType === 'api_key') continue;
    const pid = p.id;
    const isUpOnly = upStockMaps.upstreamOnlyProducts.has(pid);
    const specs = safeJsonParse<ProductSpec[]>(p.specsJson || '[]', []);
    const list = specs.length > 0 ? specs : [{ id: 'default', name: '标准版', price: Number(p.basePrice) }];
    for (const s of list) {
      let stock = Number(p.manualStock || 0);
      const upSpecStock =
        upStockMaps.byProductSpec.get(`${pid}:${s.id}`) ??
        upStockMaps.byProductSpec.get(`${pid}:default`) ??
        upStockMaps.byProductSpec.get(`${pid}:upstream_std`) ??
        0;
      if (p.stockMode === 'cards' && p.deliveryType !== 'api_key') {
        const localCnt =
          cardBySpec.get(`${pid}:${s.id}`) ??
          (list.length <= 1 ? (cardBySpec.get(`${pid}:default`) ?? 0) : 0);
        stock = isUpOnly ? upSpecStock : localCnt + upSpecStock;
      } else if (p.stockMode === 'seats') {
        stock = Math.max(0, Number(p.seatTotal || 5) - Number(p.seatUsed || 0));
      } else if (upSpecStock > 0) {
        stock = Math.max(stock, upSpecStock);
      }
      flatGoods.push({
        goods_id: `${pid}:${s.id}`,
        product_id: pid,
        spec_id: s.id,
        name: list.length > 1 ? `${p.title} - ${s.name}` : p.title,
        price: Number((Number(s.price) * tierDiscount).toFixed(2)),
        stock,
        delivery: p.deliveryType || 'auto',
      });
    }
  }

  return {
    code: 200,
    msg: 'ok',
    data: {
      balance: agent.balance,
      discount_rate: tierDiscount,
      goods: flatGoods,
    },
  };
}
