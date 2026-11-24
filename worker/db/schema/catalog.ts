import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 商品大类分组表 */
export const categoryGroups = sqliteTable('category_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  nameEn: text('name_en').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isCollapsible: integer('is_collapsible').notNull().default(1),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(nowSql),
});

/** 商品子分类表 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    groupId: integer('group_id').notNull(),
    parentId: integer('parent_id'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    nameEn: text('name_en').notNull().default(''),
    icon: text('icon').notNull().default('sparkles'),
    badgeText: text('badge_text').notNull().default(''),
    schemaType: text('schema_type').notNull().default('ai_subscription'),
    configJson: text('config_json').notNull().default('{}'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    uniqueIndex('uq_categories_owner_slug').on(t.ownerAgentId, t.slug),
    index('idx_categories_group_sort').on(t.groupId, t.sortOrder),
  ]
);

/** 商品主表（owner_agent_id = 0 表示平台统一货源，> 0 表示分站自有私有商品） */
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    productSource: text('product_source').notNull().default('platform'),
    categoryId: integer('category_id').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    titleEn: text('title_en').notNull().default(''),
    subtitle: text('subtitle').notNull().default(''),
    subtitleEn: text('subtitle_en').notNull().default(''),
    iconKey: text('icon_key').notNull().default('sparkles'),
    accentColor: text('accent_color').notNull().default('#D97757'),
    deliveryType: text('delivery_type').notNull().default('auto'),
    tagsJson: text('tags_json').notNull().default('[]'),
    basePrice: real('base_price').notNull().default(0),
    originalPrice: real('original_price'),
    costPrice: real('cost_price'),
    wholesaleDiscount: real('wholesale_discount').notNull().default(0.82),
    stockMode: text('stock_mode').notNull().default('cards'),
    manualStock: integer('manual_stock').notNull().default(99),
    seatTotal: integer('seat_total').notNull().default(0),
    seatUsed: integer('seat_used').notNull().default(0),
    summaryMarkdown: text('summary_markdown').notNull().default(''),
    detailMarkdown: text('detail_markdown').notNull().default(''),
    riskNotice: text('risk_notice').notNull().default(''),
    warrantyType: text('warranty_type').notNull().default('full_period'),
    warrantyDays: integer('warranty_days').notNull().default(30),
    warrantySummary: text('warranty_summary').notNull().default(''),
    translationsJson: text('translations_json').notNull().default('{}'),
    faqJson: text('faq_json').notNull().default('[]'),
    customFieldsJson: text('custom_fields_json').notNull().default('[]'),
    specsJson: text('specs_json').notNull().default('[]'),
    tierPricingJson: text('tier_pricing_json').notNull().default('[]'),
    upstreamSourceId: integer('upstream_source_id'),
    upstreamItemId: text('upstream_item_id'),
    upstreamCost: real('upstream_cost'),
    isFeatured: integer('is_featured').notNull().default(0),
    isActive: integer('is_active').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    salesCount: integer('sales_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
    updatedAt: text('updated_at').notNull().default(nowSql),
    minQuantity: integer('min_quantity').notNull().default(1),
    maxQuantity: integer('max_quantity').notNull().default(0),
    requireLogin: integer('require_login').notNull().default(0),
    isHidden: integer('is_hidden').notNull().default(0),
    accessPassword: text('access_password').notNull().default(''),
    flashSalePrice: real('flash_sale_price'),
    flashSaleStartAt: text('flash_sale_start_at').notNull().default(''),
    flashSaleEndAt: text('flash_sale_end_at').notNull().default(''),
    flashSaleLimit: integer('flash_sale_limit').notNull().default(0),
    flashSaleSold: integer('flash_sale_sold').notNull().default(0),
    bundleItemsJson: text('bundle_items_json').notNull().default('[]'),
    groupBuyEnabled: integer('group_buy_enabled').notNull().default(0),
    groupBuySize: integer('group_buy_size').notNull().default(2),
    groupBuyPrice: real('group_buy_price'),
    groupBuyHours: integer('group_buy_hours').notNull().default(24),
    allowCardSelection: integer('allow_card_selection').notNull().default(0),
    cardSelectFee: real('card_select_fee').notNull().default(0),
    memberPrice: real('member_price'),
  },
  (t) => [
    uniqueIndex('uq_products_owner_slug').on(t.ownerAgentId, t.slug),
    index('idx_products_owner_active').on(t.ownerAgentId, t.isActive, t.sortOrder),
    index('idx_products_cat_active').on(t.categoryId, t.isActive, t.sortOrder),
    index('idx_products_featured').on(t.isFeatured, t.isActive),
  ]
);

/** 自动发货卡密库存表 */
export const productCards = sqliteTable(
  'product_cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    productId: integer('product_id').notNull(),
    specId: text('spec_id').notNull().default('default'),
    cardContent: text('card_content').notNull(),
    credentialFingerprint: text('credential_fingerprint'),
    upstreamPurchaseId: integer('upstream_purchase_id'),
    status: text('status').notNull().default('available'),
    orderNo: text('order_no'),
    createdAt: text('created_at').notNull().default(nowSql),
    soldAt: text('sold_at'),
    isLoop: integer('is_loop').notNull().default(0),
    publicLabel: text('public_label').notNull().default(''),
    selectFee: real('select_fee').notNull().default(0),
  },
  (t) => [
    index('idx_cards_prod_spec_status').on(t.productId, t.specId, t.status),
    index('idx_cards_selectable').on(t.productId, t.specId, t.status, t.publicLabel),
    uniqueIndex('uq_product_cards_fingerprint').on(t.productId, t.credentialFingerprint),
    index('idx_product_cards_upstream_purchase').on(t.upstreamPurchaseId),
  ]
);

/** 缺货补货提醒订阅表 */
export const restockSubscriptions = sqliteTable(
  'restock_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    productId: integer('product_id').notNull(),
    specId: text('spec_id').notNull().default('default'),
    email: text('email').notNull(),
    status: text('status').notNull().default('waiting'),
    createdAt: text('created_at').notNull().default(nowSql),
    notifiedAt: text('notified_at'),
    cycle: integer('cycle').notNull().default(0),
  },
  (t) => [
    uniqueIndex('uq_restock_sub').on(t.siteAgentId, t.productId, t.specId, t.email),
    index('idx_restock_ready').on(t.productId, t.specId, t.status),
  ]
);

export type CategoryGroupRow = typeof categoryGroups.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ProductCardRow = typeof productCards.$inferSelect;
