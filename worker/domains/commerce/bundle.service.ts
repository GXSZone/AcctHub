import type { BundleItemRule } from '@shared/domain/commerce-modes';
import { inArray, type SQL } from 'drizzle-orm';
import { products } from '../../db/schema/index';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import type { AppDatabase } from '../../infra/db';
import {
  claimSingleCardAtomic,
  countAvailableCardsForSpec,
  incrementProductSalesCount,
  listCandidateAvailableCards,
  releaseClaimedCards,
} from '../fulfillment/fulfillment.repo';

export interface EnrichedBundleItem extends BundleItemRule {
  title: string;
  available_stock: number;
}

/** 批量解析组合套餐子商品名称与各子项可用库存，并折算出套餐整体最大可售套数 */
export async function resolveBundleStockAndTitles(
  db: AppDatabase,
  bundleItems: BundleItemRule[]
): Promise<{ maxSets: number; items: EnrichedBundleItem[] }> {
  if (bundleItems.length === 0) return { maxSets: 0, items: [] };
  const ids = Array.from(new Set(bundleItems.map((b) => b.product_id)));
  const prodRows = await db
    .select({
      id: products.id,
      title: products.title,
      ownerAgentId: products.ownerAgentId,
      isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, ids));
  const prodMap = new Map(prodRows.map((p) => [p.id, p]));

  let maxSets = Number.POSITIVE_INFINITY;
  const enriched: EnrichedBundleItem[] = [];

  for (const item of bundleItems) {
    const prod = prodMap.get(item.product_id);
    if (prod?.isActive !== 1) {
      maxSets = 0;
      enriched.push({
        ...item,
        title: item.title || prod?.title || `#${item.product_id}`,
        available_stock: 0,
      });
      continue;
    }
    const avail = await countAvailableCardsForSpec(db, item.product_id, item.spec_id, prod.ownerAgentId);
    const setsForThis = Math.floor(avail / Math.max(1, item.quantity));
    maxSets = Math.min(maxSets, setsForThis);
    enriched.push({
      ...item,
      title: item.title || prod.title,
      available_stock: avail,
    });
  }

  return {
    maxSets: Number.isFinite(maxSets) ? Math.max(0, maxSets) : 0,
    items: enriched,
  };
}

/**
 * 组合套餐原子多商品发卡引擎：
 * 按子商品清单逐一锁定每个子商品的卡密（支持循环卡密），任一子商品库存不足时自动全量回滚本次已锁定卡密，绝不出现半套交付。
 */
export async function fulfillBundleCardsAtomically(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    bundleProductId: number;
    bundleItems: BundleItemRule[];
    quantity: number;
    guard?: SQL;
    renewLease?: () => Promise<void>;
  }
): Promise<{ ok: true; deliveredLines: string[] } | { ok: false; error: string }> {
  const { orderNo, bundleProductId, bundleItems, quantity, guard, renewLease } = params;
  const ids = Array.from(new Set(bundleItems.map((b) => b.product_id)));
  const prodRows = await db
    .select({ id: products.id, title: products.title, ownerAgentId: products.ownerAgentId })
    .from(products)
    .where(inArray(products.id, ids));
  const prodMap = new Map(prodRows.map((p) => [p.id, p]));

  const claimedCardIds: number[] = [];
  const deliveredLines: string[] = [];

  const rollback = async () => {
    if (claimedCardIds.length > 0) {
      await renewLease?.();
      await releaseClaimedCards(db, claimedCardIds, orderNo, guard);
    }
  };

  for (const item of bundleItems) {
    const prod = prodMap.get(item.product_id);
    if (!prod) {
      await rollback();
      return { ok: false, error: `组合套餐内的子商品 #${item.product_id} 不存在，已自动取消扣款` };
    }
    const need = Math.max(1, item.quantity) * Math.max(1, quantity);
    const candidates = await listCandidateAvailableCards(
      db,
      item.product_id,
      item.spec_id,
      Math.max(need + 10, need * 2),
      prod.ownerAgentId
    );
    const loopCandidates: Array<{ id: number; cardContent: string }> = [];
    const itemLines: string[] = [];

    for (const card of candidates) {
      if (itemLines.length >= need) break;
      if (Number(card.isLoop || 0) === 1) {
        loopCandidates.push(card);
        continue;
      }
      const cred = await readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE);
      const claimed = await claimSingleCardAtomic(db, card.id, orderNo, guard);
      if (claimed) {
        claimedCardIds.push(card.id);
        itemLines.push(`【${item.title || prod.title}】${cred}`);
      }
    }

    if (itemLines.length < need && loopCandidates.length > 0) {
      let idx = 0;
      while (itemLines.length < need) {
        const lc = loopCandidates[idx % loopCandidates.length];
        const cred = await readStoredCredential(env, lc.cardContent, INVENTORY_CREDENTIAL_SCOPE);
        itemLines.push(`【${item.title || prod.title}】${cred}`);
        idx += 1;
      }
    }

    if (itemLines.length < need) {
      await rollback();
      return {
        ok: false,
        error: `组合套餐子商品「${item.title || prod.title}」库存不足（需 ${need} 件，实际仅剩 ${itemLines.length} 件），已自动取消扣款`,
      };
    }

    deliveredLines.push(...itemLines);
  }

  await incrementProductSalesCount(db, bundleProductId, quantity, guard);
  for (const item of bundleItems) {
    await incrementProductSalesCount(db, item.product_id, item.quantity * quantity, guard);
  }
  return { ok: true, deliveredLines };
}
