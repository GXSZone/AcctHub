/**
 * 运营总控后台类型定义与商品编辑器草稿构建工具
 */

import type { BundleItemDto } from '@shared/index';
import type { SaasConfigState } from '../../components/AdminAgentOpsExtras';
import type {
  AgentWithdrawalRecord,
  CouponRecord,
  ProductCustomField,
  ProductFaq,
  ProductSpec,
  RechargeCdkRecord,
  SupportTicketRecord,
  WarrantyType,
} from '../../types';
import type { EditableProduct } from '../admin-catalog/product-editor/product-editor.types';
import type { NotifyConfigState } from '../admin-ops';

export type AdminTab =
  | 'overview'
  | 'finance'
  | 'products'
  | 'categories'
  | 'settings'
  | 'orders'
  | 'agents'
  | 'members'
  | 'tickets'
  | 'marketing'
  | 'announcements'
  | 'help'
  | 'audit'
  | 'upstreams'
  | 'ai';

export interface AdminProductRow {
  id: number;
  category_id: number;
  slug: string;
  title: string;
  title_en: string;
  subtitle: string;
  subtitle_en: string;
  icon_key: string;
  accent_color: string;
  delivery_type: string;
  base_price: number;
  original_price: number | null;
  cost_price?: number | null;
  upstream_cost?: number | null;
  stock_mode: string;
  manual_stock: number;
  seat_total: number;
  seat_used: number;
  summary_markdown: string;
  detail_markdown: string;
  risk_notice: string;
  warranty_type?: WarrantyType;
  warranty_days?: number;
  warranty_summary?: string;
  available_cards: number;
  upstream_binding_count?: number;
  upstream_cached_stock?: number;
  restock_waiting?: number;
  is_featured: number;
  is_active: number;
  sort_order: number;
  sales_count: number;
  min_quantity?: number;
  max_quantity?: number;
  require_login?: number | boolean;
  is_hidden?: number | boolean;
  access_password?: string;
  flash_sale_price?: number | null;
  flash_sale_start_at?: string;
  flash_sale_end_at?: string;
  flash_sale_limit?: number;
  bundle_items?: BundleItemDto[];
  group_buy_enabled?: number | boolean;
  group_buy_size?: number;
  group_buy_price?: number | null;
  group_buy_hours?: number;
  allow_card_selection?: number | boolean;
  card_select_fee?: number;
  member_price?: number | null;
  tags: string[];
  specs: ProductSpec[];
  tier_pricing?: Array<{ min_qty: number; discount_rate: number }>;
  faq: ProductFaq[];
  custom_fields: ProductCustomField[];
}

export interface AdminOrderRow {
  order_no: string;
  public_order_no?: string | null;
  mail_status?: 'pending' | 'sent' | 'disabled' | 'failed' | null;
  product_id?: number;
  product_title: string;
  spec_name: string;
  quantity: number;
  total_amount: number;
  commission_amount: number;
  contact_email: string;
  channel: string;
  tenant_slug: string | null;
  status: string;
  fulfillment_source?: string;
  upstream_source_name?: string | null;
  upstream_order_no?: string;
  upstream_cost_total?: number;
  upstream_status?: string;
  upstream_error?: string;
  created_at: string;
}

export interface AdminAgentRow {
  id: number;
  tier_id: number | null;
  tier_name: string | null;
  tier_discount_rate: number | null;
  depth?: number;
  parent_slug?: string | null;
  downline_count?: number;
  slug: string;
  brand_name: string;
  primary_domain?: string | null;
  domains_count?: number;
  allow_private_products_override?: number | null;
  allow_own_payment_override?: number | null;
  owner_email: string;
  total_recharged: number;
  markup_percent: number;
  commission_rate: number;
  total_revenue: number;
  total_commission: number;
  status: string;
}

export interface AdminAgentTierRow {
  id: number;
  code: string;
  name: string;
  level_rank: number;
  min_recharge: number;
  discount_rate: number;
  commission_rate: number;
  sub_override_rate: number;
  max_sub_agents: number;
  badge_color: string;
  perks: string[];
  allow_custom_domain?: number;
  max_custom_domains?: number;
  allow_private_products?: number;
  allow_own_payment?: number;
}

export interface AdminOverview {
  stats: {
    total_orders: number;
    total_gmv: number;
    product_gmv?: number;
    agent_upgrade_total?: number;
    total_products: number;
    total_agents: number;
    upstream_exceptions?: number;
  };
  security_warnings?: Array<{ level: 'warning' | 'danger'; code: string; message: string }>;
  settings: Record<string, string>;
  groups: Array<{ id: number; slug: string; name: string; name_en: string; sort_order: number }>;
  categories: Array<{
    id: number;
    group_id: number;
    slug: string;
    name: string;
    name_en: string;
    icon: string;
    badge_text: string;
    schema_type: string;
    sort_order: number;
  }>;
  products: AdminProductRow[];
  orders: AdminOrderRow[];
  agents: AdminAgentRow[];
  withdrawals?: AgentWithdrawalRecord[];
  saas_config?: SaasConfigState;
  coupons?: CouponRecord[];
  cdks?: RechargeCdkRecord[];
  tickets?: SupportTicketRecord[];
  notify_config?: NotifyConfigState;
  agent_tiers: AdminAgentTierRow[];
  announcements: Array<{
    id: number;
    title: string;
    title_en: string;
    content: string;
    content_en: string;
    level: string;
    audience?: 'storefront' | 'direct_downlines' | string;
    is_pinned: number;
    created_at: string;
  }>;
  help_articles: Array<{
    id: number;
    category: string;
    title: string;
    content: string;
    sort_order: number;
  }>;
  payment_plugins: Array<{
    id: string;
    name: string;
    description: string;
    enabled: number;
    config_json: string;
    secrets_configured: Record<string, boolean>;
  }>;
  fx_snapshot?: {
    usd_cny: number;
    usdt_cny: number;
    updated_at: string;
    source: string;
  };
}

