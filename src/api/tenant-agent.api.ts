/**
 * 分站 SaaS 自治能力 API 客户端（多域名授权、跨站入口、扩展配置、分站优惠券与帮助文章）
 */

import type { BundleItemDto } from '@shared/index';
import type { ProductCustomField, ProductFaq, ProductSpec, TenantDomainItem, WarrantyType } from '../types';
import { apiRequest } from './http';

export interface AgentPrivateProductItem {
  id: number;
  category_id: number;
  slug: string;
  title: string;
  title_en?: string;
  subtitle: string;
  subtitle_en?: string;
  icon_key?: string;
  accent_color?: string;
  delivery_type?: string;
  tags?: string[];
  base_price: number;
  original_price: number | null;
  cost_price?: number | null;
  stock_mode?: string;
  manual_stock?: number;
  seat_total?: number;
  seat_used?: number;
  summary_markdown?: string;
  detail_markdown: string;
  risk_notice?: string;
  warranty_type?: WarrantyType;
  warranty_days?: number;
  warranty_summary?: string;
  specs?: ProductSpec[];
  tier_pricing?: Array<{ min_qty: number; discount_rate: number }>;
  faq?: ProductFaq[];
  custom_fields?: ProductCustomField[];
  is_featured?: number;
  is_active: number;
  sort_order?: number;
  sales_count: number;
  min_quantity?: number;
  max_quantity?: number;
  require_login?: boolean;
  is_hidden?: boolean;
  access_password?: string;
  flash_sale_price?: number | null;
  flash_sale_start_at?: string;
  flash_sale_end_at?: string;
  flash_sale_limit?: number;
  bundle_items?: BundleItemDto[];
  group_buy_enabled?: boolean;
  group_buy_size?: number;
  group_buy_price?: number | null;
  group_buy_hours?: number;
  allow_card_selection?: boolean;
  card_select_fee?: number;
  member_price?: number | null;
  available_cards: number;
  created_at: string;
}

export interface AgentCouponItem {
  id: number;
  owner_agent_id: number;
  code: string;
  name: string;
  discount_type: 'fixed' | 'percent';
  discount_value: number;
  min_order_amount: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: number;
  created_at: string;
}

export interface AgentHelpItem {
  id: number;
  owner_agent_id: number;
  category: string;
  title: string;
  title_en: string;
  content: string;
  content_en: string;
  sort_order: number;
  is_active: number;
  created_at: string;
}

