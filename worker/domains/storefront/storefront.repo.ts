import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  agentProductOverrides,
  agentProductPrices,
  agentTiers,
  announcements,
  categories,
  categoryGroups,
  coupons,
  helpArticles,
  type ProductRow,
  paymentPlugins,
  productCards,
  products,
  restockSubscriptions,
  siteSettings,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export { loadHealthyUpstreamStockMapsRepo, type UpstreamStockMaps } from './storefront-upstream.repo';

export interface ProductOverrideRow {
  product_id: number;
  is_listed: number;
  custom_title: string | null;
  custom_subtitle: string | null;
  custom_detail_markdown: string | null;
  custom_risk_notice: string | null;
}

/** 将 Drizzle ProductRow 映射为既有蛇形结构，确保全链路兼容 */
export function mapProductRowToSnake(row: ProductRow): Record<string, unknown> {
  return {
    id: row.id,
    owner_agent_id: row.ownerAgentId,
    product_source: row.productSource,
    category_id: row.categoryId,
    slug: row.slug,
    title: row.title,
    title_en: row.titleEn,
    subtitle: row.subtitle,
    subtitle_en: row.subtitleEn,
    icon_key: row.iconKey,
    accent_color: row.accentColor,
    delivery_type: row.deliveryType,
    tags_json: row.tagsJson,
    base_price: row.basePrice,
    original_price: row.originalPrice,
    cost_price: row.costPrice,
    wholesale_discount: row.wholesaleDiscount,
    stock_mode: row.stockMode,
    manual_stock: row.manualStock,
    seat_total: row.seatTotal,
    seat_used: row.seatUsed,
    summary_markdown: row.summaryMarkdown,
    detail_markdown: row.detailMarkdown,
    risk_notice: row.riskNotice,
    warranty_type: row.warrantyType,
    warranty_days: row.warrantyDays,
    warranty_summary: row.warrantySummary,
    translations_json: row.translationsJson,
    faq_json: row.faqJson,
    custom_fields_json: row.customFieldsJson,
    specs_json: row.specsJson,
    tier_pricing_json: row.tierPricingJson,
    is_featured: row.isFeatured,
    is_active: row.isActive,
    sort_order: row.sortOrder,
    sales_count: row.salesCount,
    min_quantity: row.minQuantity,
    max_quantity: row.maxQuantity,
    require_login: row.requireLogin,
    is_hidden: row.isHidden,
    access_password: row.accessPassword,
    flash_sale_price: row.flashSalePrice,
    flash_sale_start_at: row.flashSaleStartAt,
    flash_sale_end_at: row.flashSaleEndAt,
    flash_sale_limit: row.flashSaleLimit,
    flash_sale_sold: row.flashSaleSold,
    bundle_items_json: row.bundleItemsJson,
    group_buy_enabled: row.groupBuyEnabled,
    group_buy_size: row.groupBuySize,
    group_buy_price: row.groupBuyPrice,
    group_buy_hours: row.groupBuyHours,
    allow_card_selection: row.allowCardSelection,
    card_select_fee: row.cardSelectFee,
    member_price: row.memberPrice,
  };
}

export async function getBaseAgentDiscountRepo(db: AppDatabase, ownerAgentId = 0): Promise<number> {
  const rows = await db
    .select({ discountRate: agentTiers.discountRate })
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, ownerAgentId))
    .orderBy(asc(agentTiers.levelRank))
    .limit(1);
  return rows[0] ? Number(rows[0].discountRate) : 0.9;
}

