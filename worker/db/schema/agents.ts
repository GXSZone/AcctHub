import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 多级代理等级体系表 */
export const agentTiers = sqliteTable(
  'agent_tiers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    code: text('code').notNull(),
    name: text('name').notNull(),
    levelRank: integer('level_rank').notNull().default(1),
    minRecharge: real('min_recharge').notNull().default(100),
    discountRate: real('discount_rate').notNull().default(0.9),
    commissionRate: real('commission_rate').notNull().default(0),
    subOverrideRate: real('sub_override_rate').notNull().default(0),
    maxSubAgents: integer('max_sub_agents').notNull().default(5),
    allowCustomDomain: integer('allow_custom_domain').notNull().default(1),
    maxCustomDomains: integer('max_custom_domains').notNull().default(2),
    allowPrivateProducts: integer('allow_private_products').notNull().default(0),
    allowOwnPayment: integer('allow_own_payment').notNull().default(0),
    badgeColor: text('badge_color').notNull().default('#9A6E4B'),
    perksJson: text('perks_json').notNull().default('[]'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [uniqueIndex('uq_agent_tiers_owner_code').on(t.ownerAgentId, t.code)]
);

/** 代理商与白牌分站配置表 */
export const agents = sqliteTable(
  'agents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().unique(),
    tierId: integer('tier_id'),
    parentAgentId: integer('parent_agent_id'),
    depth: integer('depth').notNull().default(1),
    ancestorPath: text('ancestor_path').notNull().default('/'),
    canRecruit: integer('can_recruit').notNull().default(1),
    slug: text('slug').notNull().unique(),
    brandName: text('brand_name').notNull(),
    brandTagline: text('brand_tagline').notNull().default(''),
    themeAccent: text('theme_accent').notNull().default(''),
    faviconUrl: text('favicon_url').notNull().default(''),
    ogImageUrl: text('og_image_url').notNull().default(''),
    seoTitle: text('seo_title').notNull().default(''),
    seoDescription: text('seo_description').notNull().default(''),
    footerText: text('footer_text').notNull().default(''),
    supportLabel: text('support_label').notNull().default(''),
    supportUrl: text('support_url').notNull().default(''),
    supportNote: text('support_note').notNull().default(''),
    supportMediaJson: text('support_media_json').notNull().default('[]'),
    supportLinksJson: text('support_links_json').notNull().default('[]'),
    announcementBanner: text('announcement_banner').notNull().default(''),
    tickerEnabled: integer('ticker_enabled').notNull().default(1),
    tickerMode: text('ticker_mode').notNull().default('vertical'),
    tickerIncludeNotices: integer('ticker_include_notices').notNull().default(1),
    popupEnabled: integer('popup_enabled').notNull().default(0),
    popupTitle: text('popup_title').notNull().default(''),
    popupContent: text('popup_content').notNull().default(''),
    popupFrequency: text('popup_frequency').notNull().default('once_per_day'),
    popupVersion: text('popup_version').notNull().default('1'),
    downlinePopupEnabled: integer('downline_popup_enabled').notNull().default(0),
    downlinePopupTitle: text('downline_popup_title').notNull().default(''),
    downlinePopupContent: text('downline_popup_content').notNull().default(''),
    downlinePopupFrequency: text('downline_popup_frequency').notNull().default('once_per_day'),
    downlinePopupVersion: text('downline_popup_version').notNull().default('1'),
    apiIpWhitelist: text('api_ip_whitelist').notNull().default(''),
    markupPercent: real('markup_percent').notNull().default(12),
    commissionRate: real('commission_rate').notNull().default(0),
    apiKey: text('api_key').notNull().unique(),
    apiKeyHash: text('api_key_hash').notNull().default(''),
    apiKeyEnc: text('api_key_enc').notNull().default(''),
    status: text('status').notNull().default('active'),
    allowPrivateProductsOverride: integer('allow_private_products_override'),
    allowOwnPaymentOverride: integer('allow_own_payment_override'),
    totalRevenue: real('total_revenue').notNull().default(0),
    totalCommission: real('total_commission').notNull().default(0),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_agents_parent').on(t.parentAgentId), index('idx_agents_api_key_hash').on(t.apiKeyHash)]
);

/** 代理分站自定义商品规格定价表 */
export const agentProductPrices = sqliteTable(
  'agent_product_prices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: integer('agent_id').notNull(),
    productId: integer('product_id').notNull(),
    specId: text('spec_id').notNull().default('default'),
    customPrice: real('custom_price').notNull(),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [uniqueIndex('uq_agent_prod_price').on(t.agentId, t.productId, t.specId)]
);

/** 代理分站商品上下架与文案覆写表 */
export const agentProductOverrides = sqliteTable(
  'agent_product_overrides',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: integer('agent_id').notNull(),
    productId: integer('product_id').notNull(),
    isListed: integer('is_listed').notNull().default(1),
    customTitle: text('custom_title'),
    customSubtitle: text('custom_subtitle'),
    customDetailMarkdown: text('custom_detail_markdown'),
    customRiskNotice: text('custom_risk_notice'),
    updatedAt: text('updated_at').notNull().default(nowSql),
  },
  (t) => [uniqueIndex('uq_agent_prod_override').on(t.agentId, t.productId)]
);

/** 代理佣金提现申请表 */
export const agentWithdrawals = sqliteTable(
  'agent_withdrawals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    agentId: integer('agent_id').notNull(),
    userId: integer('user_id').notNull(),
    amount: real('amount').notNull(),
    channel: text('channel').notNull().default('alipay'),
    accountInfo: text('account_info').notNull(),
    accountName: text('account_name').notNull().default(''),
    status: text('status').notNull().default('pending'),
    adminNote: text('admin_note').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
    processedAt: text('processed_at'),
    feeRate: real('fee_rate').notNull().default(0),
    feeAmount: real('fee_amount').notNull().default(0),
    netAmount: real('net_amount').notNull().default(0),
  },
  (t) => [index('idx_withdrawals_agent_status').on(t.agentId, t.status)]
);

/** 多级分润佣金账本表 */
export const commissionLedger = sqliteTable(
  'commission_ledger',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderNo: text('order_no').notNull(),
    beneficiaryAgentId: integer('beneficiary_agent_id').notNull(),
    sourceAgentId: integer('source_agent_id').notNull(),
    hopDistance: integer('hop_distance').notNull().default(0),
    rewardType: text('reward_type').notNull().default('direct_sale'),
    amount: real('amount').notNull().default(0),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_commission_beneficiary').on(t.beneficiaryAgentId, t.id),
    index('idx_commission_order').on(t.orderNo),
  ]
);

export type AgentTierRow = typeof agentTiers.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
