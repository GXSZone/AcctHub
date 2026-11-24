import type {
  AgentBatchPricingInput,
  AgentProductOverrideInput,
  AgentSinglePricingInput,
} from '@shared/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { findProductById } from '../payment/payment.repo';
import {
  listActiveProductsRepo,
  loadAgentCustomPrices,
  loadAgentProductOverrides,
} from '../storefront/storefront.repo';
import type { ActiveAgentContext } from './agent.guard';
import {
  deleteAgentProductPriceRepo,
  resetAgentProductContentOverrideRepo,
  upsertAgentProductOverrideRepo,
  upsertAgentProductPriceRepo,
} from './agent.repo';

/** 查询分站全部在售商品的拿货价、定制卖价、预估利润与覆写状态 */
export async function getAgentPricingMatrix(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const agentId = ctx.agent.id;
  const markupPercent = Number(ctx.agent.markup_percent ?? 12);
  const discountRate = ctx.tier?.discount_rate ?? 0.9;

  const [productsRaw, customRows, overrideRows] = await Promise.all([
    listActiveProductsRepo(db),
    loadAgentCustomPrices(db, agentId),
    loadAgentProductOverrides(db, agentId),
  ]);

  const customMap = new Map<string, number>();
  for (const r of customRows) customMap.set(`${r.productId}:${r.specId}`, Number(r.customPrice));

  const overrideMap = new Map<number, (typeof overrideRows)[number]>();
  for (const ov of overrideRows) overrideMap.set(Number(ov.product_id), ov);

  const items = productsRaw.map((p) => {
    const specs = safeJsonParse<ProductSpec[]>(p.specsJson || '[]', []);
    const specList =
      specs.length > 0 ? specs : [{ id: 'default', name: '标准版', price: Number(p.basePrice) }];
    const ov = overrideMap.get(p.id);
    const hasContentOverride = Boolean(
      ov &&
        ((ov.custom_title || '').trim() ||
          (ov.custom_subtitle || '').trim() ||
          (ov.custom_detail_markdown || '').trim() ||
          (ov.custom_risk_notice || '').trim())
    );

    return {
      product_id: p.id,
      title: (ov?.custom_title || '').trim() || p.title,
      original_title: p.title,
      subtitle: (ov?.custom_subtitle || '').trim() || p.subtitle,
      original_subtitle: p.subtitle,
      is_listed: ov ? ov.is_listed !== 0 : true,
      has_content_override: hasContentOverride,
      override: ov
        ? {
            custom_title: ov.custom_title || '',
            custom_subtitle: ov.custom_subtitle || '',
            custom_detail_markdown: ov.custom_detail_markdown || '',
            custom_risk_notice: ov.custom_risk_notice || '',
          }
        : null,
      original_detail_markdown: p.detailMarkdown,
      original_risk_notice: p.riskNotice,
      specs: specList.map((s) => {
        const refPrice = Number(s.price);
        const costPrice = Number((refPrice * discountRate).toFixed(2));
        const defaultSell = Number((refPrice * (1 + markupPercent / 100)).toFixed(2));
        const customPrice = customMap.get(`${p.id}:${s.id}`) ?? null;
        const effectiveSell = customPrice ?? defaultSell;
        return {
          spec_id: s.id,
          spec_name: s.name,
          main_price: refPrice,
          cost_price: costPrice,
          default_sell_price: defaultSell,
          custom_price: customPrice,
          effective_sell_price: effectiveSell,
          estimated_profit: Number((effectiveSell - costPrice).toFixed(2)),
        };
      }),
    };
  });

  return {
    tier_name: ctx.tier?.name || '认证代理',
    discount_rate: discountRate,
    default_markup_percent: markupPercent,
    items,
  };
}

/** 更新单个商品规格的自定义售价（多规格禁写 default，且严禁低于代理自身拿货底价） */
export async function setAgentSinglePrice(env: Env, ctx: ActiveAgentContext, body: AgentSinglePricingInput) {
  const db = createDb(env.DB);
  const agentId = ctx.agent.id;
  const discountRate = ctx.tier?.discount_rate ?? 0.9;

  if (body.custom_price === null || body.custom_price === undefined || body.custom_price === '') {
    await deleteAgentProductPriceRepo(db, agentId, body.product_id, body.spec_id);
    return { ok: true, cleared: true };
  }

  const rawCustomPrice = Number(body.custom_price);
  if (!Number.isFinite(rawCustomPrice) || rawCustomPrice <= 0) {
    throw Errors.validation('自定义售价必须为大于 0 的有效数字');
  }

  const prod = await findProductById(db, body.product_id);
  if (!prod) throw Errors.notFound('商品不存在');

  const specs = safeJsonParse<ProductSpec[]>(prod.specsJson || '[]', []);
  const spec = specs.find((s) => s.id === body.spec_id);
  if (specs.length > 1 && !spec) {
    throw Errors.validation('多规格商品必须指定具体的有效规格 ID，不支持通用 default 定价');
  }
  if (specs.length === 1 && !spec && body.spec_id !== 'default') {
    throw Errors.validation('无效的商品规格 ID');
  }

  const refPrice = spec ? Number(spec.price) : Number(specs[0]?.price ?? prod.basePrice);
  const minCost = Number((refPrice * discountRate).toFixed(2));
  const targetPrice = Number(rawCustomPrice.toFixed(2));

  if (targetPrice < minCost) {
    throw Errors.validation(`自定义卖价（¥${targetPrice}）不可低于您当前等级的拿货底价（¥${minCost}）`);
  }

  await upsertAgentProductPriceRepo(db, agentId, body.product_id, body.spec_id, targetPrice);
  return { ok: true, custom_price: targetPrice, min_cost: minCost };
}

