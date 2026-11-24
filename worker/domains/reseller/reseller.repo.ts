import { and, asc, eq, sql } from 'drizzle-orm';
import { agents, agentTiers, orders, productCards, products, users } from '../../db/schema/index';
import { sha256Hex } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';

export interface ActiveResellerAgent {
  id: number;
  userId: number;
  slug: string;
  brandName: string;
  apiIpWhitelist: string;
  totalCommission: number;
  balance: number;
  totalRecharged: number;
  ownerEmail: string;
  tierName: string;
  tierCode: string;
  levelRank: number;
  tierDiscountRate: number;
}

/** 按 API Key 的 SHA-256 哈希查询活跃 B2B 代理，并应用上级拿货折扣底线 */
export async function findActiveResellerByApiKey(
  db: AppDatabase,
  apiKey: string
): Promise<ActiveResellerAgent | null> {
  const keyHash = await sha256Hex(apiKey);
  const rows = await db
    .select({
      id: agents.id,
      userId: agents.userId,
      parentAgentId: agents.parentAgentId,
      slug: agents.slug,
      brandName: agents.brandName,
      apiIpWhitelist: agents.apiIpWhitelist,
      totalCommission: agents.totalCommission,
      balance: users.balance,
      totalRecharged: users.totalRecharged,
      ownerEmail: users.email,
      tierName: agentTiers.name,
      tierCode: agentTiers.code,
      levelRank: agentTiers.levelRank,
      rawDiscountRate: agentTiers.discountRate,
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
    .where(and(eq(agents.apiKeyHash, keyHash), eq(agents.status, 'active'), eq(users.status, 'active')))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let parentRate = 0;
  if (row.parentAgentId) {
    const parentRows = await db
      .select({ discountRate: agentTiers.discountRate })
      .from(agents)
      .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
      .where(eq(agents.id, row.parentAgentId))
      .limit(1);
    parentRate = Number(parentRows[0]?.discountRate ?? 0);
  }

  const selfRate = Number(row.rawDiscountRate ?? 0.9);
  const tierDiscountRate = parentRate > 0 ? Math.max(selfRate, parentRate) : selfRate;

  return {
    id: row.id,
    userId: row.userId,
    slug: row.slug,
    brandName: row.brandName,
    apiIpWhitelist: row.apiIpWhitelist || '',
    totalCommission: Number(row.totalCommission || 0),
    balance: Number(row.balance || 0),
    totalRecharged: Number(row.totalRecharged || 0),
    ownerEmail: row.ownerEmail,
    tierName: row.tierName || '认证代理',
    tierCode: row.tierCode || 'standard',
    levelRank: Number(row.levelRank ?? 1),
    tierDiscountRate,
  };
}

/** 批量加载在售商品及本地可用卡密按 (product_id, spec_id) 分组库存 */
export async function loadResellerCatalogRaw(db: AppDatabase) {
  const [productRows, cardAggRows] = await Promise.all([
    db
      .select({
        id: products.id,
        slug: products.slug,
        title: products.title,
        deliveryType: products.deliveryType,
        basePrice: products.basePrice,
        stockMode: products.stockMode,
        manualStock: products.manualStock,
        seatTotal: products.seatTotal,
        seatUsed: products.seatUsed,
        specsJson: products.specsJson,
      })
      .from(products)
      .where(eq(products.isActive, 1))
      .orderBy(asc(products.id)),
    db
      .select({
        productId: productCards.productId,
        specId: productCards.specId,
        c: sql<number>`count(*)`,
      })
      .from(productCards)
      .where(eq(productCards.status, 'available'))
      .groupBy(productCards.productId, productCards.specId),
  ]);

  return { productRows, cardAggRows };
}

/** 按代理与作用域幂等键查找历史 B2B 批采订单 */
export async function findResellerIdempotentOrder(db: AppDatabase, agentId: number, scopedIdemKey: string) {
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.agentId, agentId),
        eq(orders.idempotencyKey, scopedIdemKey),
        eq(orders.channel, 'reseller_api')
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findResellerOrderByNo(db: AppDatabase, agentId: number, orderNo: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.agentId, agentId), eq(orders.orderNo, orderNo), eq(orders.channel, 'reseller_api')))
    .limit(1);
  return order ?? null;
}
