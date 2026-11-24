import { z } from 'zod';
import { DELIVERY_TYPES, STOCK_MODES, WARRANTY_TYPES } from '../constants/enums';
import { BUSINESS_LIMITS } from '../constants/limits';
import { bundleItemSchema } from './commerce.contract';

export const productSpecSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  name_en: z.string().trim().max(120).optional(),
  price: z.number().nonnegative(),
  base_price: z.number().nonnegative().optional(),
  cost_price: z.number().nonnegative().nullable().optional(),
  original_price: z.number().nonnegative().optional(),
  badge: z.string().trim().max(32).optional(),
  description: z.string().trim().max(240).optional(),
  seat_slots: z.number().int().positive().optional(),
  api_credit_usd: z.number().nonnegative().optional(),
});

export const productCustomFieldSchema = z.object({
  key: z.string().trim().min(1).max(48),
  label: z.string().trim().min(1).max(80),
  label_en: z.string().trim().max(80).optional(),
  placeholder: z.string().trim().max(160).optional(),
  required: z.boolean().optional(),
  type: z.enum(['text', 'email', 'select']).optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export const productFaqSchema = z.object({
  q: z.string().trim().min(1).max(240),
  a: z.string().trim().min(1).max(2000),
});

export const productTierPricingRuleSchema = z.object({
  min_qty: z.coerce.number().int().min(2).max(BUSINESS_LIMITS.MAX_ORDER_QUANTITY),
  discount_rate: z.coerce.number().min(0.1).max(0.99),
});

export const upsertProductInputSchema = z.object({
  category_id: z.number().int().positive(),
  slug: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().min(1, '商品标题不能为空').max(200),
  title_en: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(400).optional(),
  subtitle_en: z.string().trim().max(400).optional(),
  icon_key: z.string().trim().max(48).optional(),
  accent_color: z.string().trim().max(32).optional(),
  delivery_type: z.enum(DELIVERY_TYPES).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  base_price: z.number().nonnegative(),
  original_price: z.number().nonnegative().nullable().optional(),
  cost_price: z.number().nonnegative().nullable().optional(),
  allow_below_cost: z.boolean().optional(),
  stock_mode: z.enum(STOCK_MODES).optional(),
  manual_stock: z.number().int().nonnegative().optional(),
  seat_total: z.number().int().nonnegative().max(BUSINESS_LIMITS.MAX_PRODUCT_SEATS).optional(),
  seat_used: z.number().int().nonnegative().max(BUSINESS_LIMITS.MAX_PRODUCT_SEATS).optional(),
  summary_markdown: z.string().max(4000).optional(),
  detail_markdown: z.string().max(50000).optional(),
  risk_notice: z.string().max(4000).optional(),
  warranty_type: z.enum(WARRANTY_TYPES).optional(),
  warranty_days: z.number().int().nonnegative().max(3650).optional(),
  warranty_summary: z.string().max(500).optional(),
  faq: z.array(productFaqSchema).max(20).optional(),
  custom_fields: z.array(productCustomFieldSchema).max(12).optional(),
  specs: z.array(productSpecSchema).max(30).optional(),
  tier_pricing: z.array(productTierPricingRuleSchema).max(10).optional(),
  is_featured: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  is_active: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  sort_order: z.number().int().optional(),
  min_quantity: z.coerce.number().int().min(1).max(BUSINESS_LIMITS.MAX_ORDER_QUANTITY).optional(),
  max_quantity: z.coerce.number().int().min(0).max(BUSINESS_LIMITS.MAX_ORDER_QUANTITY).optional(),
  require_login: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  is_hidden: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  access_password: z.string().trim().max(64).optional(),
  flash_sale_price: z.coerce.number().nonnegative().nullable().optional(),
  flash_sale_start_at: z.string().trim().max(40).optional(),
  flash_sale_end_at: z.string().trim().max(40).optional(),
  flash_sale_limit: z.coerce.number().int().min(0).max(100000).optional(),
  bundle_items: z.array(bundleItemSchema).max(10).optional(),
  group_buy_enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  group_buy_size: z.coerce.number().int().min(2).max(20).optional(),
  group_buy_price: z.coerce.number().nonnegative().nullable().optional(),
  group_buy_hours: z.coerce.number().int().min(1).max(168).optional(),
  allow_card_selection: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  card_select_fee: z.coerce.number().min(0).max(9999).optional(),
  member_price: z.coerce.number().nonnegative().nullable().optional(),
});

export const reorderIdsInputSchema = z.object({
  ordered_ids: z.array(z.number().int().positive()).min(1).max(500),
  group_id: z.number().int().positive().optional(),
});

export type ProductSpecDto = z.infer<typeof productSpecSchema>;
export type ProductCustomFieldDto = z.infer<typeof productCustomFieldSchema>;
export type ProductFaqDto = z.infer<typeof productFaqSchema>;
export type UpsertProductInput = z.infer<typeof upsertProductInputSchema>;
export type ReorderIdsInput = z.infer<typeof reorderIdsInputSchema>;