export async function loadAvailableCardCountsByProduct(db: AppDatabase): Promise<Map<number, number>> {
  const rows = await db
    .select({
      productId: productCards.productId,
      c: sql<number>`count(*)`,
      hasLoop: sql<number>`MAX(CASE WHEN ${productCards.isLoop} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(productCards)
    .where(eq(productCards.status, 'available'))
    .groupBy(productCards.productId);

  const map = new Map<number, number>();
  for (const r of rows) {
    const cnt = Number(r.c);
    map.set(Number(r.productId), Number(r.hasLoop) === 1 && cnt > 0 ? Math.max(cnt, 999) : cnt);
  }
  return map;
}

export async function loadAvailableCardCountForProduct(db: AppDatabase, productId: number): Promise<number> {
  const rows = await db
    .select({
      c: sql<number>`count(*)`,
      hasLoop: sql<number>`MAX(CASE WHEN ${productCards.isLoop} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(productCards)
    .where(and(eq(productCards.productId, productId), eq(productCards.status, 'available')));
  const cnt = Number(rows[0]?.c ?? 0);
  return Number(rows[0]?.hasLoop ?? 0) === 1 && cnt > 0 ? Math.max(cnt, 999) : cnt;
}

export async function loadAvailableCardCountsBySpec(
  db: AppDatabase,
  productId: number
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      specId: productCards.specId,
      c: sql<number>`count(*)`,
      hasLoop: sql<number>`MAX(CASE WHEN ${productCards.isLoop} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(productCards)
    .where(and(eq(productCards.productId, productId), eq(productCards.status, 'available')))
    .groupBy(productCards.specId);

  const map = new Map<string, number>();
  for (const r of rows) {
    const cnt = Number(r.c);
    map.set(r.specId, Number(r.hasLoop) === 1 && cnt > 0 ? Math.max(cnt, 999) : cnt);
  }
  return map;
}

export async function loadAgentCustomPrices(
  db: AppDatabase,
  agentId: number,
  productId?: number
): Promise<Array<{ productId: number; specId: string; customPrice: number }>> {
  const cond = productId
    ? and(eq(agentProductPrices.agentId, agentId), eq(agentProductPrices.productId, productId))
    : eq(agentProductPrices.agentId, agentId);
  return db
    .select({
      productId: agentProductPrices.productId,
      specId: agentProductPrices.specId,
      customPrice: agentProductPrices.customPrice,
    })
    .from(agentProductPrices)
    .where(cond);
}

export async function loadAgentProductOverrides(
  db: AppDatabase,
  agentId: number,
  productId?: number
): Promise<ProductOverrideRow[]> {
  const cond = productId
    ? and(eq(agentProductOverrides.agentId, agentId), eq(agentProductOverrides.productId, productId))
    : eq(agentProductOverrides.agentId, agentId);
  const rows = await db
    .select({
      productId: agentProductOverrides.productId,
      isListed: agentProductOverrides.isListed,
      customTitle: agentProductOverrides.customTitle,
      customSubtitle: agentProductOverrides.customSubtitle,
      customDetailMarkdown: agentProductOverrides.customDetailMarkdown,
      customRiskNotice: agentProductOverrides.customRiskNotice,
    })
    .from(agentProductOverrides)
    .where(cond);
  return rows.map((r) => ({
    product_id: r.productId,
    is_listed: r.isListed,
    custom_title: r.customTitle,
    custom_subtitle: r.customSubtitle,
    custom_detail_markdown: r.customDetailMarkdown,
    custom_risk_notice: r.customRiskNotice,
  }));
}

export async function loadAgentHiddenProductIds(db: AppDatabase, agentId: number): Promise<Set<number>> {
  const rows = await db
    .select({ productId: agentProductOverrides.productId })
    .from(agentProductOverrides)
    .where(and(eq(agentProductOverrides.agentId, agentId), eq(agentProductOverrides.isListed, 0)));
  return new Set(rows.map((r) => Number(r.productId)));
}

export async function loadStorefrontBootstrapData(
  db: AppDatabase,
  ownerAgentId: number,
  includePrivate = false
) {
  const productOwnerCond =
    ownerAgentId > 0 && includePrivate
      ? sql`${products.ownerAgentId} IN (0, ${ownerAgentId})`
      : eq(products.ownerAgentId, 0);
  const [
    settingsRows,
    groupsRows,
    categoriesRows,
    activeProductsRows,
    announcementsRows,
    paymentRows,
    balancePluginRows,
  ] = await Promise.all([
    db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings),
    db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.isActive, 1))
      .orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.id)),
    db
      .select()
      .from(categories)
      .where(eq(categories.isActive, 1))
      .orderBy(asc(categories.sortOrder), asc(categories.id)),
    db
      .select({
        id: products.id,
        categoryId: products.categoryId,
        isFeatured: products.isFeatured,
      })
      .from(products)
      .where(and(eq(products.isActive, 1), eq(products.isHidden, 0), productOwnerCond)),
    db
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.isActive, 1),
          eq(announcements.ownerAgentId, ownerAgentId),
          eq(announcements.audience, 'storefront')
        )
      )
      .orderBy(desc(announcements.isPinned), desc(announcements.id)),
    db
      .select({
        id: paymentPlugins.id,
        name: paymentPlugins.name,
        description: paymentPlugins.description,
        enabled: paymentPlugins.enabled,
        configJson: paymentPlugins.configJson,
      })
      .from(paymentPlugins)
      .where(eq(paymentPlugins.enabled, 1)),
    db
      .select({ configJson: paymentPlugins.configJson })
      .from(paymentPlugins)
      .where(eq(paymentPlugins.id, 'balance'))
      .limit(1),
  ]);

  return {
    settingsRows,
    groupsRows,
    categoriesRows,
    activeProductsRows,
    announcementsRows,
    paymentRows,
    balanceConfigJson: balancePluginRows[0]?.configJson ?? null,
  };
}

export async function findCategoryIdBySlug(db: AppDatabase, slug: string): Promise<number | null> {
  const rows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function findCategorySummaryById(db: AppDatabase, id: number) {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      name_en: categories.nameEn,
      schema_type: categories.schemaType,
    })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveProductsRepo(
  db: AppDatabase,
  filter?: {
    featuredOnly?: boolean;
    categoryId?: number;
    orderBySalesOnly?: boolean;
    ownerAgentId?: number;
    includePrivate?: boolean;
  }
): Promise<ProductRow[]> {
  const ownerId = filter?.ownerAgentId ?? 0;
  const ownerCond =
    ownerId > 0 && filter?.includePrivate
      ? sql`${products.ownerAgentId} IN (0, ${ownerId})`
      : eq(products.ownerAgentId, 0);
  const conds = [eq(products.isActive, 1), eq(products.isHidden, 0), ownerCond];
  if (filter?.featuredOnly) conds.push(eq(products.isFeatured, 1));
  if (filter?.categoryId !== undefined) conds.push(eq(products.categoryId, filter.categoryId));

  const query = db
    .select()
    .from(products)
    .where(and(...conds));

  if (filter?.orderBySalesOnly) {
    return query.orderBy(desc(products.salesCount));
  }
  return query.orderBy(asc(products.sortOrder), desc(products.salesCount), asc(products.id));
}

export async function findActiveProductByIdOrSlug(
  db: AppDatabase,
  idOrSlug: string,
  ownerAgentId = 0,
  includePrivate = false
): Promise<ProductRow | null> {
  const isNum = /^\d+$/.test(idOrSlug);
  const ownerCond =
    ownerAgentId > 0 && includePrivate
      ? sql`${products.ownerAgentId} IN (0, ${ownerAgentId})`
      : eq(products.ownerAgentId, 0);
  const cond = isNum
    ? and(eq(products.id, Number(idOrSlug)), eq(products.isActive, 1), ownerCond)
    : and(eq(products.slug, idOrSlug), eq(products.isActive, 1), ownerCond);
  const rows = await db.select().from(products).where(cond).limit(1);
  return rows[0] ?? null;
}

export async function listActiveHelpArticlesRepo(
  db: AppDatabase,
  ownerAgentId = 0,
  inheritPlatformHelp = true
) {
  const ownerFilter =
    ownerAgentId > 0 && inheritPlatformHelp
      ? sql`${helpArticles.ownerAgentId} IN (${ownerAgentId}, 0)`
      : eq(helpArticles.ownerAgentId, ownerAgentId);
  const rows = await db
    .select()
    .from(helpArticles)
    .where(and(eq(helpArticles.isActive, 1), ownerFilter))
    .orderBy(
      sql`CASE WHEN ${helpArticles.ownerAgentId} = ${ownerAgentId} THEN 0 ELSE 1 END`,
      asc(helpArticles.sortOrder),
      asc(helpArticles.id)
    );
  return rows.map((r) => ({
    id: r.id,
    owner_agent_id: r.ownerAgentId,
    category: r.category,
    title: r.title,
    title_en: r.titleEn,
    content: r.content,
    content_en: r.contentEn,
    translations_json: r.translationsJson,
    sort_order: r.sortOrder,
    is_active: r.isActive,
    created_at: r.createdAt,
  }));
}

export async function findActiveCouponByCode(db: AppDatabase, code: string, ownerAgentId = 0) {
  const rows = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.ownerAgentId, ownerAgentId),
        sql`upper(${coupons.code}) = ${code.toUpperCase()}`,
        eq(coupons.isActive, 1)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertRestockSubscriptionRepo(
  db: AppDatabase,
  input: { siteAgentId: number; productId: number; specId: string; email: string }
): Promise<void> {
  await db
    .insert(restockSubscriptions)
    .values({
      siteAgentId: input.siteAgentId,
      productId: input.productId,
      specId: input.specId,
      email: input.email,
      status: 'waiting',
    })
    .onConflictDoUpdate({
      target: [
        restockSubscriptions.siteAgentId,
        restockSubscriptions.productId,
        restockSubscriptions.specId,
        restockSubscriptions.email,
      ],
      set: {
        status: 'waiting',
        cycle: sql`${restockSubscriptions.cycle} + 1`,
        createdAt: sql`datetime('now')`,
        notifiedAt: null,
      },
      setWhere: eq(restockSubscriptions.status, 'notified'),
    });
}

/** 仅加载边缘 HTML SEO 注入所需的最小主站品牌与标语配置 */
export async function loadMainBrandSettingsForSeoRepo(
  db: AppDatabase
): Promise<{ brandName?: string; brandTagline?: string }> {
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(sql`${siteSettings.key} IN ('brand_name', 'brand_tagline')`);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    brandName: map.get('brand_name'),
    brandTagline: map.get('brand_tagline'),
  };
}
