import type { agentPrivateProductInputSchema } from '@shared/contracts/tenant.contract';
import { normalizeBundleItems } from '@shared/domain/commerce-modes';
import {
  buildWarrantySummaryTemplate,
  normalizeTierPricingRules,
  normalizeWarrantyType,
} from '@shared/index';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { categories, productCards, products } from '../../db/schema/index';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { encryptSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { listEnabledTenantPaymentMethods } from '../payment/tenant-payment.service';
import type { ActiveAgentContext } from './agent.guard';

type AgentPrivateProductInput = z.infer<typeof agentPrivateProductInputSchema>;

function toFlag(v: boolean | number | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  return v ? 1 : 0;
}

function assertPrivateProductsAllowed(ctx: ActiveAgentContext): void {
  if (!ctx.tenant.capabilities?.allow_own_payment || !ctx.tenant.capabilities?.allow_private_products) {
    throw Errors.forbidden(
      '当前分站尚未获平台同时授权「自有收款渠道」与「私有商品」功能（为防范资金风险，私有商品仅支持分站自有收款直收）'
    );
  }
}

async function assertTenantOwnPaymentConfigured(
  db: ReturnType<typeof createDb>,
  agentId: number
): Promise<void> {
  const enabledOwn = await listEnabledTenantPaymentMethods(db, agentId);
  if (enabledOwn.length === 0) {
    throw Errors.forbidden(
      '上架分站私有商品前，请先在「自有收款渠道」配置并启用至少一个您自己的收款账户（严禁私有商品经主站资金流水收款）'
    );
  }
}

/** 列出当前分站自建的全部私有商品、可用自有卡密库存及可选商品分类 */
export async function listAgentPrivateProducts(env: Env, ctx: ActiveAgentContext) {
  assertPrivateProductsAllowed(ctx);
  const db = createDb(env.DB);
  const [rows, cardCounts, categoryRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(and(eq(products.ownerAgentId, ctx.agent.id), eq(products.productSource, 'tenant_private')))
      .orderBy(desc(products.id)),
    db
      .select({
        productId: productCards.productId,
        available: sql<number>`count(*)`,
      })
      .from(productCards)
      .where(and(eq(productCards.ownerAgentId, ctx.agent.id), eq(productCards.status, 'available')))
      .groupBy(productCards.productId),
    db
      .select({ id: categories.id, name: categories.name, ownerAgentId: categories.ownerAgentId })
      .from(categories)
      .where(and(eq(categories.isActive, 1), inArray(categories.ownerAgentId, [ctx.agent.id, 0])))
      .orderBy(desc(categories.ownerAgentId), asc(categories.sortOrder), asc(categories.id)),
  ]);

  const countMap = new Map(cardCounts.map((r) => [Number(r.productId), Number(r.available || 0)]));
  return {
    categories: categoryRows.map((c) => ({ id: c.id, name: c.name })),
    items: rows.map((p) => ({
      id: p.id,
      owner_agent_id: p.ownerAgentId,
      product_source: p.productSource,
      category_id: p.categoryId,
      slug: p.slug,
      title: p.title,
      title_en: p.titleEn,
      subtitle: p.subtitle,
      subtitle_en: p.subtitleEn,
      icon_key: p.iconKey,
      accent_color: p.accentColor,
      delivery_type: p.deliveryType,
      tags: safeJsonParse(p.tagsJson || '[]', []),
      base_price: p.basePrice,
      original_price: p.originalPrice,
      cost_price: p.costPrice,
      stock_mode: p.stockMode,
      manual_stock: p.manualStock,
      seat_total: p.seatTotal,
      seat_used: p.seatUsed,
      summary_markdown: p.summaryMarkdown,
      detail_markdown: p.detailMarkdown,
      risk_notice: p.riskNotice,
      warranty_type: p.warrantyType,
      warranty_days: p.warrantyDays,
      warranty_summary: p.warrantySummary,
      specs: safeJsonParse(p.specsJson || '[]', []),
      tier_pricing: normalizeTierPricingRules(p.tierPricingJson),
      faq: safeJsonParse(p.faqJson || '[]', []),
      custom_fields: safeJsonParse(p.customFieldsJson || '[]', []),
      is_featured: p.isFeatured,
      is_active: p.isActive,
      sort_order: p.sortOrder,
      sales_count: p.salesCount,
      min_quantity: Math.max(1, Number(p.minQuantity || 1)),
      max_quantity: Math.max(0, Number(p.maxQuantity || 0)),
      require_login: Boolean(p.requireLogin),
      is_hidden: Boolean(p.isHidden),
      access_password: p.accessPassword || '',
      flash_sale_price: p.flashSalePrice,
      flash_sale_start_at: p.flashSaleStartAt || '',
      flash_sale_end_at: p.flashSaleEndAt || '',
      flash_sale_limit: p.flashSaleLimit ?? 0,
      bundle_items: safeJsonParse(p.bundleItemsJson || '[]', []),
      group_buy_enabled: Boolean(p.groupBuyEnabled),
      group_buy_size: p.groupBuySize ?? 2,
      group_buy_price: p.groupBuyPrice,
      group_buy_hours: p.groupBuyHours ?? 24,
      allow_card_selection: Boolean(p.allowCardSelection),
      card_select_fee: p.cardSelectFee ?? 0,
      member_price: p.memberPrice,
      available_cards: countMap.get(p.id) ?? 0,
      created_at: p.createdAt,
    })),
  };
}