/** 批量改价或重置全部自定义定价（始终不低于拿货底价） */
export async function batchUpdateAgentPricing(
  env: Env,
  ctx: ActiveAgentContext,
  body: AgentBatchPricingInput
) {
  const db = createDb(env.DB);
  const agentId = ctx.agent.id;
  const discountRate = ctx.tier?.discount_rate ?? 0.9;
  const mode = body.mode;
  if (body.targets?.length === 0) {
    return { ok: true, updated_count: 0, ...(mode === 'reset_all' ? { cleared: true } : {}) };
  }
  if (body.scope !== 'all' && !body.targets) throw Errors.validation('缺少批量操作目标');
  const targetSet = body.targets ? new Set(body.targets.map((t) => `${t.product_id}:${t.spec_id}`)) : null;

  if (mode === 'reset_all') {
    if (!targetSet) {
      await deleteAgentProductPriceRepo(db, agentId);
      return { ok: true, updated_count: -1, cleared: true };
    }
    let clearedCount = 0;
    for (const t of body.targets || []) {
      await deleteAgentProductPriceRepo(db, agentId, t.product_id, t.spec_id);
      clearedCount++;
    }
    return { ok: true, updated_count: clearedCount, cleared: true };
  }

  const val = Number(body.value ?? 0);
  if (!Number.isFinite(val) || val < -50 || val > 5000) {
    throw Errors.validation('批量加价数值超出合理范围');
  }
  const rounding = body.rounding || 'none';
  const productsRaw = await listActiveProductsRepo(db);

  let updatedCount = 0;
  for (const p of productsRaw) {
    const specs = safeJsonParse<ProductSpec[]>(p.specsJson || '[]', []);
    const specList =
      specs.length > 0 ? specs : [{ id: 'default', name: '标准版', price: Number(p.basePrice) }];

    for (const s of specList) {
      if (targetSet && !targetSet.has(`${p.id}:${s.id}`)) continue;
      const refPrice = Number(s.price);
      const costPrice = Number((refPrice * discountRate).toFixed(2));
      let rawSell = costPrice;

      if (mode === 'markup_cost_pct') rawSell = costPrice * (1 + val / 100);
      else if (mode === 'markup_main_pct') rawSell = refPrice * (1 + val / 100);
      else if (mode === 'markup_cost_fixed') rawSell = costPrice + val;

      if (rounding === 'integer') rawSell = Math.ceil(rawSell);
      else if (rounding === 'point9') {
        rawSell = Math.floor(rawSell) + 0.9;
        if (rawSell < costPrice) rawSell = Math.ceil(costPrice) + 0.9;
      }

      const finalPrice = Number(Math.max(costPrice, rawSell).toFixed(2));
      await upsertAgentProductPriceRepo(db, agentId, p.id, s.id, finalPrice);
      updatedCount++;
    }
  }

  return { ok: true, updated_count: updatedCount };
}

/** 更新单商品在当前分站的上下架状态与独立文案覆写 */
export async function upsertAgentProductOverride(
  env: Env,
  ctx: ActiveAgentContext,
  productId: number,
  body: AgentProductOverrideInput
) {
  const db = createDb(env.DB);
  const prod = await findProductById(db, productId);
  if (!prod) throw Errors.notFound('商品不存在');

  const existingList = await loadAgentProductOverrides(db, ctx.agent.id, productId);
  const existing = existingList[0];
  const nextListed = body.is_listed !== undefined ? (body.is_listed ? 1 : 0) : (existing?.is_listed ?? 1);
  const norm = (val: string | null | undefined, prev: string | null | undefined) => {
    if (val === undefined) return prev ?? null;
    const trimmed = (val || '').trim();
    return trimmed ? trimmed : null;
  };

  await upsertAgentProductOverrideRepo(db, {
    agentId: ctx.agent.id,
    productId,
    isListed: nextListed,
    customTitle: norm(body.custom_title, existing?.custom_title),
    customSubtitle: norm(body.custom_subtitle, existing?.custom_subtitle),
    customDetailMarkdown: norm(body.custom_detail_markdown, existing?.custom_detail_markdown),
    customRiskNotice: norm(body.custom_risk_notice, existing?.custom_risk_notice),
  });

  return { ok: true, is_listed: nextListed === 1 };
}

/** 重置单商品文案覆写（保留当前上下架状态） */
export async function resetAgentProductOverride(env: Env, ctx: ActiveAgentContext, productId: number) {
  const db = createDb(env.DB);
  await resetAgentProductContentOverrideRepo(db, ctx.agent.id, productId);
  return { ok: true };
}
