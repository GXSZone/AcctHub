import { roundUpCurrency as roundUp2 } from '@shared/domain/money';
import { asc, desc, eq } from 'drizzle-orm';
import { agentTiers, products } from '../../db/schema/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';

export interface MarginLossItem {
  product_id?: number;
  product_title: string;
  spec_name: string;
  sell_price: number;
  cost_price: number;
  min_agent_price: number;
  loss_amount: number;
  min_safe_retail_price: number;
  tier_name: string;
  discount_rate: number;
}

/** 读取主站最低代理拿货折率等级（100% Drizzle ORM） */
async function getLowestAgentTier(env: Env): Promise<{ name: string; discount_rate: number } | null> {
  const rows = await createDb(env.DB)
    .select({ name: agentTiers.name, discountRate: agentTiers.discountRate })
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, 0))
    .orderBy(asc(agentTiers.discountRate), desc(agentTiers.levelRank))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { name: String(row.name), discount_rate: Number(row.discountRate) };
}

/** 校验商品售价及各规格价格在最低代理折扣下是否跌破成本价 */
export async function checkProductLossAgainstTiers(
  env: Env,
  input: { title: string; base_price: number; cost_price: number | null; specs: ProductSpec[] }
): Promise<{ lowestTier: { name: string; discount_rate: number } | null; losses: MarginLossItem[] }> {
  const lowestTier = await getLowestAgentTier(env);
  if (!lowestTier || lowestTier.discount_rate <= 0) return { lowestTier: null, losses: [] };

  const d = lowestTier.discount_rate;
  const losses: MarginLossItem[] = [];
  const baseCost = Number(input.cost_price || 0);

  if (baseCost > 0) {
    const agentFloor = Number((input.base_price * d).toFixed(2));
    if (agentFloor + 0.001 < baseCost) {
      losses.push({
        product_title: input.title,
        spec_name: '商品起步价',
        sell_price: input.base_price,
        cost_price: baseCost,
        min_agent_price: agentFloor,
        loss_amount: Number((baseCost - agentFloor).toFixed(2)),
        min_safe_retail_price: roundUp2(baseCost / d),
        tier_name: lowestTier.name,
        discount_rate: d,
      });
    }
  }

  for (let i = 0; i < input.specs.length; i++) {
    const s = input.specs[i];
    const specSell = Number(s.price || 0);
    const specCost =
      s.cost_price !== undefined && s.cost_price !== null && Number(s.cost_price) > 0
        ? Number(s.cost_price)
        : i === 0 && input.specs.length === 1
          ? baseCost
          : 0;
    if (specCost <= 0) continue;
    const agentFloor = Number((specSell * d).toFixed(2));
    if (agentFloor + 0.001 < specCost) {
      losses.push({
        product_title: input.title,
        spec_name: s.name || s.id,
        sell_price: specSell,
        cost_price: specCost,
        min_agent_price: agentFloor,
        loss_amount: Number((specCost - agentFloor).toFixed(2)),
        min_safe_retail_price: roundUp2(specCost / d),
        tier_name: lowestTier.name,
        discount_rate: d,
      });
    }
  }

  return { lowestTier, losses };
}

/** 校验调整某主站代理等级折扣后，全站在售商品是否存在倒贴亏损项 */
export async function checkTierDiscountAgainstProducts(
  env: Env,
  tierName: string,
  discountRate: number
): Promise<{ losses: MarginLossItem[]; safe_min_discount: number }> {
  const prods = await createDb(env.DB)
    .select({
      id: products.id,
      title: products.title,
      basePrice: products.basePrice,
      costPrice: products.costPrice,
      upstreamCost: products.upstreamCost,
      specsJson: products.specsJson,
    })
    .from(products)
    .where(eq(products.isActive, 1))
    .orderBy(asc(products.id));

  const losses: MarginLossItem[] = [];
  let maxCostRatio = 0;

  for (const p of prods) {
    const baseCost = Number(p.costPrice ?? p.upstreamCost ?? 0);
    const baseSell = Number(p.basePrice || 0);
    if (baseCost > 0 && baseSell > 0) {
      maxCostRatio = Math.max(maxCostRatio, baseCost / baseSell);
      const agentFloor = Number((baseSell * discountRate).toFixed(2));
      if (agentFloor + 0.001 < baseCost) {
        losses.push({
          product_id: p.id,
          product_title: p.title,
          spec_name: '起步价',
          sell_price: baseSell,
          cost_price: baseCost,
          min_agent_price: agentFloor,
          loss_amount: Number((baseCost - agentFloor).toFixed(2)),
          min_safe_retail_price: roundUp2(baseCost / discountRate),
          tier_name: tierName,
          discount_rate: discountRate,
        });
      }
    }

    const specs = safeJsonParse<ProductSpec[]>(p.specsJson || '[]', []);
    for (const s of specs) {
      const sc = Number(s.cost_price || 0);
      const sp = Number(s.price || 0);
      if (sc > 0 && sp > 0) {
        maxCostRatio = Math.max(maxCostRatio, sc / sp);
        const agentFloor = Number((sp * discountRate).toFixed(2));
        if (agentFloor + 0.001 < sc) {
          losses.push({
            product_id: p.id,
            product_title: p.title,
            spec_name: s.name || s.id,
            sell_price: sp,
            cost_price: sc,
            min_agent_price: agentFloor,
            loss_amount: Number((sc - agentFloor).toFixed(2)),
            min_safe_retail_price: roundUp2(sc / discountRate),
            tier_name: tierName,
            discount_rate: discountRate,
          });
        }
      }
    }
  }

  return {
    losses,
    safe_min_discount: maxCostRatio > 0 ? Math.min(1, roundUp2(maxCostRatio)) : 0.1,
  };
}