export function toEditableProduct(p: AdminProductRow): EditableProduct {
  return {
    id: p.id,
    category_id: p.category_id,
    slug: p.slug,
    title: p.title,
    title_en: p.title_en || '',
    subtitle: p.subtitle || '',
    subtitle_en: p.subtitle_en || '',
    icon_key: p.icon_key || 'sparkles',
    accent_color: p.accent_color || '#D97757',
    delivery_type: p.delivery_type || 'auto',
    tags: p.tags || [],
    base_price: p.base_price,
    original_price: p.original_price,
    cost_price: p.cost_price ?? p.upstream_cost ?? null,
    stock_mode: p.stock_mode || 'cards',
    manual_stock: p.manual_stock ?? 50,
    seat_total: p.seat_total ?? 5,
    seat_used: p.seat_used ?? 0,
    summary_markdown: p.summary_markdown || '',
    detail_markdown: p.detail_markdown || '',
    risk_notice: p.risk_notice || '',
    warranty_type: p.warranty_type || 'full_period',
    warranty_days: p.warranty_days ?? 30,
    warranty_summary: p.warranty_summary || '',
    faq: p.faq || [],
    custom_fields: p.custom_fields || [],
    specs: p.specs || [],
    tier_pricing: p.tier_pricing || [],
    is_featured: p.is_featured,
    is_active: p.is_active,
    sort_order: p.sort_order ?? 10,
    min_quantity: Math.max(1, Number(p.min_quantity || 1)),
    max_quantity: Math.max(0, Number(p.max_quantity || 0)),
    require_login: Boolean(p.require_login),
    is_hidden: Boolean(p.is_hidden),
    access_password: p.access_password || '',
    flash_sale_price: p.flash_sale_price ?? null,
    flash_sale_start_at: p.flash_sale_start_at || '',
    flash_sale_end_at: p.flash_sale_end_at || '',
    flash_sale_limit: Math.max(0, Number(p.flash_sale_limit || 0)),
    bundle_items: Array.isArray(p.bundle_items) ? p.bundle_items : [],
    group_buy_enabled: Boolean(p.group_buy_enabled),
    group_buy_size: Math.max(2, Number(p.group_buy_size || 2)),
    group_buy_price: p.group_buy_price ?? null,
    group_buy_hours: Math.max(1, Number(p.group_buy_hours || 24)),
    allow_card_selection: Boolean(p.allow_card_selection),
    card_select_fee: Math.max(0, Number(p.card_select_fee || 0)),
    member_price: p.member_price ?? null,
  };
}

import type { AdminCoreDict } from '../../i18n/namespaces/admin-core';

export function buildNewProductDraft(defaultCatId: number, dict: AdminCoreDict): EditableProduct {
  return {
    id: null,
    category_id: defaultCatId,
    slug: '',
    title: '',
    title_en: '',
    subtitle: '',
    subtitle_en: '',
    icon_key: 'sparkles',
    accent_color: '#D97757',
    delivery_type: 'auto',
    tags: [dict.draftTagAuto, dict.draftTagWarranty],
    base_price: 49,
    original_price: null,
    cost_price: 28,
    stock_mode: 'cards',
    manual_stock: 50,
    seat_total: 5,
    seat_used: 0,
    summary_markdown: '',
    detail_markdown: dict.draftDetailMd,
    risk_notice: '',
    warranty_type: 'full_period',
    warranty_days: 30,
    warranty_summary: dict.draftWarrantySummary,
    faq: [{ q: dict.draftFaqQ, a: dict.draftFaqA }],
    custom_fields: [],
    specs: [{ id: 'monthly', name: dict.draftSpecName, price: 49, badge: dict.draftSpecBadge }],
    tier_pricing: [],
    is_featured: 1,
    is_active: 1,
    sort_order: 10,
    min_quantity: 1,
    max_quantity: 0,
    require_login: false,
    is_hidden: false,
    access_password: '',
    flash_sale_price: null,
    flash_sale_start_at: '',
    flash_sale_end_at: '',
    flash_sale_limit: 0,
    bundle_items: [],
    group_buy_enabled: false,
    group_buy_size: 2,
    group_buy_price: null,
    group_buy_hours: 24,
    allow_card_selection: false,
    card_select_fee: 0,
    member_price: null,
  };
}