export const tenantAgentApi = {
  getMyStoreEntry: () =>
    apiRequest<{
      agent_id: number;
      slug: string;
      brand_name: string;
      target_origin: string | null;
    }>('/api/agent/my-store-entry'),

  listDomains: () =>
    apiRequest<{
      items: TenantDomainItem[];
      quota: {
        allow_custom_domain: boolean;
        max_custom_domains: number;
        used_custom_domains: number;
      };
      domain_config: {
        neutral_base_domain: string;
        saas_cname_target: string;
        cf_saas_enabled: boolean;
      };
    }>('/api/agent/domains'),

  bindDomain: (payload: { hostname: string; is_primary?: boolean }) =>
    apiRequest<{ ok: boolean; domain: TenantDomainItem; message: string }>('/api/agent/domains', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  setPrimaryDomain: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/domains/${id}/primary`, { method: 'PUT' }),

  verifyDomainById: (id: number) =>
    apiRequest<{ ok: boolean; status: string; message: string; domain: TenantDomainItem }>(
      `/api/agent/domains/${id}/verify`,
      { method: 'POST' }
    ),

  deleteDomain: (id: number) => apiRequest<{ ok: boolean }>(`/api/agent/domains/${id}`, { method: 'DELETE' }),

  getSiteSettings: () =>
    apiRequest<{ show_api_docs: boolean; inherit_platform_help: boolean; header_links_json?: string }>(
      '/api/agent/site-settings'
    ),

  updateSiteSettings: (payload: {
    show_api_docs?: boolean;
    inherit_platform_help?: boolean;
    header_links_json?: string;
  }) =>
    apiRequest<{
      ok: boolean;
      show_api_docs: boolean;
      inherit_platform_help: boolean;
      header_links_json?: string;
    }>('/api/agent/site-settings', { method: 'PUT', body: JSON.stringify(payload) }),

  listCoupons: () => apiRequest<{ items: AgentCouponItem[] }>('/api/agent/coupons'),

  createCoupon: (payload: {
    code: string;
    name: string;
    discount_type: 'fixed' | 'percent';
    discount_value: number;
    min_order_amount: number;
    max_uses: number;
    expires_at?: string;
  }) =>
    apiRequest<{ ok: boolean; id: number }>('/api/agent/coupons', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleCoupon: (id: number, is_active: boolean) =>
    apiRequest<{ ok: boolean }>(`/api/agent/coupons/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active }),
    }),

  deleteCoupon: (id: number) => apiRequest<{ ok: boolean }>(`/api/agent/coupons/${id}`, { method: 'DELETE' }),

  listHelp: () => apiRequest<{ items: AgentHelpItem[] }>('/api/agent/help'),

  createHelp: (payload: {
    category: string;
    title: string;
    title_en?: string;
    content: string;
    content_en?: string;
    sort_order?: number;
  }) =>
    apiRequest<{ ok: boolean; id: number }>('/api/agent/help', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateHelp: (
    id: number,
    payload: {
      category?: string;
      title?: string;
      title_en?: string;
      content?: string;
      content_en?: string;
      sort_order?: number;
      is_active?: boolean;
    }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/agent/help/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteHelp: (id: number) => apiRequest<{ ok: boolean }>(`/api/agent/help/${id}`, { method: 'DELETE' }),

  // Phase 3：分站私有商品与自有卡密库存
  listPrivateProducts: () =>
    apiRequest<{
      categories?: Array<{ id: number; name: string }>;
      items: AgentPrivateProductItem[];
    }>('/api/agent/private-products'),

  createPrivateProduct: (payload: Record<string, unknown>) =>
    apiRequest<{ ok: boolean; id: number; slug: string }>('/api/agent/private-products', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePrivateProduct: (id: number, payload: Record<string, unknown>) =>
    apiRequest<{ ok: boolean }>(`/api/agent/private-products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePrivateProduct: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/private-products/${id}`, { method: 'DELETE' }),

  listPrivateCards: (productId: number) =>
    apiRequest<{
      cards: Array<{
        id: number;
        spec_id: string;
        card_content: string;
        status: string;
        is_loop?: number;
        order_no: string | null;
        created_at: string;
      }>;
    }>(`/api/agent/private-products/${productId}/cards`),

  importPrivateCards: (
    productId: number,
    lines: string,
    spec_id = 'default',
    options?: { is_loop?: boolean; dedupe?: boolean }
  ) =>
    apiRequest<{ ok: boolean; imported: number; duplicates?: number }>(
      `/api/agent/private-products/${productId}/cards`,
      {
        method: 'POST',
        body: JSON.stringify({
          spec_id,
          lines,
          is_loop: options?.is_loop,
          dedupe: options?.dedupe,
        }),
      }
    ),

  deletePrivateCard: (cardId: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/private-cards/${cardId}`, { method: 'DELETE' }),

  // Phase 4：分站自有收款通道与待补款订单补发
  listOwnPaymentPlugins: () =>
    apiRequest<{
      plugins: Array<{
        id: string;
        name: string;
        description: string;
        enabled: number;
        config_json: string;
        secrets_configured: Record<string, boolean>;
        updated_at: string;
      }>;
    }>('/api/agent/payment-plugins'),

  updateOwnPaymentPlugin: (id: string, payload: { enabled?: boolean; config?: Record<string, unknown> }) =>
    apiRequest<{ ok: boolean }>(`/api/agent/payment-plugins/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  retryOrderFunding: (orderNo: string) =>
    apiRequest<{ ok: boolean; status: string }>(
      `/api/agent/orders/${encodeURIComponent(orderNo)}/retry-funding`,
      { method: 'POST' }
    ),

  listStoreOrders: (params: { q?: string; status?: string; page?: number; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.status && params.status !== 'all') sp.set('status', params.status);
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    return apiRequest<{
      total: number;
      page: number;
      limit: number;
      items: Array<{
        id: number;
        order_no: string;
        public_order_no: string | null;
        product_title: string;
        spec_name: string;
        quantity: number;
        total_amount: number;
        payment_fee_amount: number;
        commission_amount: number;
        contact_email: string;
        payment_method: string;
        settlement_mode: string;
        status: string;
        is_private_product: boolean;
        created_at: string;
      }>;
    }>(`/api/agent/orders?${sp.toString()}`);
  },

  listStoreMembers: (params: { q?: string; page?: number; limit?: number } = {}) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    return apiRequest<{
      total: number;
      page: number;
      limit: number;
      items: Array<{
        id: number;
        email: string;
        display_name: string;
        status: string;
        order_count: number;
        total_spent: number;
        created_at: string;
      }>;
    }>(`/api/agent/members?${sp.toString()}`);
  },
};