/** 分站新建自有私有商品（严格打上 owner_agent_id 与 tenant_private 标记） */
export async function createAgentPrivateProduct(
  env: Env,
  ctx: ActiveAgentContext,
  body: AgentPrivateProductInput
) {
  assertPrivateProductsAllowed(ctx);
  if (body.delivery_type === 'api_key') {
    throw Errors.validation('API Key 商品暂不支持开通，请选择可实际交付的商品类型');
  }
  const db = createDb(env.DB);
  const activeFlag = toFlag(body.is_active, 1);
  if (activeFlag === 1) {
    await assertTenantOwnPaymentConfigured(db, ctx.agent.id);
  }

  let categoryId = body.category_id;
  if (!categoryId) {
    const firstCat = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.isActive, 1), inArray(categories.ownerAgentId, [ctx.agent.id, 0])))
      .orderBy(desc(categories.ownerAgentId), asc(categories.sortOrder), asc(categories.id))
      .limit(1);
    categoryId = firstCat[0]?.id ?? 1;
  }

  const rawSlug = (body.slug?.trim() || `p-${ctx.agent.id}-${Date.now().toString(36)}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  const price = Number(body.base_price.toFixed(2));
  const specs =
    body.specs && body.specs.length > 0
      ? body.specs
      : [{ id: 'default', name: '标准版', price, original_price: body.original_price ?? undefined }];
  const warrantyType = normalizeWarrantyType(body.warranty_type);
  const warrantyDays = Math.max(
    0,
    Math.floor(
      Number(body.warranty_days ?? (warrantyType === 'none' ? 0 : warrantyType === 'first_login' ? 24 : 30))
    )
  );
  const warrantySummary =
    String(body.warranty_summary || '').trim() || buildWarrantySummaryTemplate(warrantyType, warrantyDays);

  try {
    const [inserted] = await db
      .insert(products)
      .values({
        ownerAgentId: ctx.agent.id,
        productSource: 'tenant_private',
        categoryId,
        slug: rawSlug,
        title: body.title.trim(),
        titleEn: (body.title_en || body.title).trim(),
        subtitle: (body.subtitle || '').trim(),
        subtitleEn: (body.subtitle_en || body.subtitle || '').trim(),
        iconKey: body.icon_key || 'sparkles',
        accentColor: body.accent_color || '#D97757',
        deliveryType: body.delivery_type || 'auto',
        tagsJson: JSON.stringify(body.tags && body.tags.length > 0 ? body.tags : ['店内自营', '自动发货']),
        basePrice: price,
        originalPrice: body.original_price ?? null,
        costPrice: body.cost_price ?? null,
        stockMode: body.stock_mode || 'cards',
        manualStock: Math.max(0, Number(body.manual_stock ?? 0)),
        seatTotal: Math.max(0, Number(body.seat_total ?? 0)),
        seatUsed: Math.max(0, Number(body.seat_used ?? 0)),
        summaryMarkdown: (body.summary_markdown || '').trim(),
        detailMarkdown: (body.detail_markdown || '').trim(),
        riskNotice: (body.risk_notice || '').trim(),
        warrantyType,
        warrantyDays,
        warrantySummary,
        specsJson: JSON.stringify(specs),
        tierPricingJson: JSON.stringify(normalizeTierPricingRules(body.tier_pricing)),
        faqJson: JSON.stringify(body.faq ?? []),
        customFieldsJson: JSON.stringify(body.custom_fields ?? []),
        isFeatured: toFlag(body.is_featured, 1),
        isActive: activeFlag,
        sortOrder: Number(body.sort_order ?? 5),
        minQuantity: Math.max(1, Math.min(999, Math.floor(Number(body.min_quantity || 1)))),
        maxQuantity: Math.max(0, Math.min(999, Math.floor(Number(body.max_quantity || 0)))),
        requireLogin: toFlag(body.require_login, 0),
        isHidden: toFlag(body.is_hidden, 0),
        accessPassword: String(body.access_password || '')
          .trim()
          .slice(0, 64),
        flashSalePrice: body.flash_sale_price ?? null,
        flashSaleStartAt: String(body.flash_sale_start_at || '').trim(),
        flashSaleEndAt: String(body.flash_sale_end_at || '').trim(),
        flashSaleLimit: Math.max(0, Math.floor(Number(body.flash_sale_limit || 0))),
        bundleItemsJson: JSON.stringify(normalizeBundleItems(body.bundle_items)),
        groupBuyEnabled: toFlag(body.group_buy_enabled, 0),
        groupBuySize: Math.max(2, Math.min(20, Math.floor(Number(body.group_buy_size || 2)))),
        groupBuyPrice: body.group_buy_price ?? null,
        groupBuyHours: Math.max(1, Math.min(168, Math.floor(Number(body.group_buy_hours || 24)))),
        allowCardSelection: toFlag(body.allow_card_selection, 0),
        cardSelectFee: Math.max(0, Number(body.card_select_fee || 0)),
        memberPrice: body.member_price ?? null,
      })
      .returning({ id: products.id, slug: products.slug });
    return { ok: true, id: inserted.id, slug: inserted.slug };
  } catch (err) {
    if (/unique/i.test(err instanceof Error ? err.message : '')) {
      throw Errors.conflict(`本店已存在标识为「${rawSlug}」的商品`);
    }
    throw err;
  }
}

export async function updateAgentPrivateProduct(
  env: Env,
  ctx: ActiveAgentContext,
  productId: number,
  body: Partial<AgentPrivateProductInput>
) {
  assertPrivateProductsAllowed(ctx);
  if (body.delivery_type === 'api_key') {
    throw Errors.validation('API Key 商品暂不支持开通，请选择可实际交付的商品类型');
  }
  const db = createDb(env.DB);
  if (body.is_active !== false && body.is_active !== 0) {
    await assertTenantOwnPaymentConfigured(db, ctx.agent.id);
  }
  const patch: Partial<typeof products.$inferInsert> = {
    updatedAt: sql`datetime('now')` as unknown as string,
  };
  if (body.category_id !== undefined) patch.categoryId = Number(body.category_id);
  if (body.title !== undefined) {
    patch.title = body.title.trim();
    patch.titleEn = (body.title_en ?? body.title).trim();
  } else if (body.title_en !== undefined) {
    patch.titleEn = body.title_en.trim();
  }
  if (body.subtitle !== undefined) {
    patch.subtitle = body.subtitle.trim();
    patch.subtitleEn = (body.subtitle_en ?? body.subtitle).trim();
  } else if (body.subtitle_en !== undefined) {
    patch.subtitleEn = body.subtitle_en.trim();
  }
  if (body.icon_key !== undefined) patch.iconKey = body.icon_key;
  if (body.accent_color !== undefined) patch.accentColor = body.accent_color;
  if (body.delivery_type !== undefined) patch.deliveryType = body.delivery_type;
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(body.tags);
  if (body.base_price !== undefined) patch.basePrice = Number(body.base_price.toFixed(2));
  if (body.original_price !== undefined) patch.originalPrice = body.original_price;
  if (body.cost_price !== undefined) patch.costPrice = body.cost_price;
  if (body.stock_mode !== undefined) patch.stockMode = body.stock_mode;
  if (body.manual_stock !== undefined) patch.manualStock = Math.max(0, Number(body.manual_stock));
  if (body.seat_total !== undefined) patch.seatTotal = Math.max(0, Number(body.seat_total));
  if (body.seat_used !== undefined) patch.seatUsed = Math.max(0, Number(body.seat_used));
  if (body.summary_markdown !== undefined) patch.summaryMarkdown = body.summary_markdown.trim();
  if (body.detail_markdown !== undefined) patch.detailMarkdown = body.detail_markdown.trim();
  if (body.risk_notice !== undefined) patch.riskNotice = body.risk_notice.trim();
  if (body.warranty_type !== undefined) patch.warrantyType = normalizeWarrantyType(body.warranty_type);
  if (body.warranty_days !== undefined)
    patch.warrantyDays = Math.max(0, Math.floor(Number(body.warranty_days) || 0));
  if (body.warranty_summary !== undefined) patch.warrantySummary = body.warranty_summary.trim();
  if (body.is_featured !== undefined) patch.isFeatured = toFlag(body.is_featured, 0);
  if (body.is_active !== undefined) patch.isActive = toFlag(body.is_active, 1);
  if (body.sort_order !== undefined) patch.sortOrder = Number(body.sort_order);
  if (body.min_quantity !== undefined) {
    patch.minQuantity = Math.max(1, Math.min(999, Math.floor(Number(body.min_quantity) || 1)));
  }
  if (body.max_quantity !== undefined) {
    patch.maxQuantity = Math.max(0, Math.min(999, Math.floor(Number(body.max_quantity) || 0)));
  }
  if (body.require_login !== undefined) patch.requireLogin = toFlag(body.require_login, 0);
  if (body.is_hidden !== undefined) patch.isHidden = toFlag(body.is_hidden, 0);
  if (body.access_password !== undefined) {
    patch.accessPassword = body.access_password.trim().slice(0, 64);
  }
  if (body.flash_sale_price !== undefined) patch.flashSalePrice = body.flash_sale_price;
  if (body.flash_sale_start_at !== undefined) patch.flashSaleStartAt = body.flash_sale_start_at.trim();
  if (body.flash_sale_end_at !== undefined) patch.flashSaleEndAt = body.flash_sale_end_at.trim();
  if (body.flash_sale_limit !== undefined) {
    patch.flashSaleLimit = Math.max(0, Math.floor(Number(body.flash_sale_limit || 0)));
  }
  if (body.bundle_items !== undefined) {
    patch.bundleItemsJson = JSON.stringify(normalizeBundleItems(body.bundle_items));
  }
  if (body.group_buy_enabled !== undefined) patch.groupBuyEnabled = toFlag(body.group_buy_enabled, 0);
  if (body.group_buy_size !== undefined) {
    patch.groupBuySize = Math.max(2, Math.min(20, Math.floor(Number(body.group_buy_size || 2))));
  }
  if (body.group_buy_price !== undefined) patch.groupBuyPrice = body.group_buy_price;
  if (body.group_buy_hours !== undefined) {
    patch.groupBuyHours = Math.max(1, Math.min(168, Math.floor(Number(body.group_buy_hours || 24))));
  }
  if (body.allow_card_selection !== undefined) {
    patch.allowCardSelection = toFlag(body.allow_card_selection, 0);
  }
  if (body.card_select_fee !== undefined) {
    patch.cardSelectFee = Math.max(0, Number(body.card_select_fee || 0));
  }
  if (body.member_price !== undefined) patch.memberPrice = body.member_price;
  if (body.tier_pricing !== undefined) {
    patch.tierPricingJson = JSON.stringify(normalizeTierPricingRules(body.tier_pricing));
  }
  if (body.faq !== undefined) patch.faqJson = JSON.stringify(body.faq);
  if (body.custom_fields !== undefined) patch.customFieldsJson = JSON.stringify(body.custom_fields);
  if (body.specs !== undefined && body.specs.length > 0) {
    patch.specsJson = JSON.stringify(body.specs);
  }

  const updated = await db
    .update(products)
    .set(patch)
    .where(
      and(
        eq(products.id, productId),
        eq(products.ownerAgentId, ctx.agent.id),
        eq(products.productSource, 'tenant_private')
      )
    )
    .returning({ id: products.id });
  if (updated.length === 0) throw Errors.notFound('未找到该分站私有商品');
  return { ok: true };
}

export async function deleteAgentPrivateProduct(env: Env, ctx: ActiveAgentContext, productId: number) {
  assertPrivateProductsAllowed(ctx);
  const db = createDb(env.DB);
  const deleted = await db
    .delete(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.ownerAgentId, ctx.agent.id),
        eq(products.productSource, 'tenant_private')
      )
    )
    .returning({ id: products.id });
  if (deleted.length === 0) throw Errors.notFound('未找到该分站私有商品');
  await db
    .delete(productCards)
    .where(
      and(
        eq(productCards.productId, productId),
        eq(productCards.ownerAgentId, ctx.agent.id),
        eq(productCards.status, 'available')
      )
    );
  return { ok: true };
}

async function assertOwnedPrivateProduct(
  db: ReturnType<typeof createDb>,
  agentId: number,
  productId: number
) {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.id, productId),
        eq(products.ownerAgentId, agentId),
        eq(products.productSource, 'tenant_private')
      )
    )
    .limit(1);
  if (!rows[0]) throw Errors.notFound('未找到该分站私有商品');
}

export async function listAgentPrivateCards(env: Env, ctx: ActiveAgentContext, productId: number) {
  assertPrivateProductsAllowed(ctx);
  const db = createDb(env.DB);
  await assertOwnedPrivateProduct(db, ctx.agent.id, productId);
  const rows = await db
    .select()
    .from(productCards)
    .where(and(eq(productCards.productId, productId), eq(productCards.ownerAgentId, ctx.agent.id)))
    .orderBy(desc(productCards.id))
    .limit(200);

  const cards = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      product_id: c.productId,
      spec_id: c.specId,
      card_content: await readStoredCredential(env, c.cardContent, INVENTORY_CREDENTIAL_SCOPE),
      status: c.status,
      is_loop: Number(c.isLoop || 0),
      order_no: c.orderNo,
      created_at: c.createdAt,
      sold_at: c.soldAt,
    }))
  );
  return { cards };
}

export async function importAgentPrivateCards(
  env: Env,
  ctx: ActiveAgentContext,
  productId: number,
  body: { spec_id?: string; lines: string; is_loop?: boolean; dedupe?: boolean }
) {
  assertPrivateProductsAllowed(ctx);
  const db = createDb(env.DB);
  await assertOwnedPrivateProduct(db, ctx.agent.id, productId);

  const specId = (body.spec_id || 'default').trim() || 'default';
  const rawLines = body.lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length === 0) throw Errors.validation('请至少输入一条有效卡密');
  if (rawLines.length > 500) throw Errors.validation('单次最多导入 500 条自有卡密');

  const dedupe = body.dedupe !== false;
  let toInsert = rawLines;
  if (dedupe) {
    const existingRows = await db
      .select({ cardContent: productCards.cardContent })
      .from(productCards)
      .where(and(eq(productCards.productId, productId), eq(productCards.ownerAgentId, ctx.agent.id)));
    const existingSet = new Set(
      await Promise.all(
        existingRows.map(async (r) =>
          (await readStoredCredential(env, r.cardContent, INVENTORY_CREDENTIAL_SCOPE)).trim()
        )
      )
    );
    const seen = new Set<string>();
    toInsert = rawLines.filter((line) => {
      if (existingSet.has(line) || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
  }
  const duplicates = rawLines.length - toInsert.length;
  if (toInsert.length > 0) {
    const sealed = await Promise.all(
      toInsert.map((line) => encryptSecret(env, line, INVENTORY_CREDENTIAL_SCOPE))
    );
    const isLoop = body.is_loop ? 1 : 0;
    await db.insert(productCards).values(
      sealed.map((cardContent: string) => ({
        ownerAgentId: ctx.agent.id,
        productId,
        specId,
        cardContent,
        status: 'available',
        isLoop,
      }))
    );
  }
  return { ok: true, imported: toInsert.length, duplicates };
}

export async function deleteAgentPrivateCard(env: Env, ctx: ActiveAgentContext, cardId: number) {
  assertPrivateProductsAllowed(ctx);
  const db = createDb(env.DB);
  const deleted = await db
    .delete(productCards)
    .where(
      and(
        eq(productCards.id, cardId),
        eq(productCards.ownerAgentId, ctx.agent.id),
        eq(productCards.status, 'available')
      )
    )
    .returning({ id: productCards.id });
  if (deleted.length === 0) throw Errors.notFound('未找到该待售自有卡密');
  return { ok: true };
}
