/**
 * 商城前台、分类、商品与站点基础配置类型定义
 */

import type { BulkTierUnitPrices } from '@shared/domain/pricing';
import type {
  FlashSaleSnapshot,
  FxDisplayRatesDto,
  GroupBuyConfigSnapshot,
  PublicOAuthProviderDto,
  TenantCapabilitiesDto,
  TenantResolutionMode,
} from '@shared/index';
import type { WarrantyType } from './order';

export interface TenantInfo {
  isSubAgent: boolean;
  agentId: number | null;
  slug: string | null;
  brandName: string | null;
  brandTagline: string | null;
  markupPercent: number;
  commissionRate: number;
  themeAccent?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  footerText?: string;
  resolvedVia?: TenantResolutionMode;
  primaryHostname?: string | null;
  capabilities?: TenantCapabilitiesDto;
}

interface CategoryItem {
  id: number;
  group_id: number;
  slug: string;
  name: string;
  name_en: string;
  icon: string;
  badge_text: string;
  schema_type: string;
  sort_order: number;
  product_count: number;
  translations_json?: string;
  is_active?: number;
}

export interface CategoryGroup {
  id: number;
  slug: string;
  name: string;
  name_en: string;
  sort_order: number;
  is_collapsible: number;
  translations_json?: string;
  is_active?: number;
  categories: CategoryItem[];
}

export interface ProductSpec {
  id: string;
  name: string;
  name_en?: string;
  price: number;
  base_price?: number;
  cost_price?: number | null;
  bulk_tier_unit_prices?: BulkTierUnitPrices;
  original_price?: number;
  badge?: string;
  description?: string;
  seat_slots?: number;
  api_credit_usd?: number;
}

export interface ProductCustomField {
  key: string;
  label: string;
  label_en?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'select';
  options?: string[];
}

export interface ProductFaq {
  q: string;
  a: string;
}

export interface Product {
  id: number;
  owner_agent_id?: number;
  product_source?: 'platform' | 'tenant_private' | string;
  category_id: number;
  slug: string;
  title: string;
  title_en: string;
  subtitle: string;
  subtitle_en: string;
  icon_key: string;
  accent_color: string;
  delivery_type: 'auto' | 'manual' | 'preorder' | 'api_key' | string;
  warranty_type?: WarrantyType;
  warranty_days?: number;
  warranty_summary?: string;
  tags: string[];
  base_price: number;
  price: number;
  original_price: number | null;
  wholesale_price: number;
  stock_mode: 'cards' | 'manual_stock' | 'seats' | string;
  available_stock: number;
  stock_label: string;
  seat_total: number;
  seat_used: number;
  summary_markdown: string;
  detail_markdown: string;
  risk_notice: string;
  faq: ProductFaq[];
  custom_fields: ProductCustomField[];
  specs: ProductSpec[];
  tier_pricing?: Array<{ min_qty: number; discount_rate: number }>;
  bulk_tier_unit_prices?: BulkTierUnitPrices;
  spec_stock?: Record<string, number>;
  category?: {
    id: number;
    slug: string;
    name: string;
    name_en: string;
    schema_type: string;
  };
  is_featured: boolean;
  is_active: boolean;
  is_private?: boolean;
  min_quantity?: number;
  max_quantity?: number;
  require_login?: boolean;
  is_hidden?: boolean;
  has_access_password?: boolean;
  flash_sale?: FlashSaleSnapshot;
  bundle_items?: Array<{
    product_id: number;
    spec_id: string;
    quantity: number;
    title: string;
    available_stock: number;
  }>;
  group_buy?: GroupBuyConfigSnapshot;
  allow_card_selection?: boolean;
  card_select_fee?: number;
  member_price?: number | null;
  translations_json?: string;
  sort_order: number;
  sales_count: number;
}

export interface Announcement {
  id: number;
  owner_agent_id?: number;
  audience?: 'storefront' | 'direct_downlines' | string;
  title: string;
  title_en: string;
  content: string;
  content_en: string;
  level: 'info' | 'highlight' | 'warning' | string;
  is_pinned: number;
  translations_json?: string;
  created_at: string;
}

export interface SupportMediaItem {
  title: string;
  url: string;
}

export interface SupportLinkItem {
  label: string;
  url: string;
}

export interface HelpArticle {
  id: number;
  owner_agent_id?: number;
  category: string;
  title: string;
  title_en: string;
  content: string;
  content_en: string;
  translations_json?: string;
  sort_order: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  description: string;
  enabled: number;
  is_tenant_own?: boolean;
  fee_rate_pct?: number;
}

export interface BootstrapPayload {
  tenant: TenantInfo;
  settings: Record<string, string>;
  groups: CategoryGroup[];
  counts: {
    featured: number;
    all: number;
  };
  announcements: Announcement[];
  payment_methods: PaymentMethod[];
  tenant_payment_methods?: PaymentMethod[];
  recharge?: {
    min_topup: number;
    max_topup: number;
    cdk_purchase_url?: string;
    cdk_purchase_label?: string;
  };
  registration?: { welcome_credit: number };
  mail_delivery_enabled?: boolean;
  oauth_providers?: PublicOAuthProviderDto[];
  fx_rates?: FxDisplayRatesDto;
  security?: {
    turnstile_enabled: boolean;
    turnstile_site_key: string;
  };
}
