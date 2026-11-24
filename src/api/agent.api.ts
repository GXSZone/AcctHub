/**
 * 代理分站工作台、分站定价与 B2B 批采联调领域 API 客户端
 */

import type {
  AgentInfo,
  AgentTierInfo,
  AgentWithdrawalRecord,
  Announcement,
  EmailDeliveryLogRow,
  OrderRecord,
  PaymentIntentInfo,
  SiteMailConfigPublic,
  SupportTicketRecord,
  TicketMessageRecord,
} from '../types';
import { apiRequest } from './http';

export interface AgentPricingSpecRow {
  spec_id: string;
  spec_name: string;
  main_price: number;
  cost_price: number;
  default_sell_price: number;
  custom_price: number | null;
  effective_sell_price: number;
  estimated_profit: number;
}

export interface AgentPricingProductRow {
  product_id: number;
  title: string;
  original_title: string;
  subtitle: string;
  original_subtitle: string;
  is_listed: boolean;
  has_content_override: boolean;
  override: {
    custom_title: string;
    custom_subtitle: string;
    custom_detail_markdown: string;
    custom_risk_notice: string;
  } | null;
  original_detail_markdown: string;
  original_risk_notice: string;
  specs: AgentPricingSpecRow[];
}

export interface AgentMeResponse {
  agent: AgentInfo | null;
  tier: AgentTierInfo | null;
  next_tier: AgentTierInfo | null;
  all_tiers: AgentTierInfo[];
  my_downline_tiers: AgentTierInfo[];
  total_recharged: number;
  balance: number;
  sub_agents: Array<{
    id: number;
    parent_agent_id: number | null;
    depth: number;
    slug: string;
    brand_name: string;
    primary_domain: string | null;
    status: string;
    tier_id: number | null;
    owner_email: string;
    total_recharged: number;
    tier_name: string | null;
    discount_rate: number | null;
    total_revenue: number;
    total_commission: number;
    sub_count: number;
    created_at: string;
  }>;
  direct_sub_count: number;
  total_downline_count: number;
  commission_ledger: Array<{
    id: number;
    order_no: string;
    hop_distance: number;
    reward_type: string;
    amount: number;
    note: string;
    source_slug: string | null;
    source_brand: string | null;
    created_at: string;
  }>;
  withdrawals: AgentWithdrawalRecord[];
  recharge_records: Array<{
    id: number;
    amount: number;
    payment_method: string;
    unlocked_tier_name: string;
    created_at: string;
  }>;
  recent_orders: Array<
    Pick<
      OrderRecord,
      | 'order_no'
      | 'public_order_no'
      | 'product_title'
      | 'contact_email'
      | 'quantity'
      | 'total_amount'
      | 'commission_amount'
      | 'status'
    > & { mail_status?: 'pending' | 'sent' | 'disabled' | 'failed' | null }
  >;
  withdrawal_fee_pct?: number;
  domain_config: {
    neutral_base_domain: string;
    saas_cname_target: string;
    cf_saas_enabled: boolean;
  };
}

export const agentApi = {
  getTiers: () =>
    apiRequest<{ owner_agent_id: number; site_brand: string | null; tiers: AgentTierInfo[] }>(
      '/api/agent/tiers'
    ),

  getMe: () => apiRequest<AgentMeResponse>('/api/agent/me'),

  recharge: (payload: {
    target_tier_id?: number;
    target_tier_code?: string;
    payment_method?: string;
    desired_slug?: string;
    desired_brand_name?: string;
  }) =>
    apiRequest<{
      ok: boolean;
      added?: number;
      balance?: number;
      total_recharged?: number;
      unlocked_tier?: AgentTierInfo | null;
      auto_created_agent?: boolean;
      agent?: AgentInfo | null;
      requires_payment?: boolean;
      payment_intent?: PaymentIntentInfo;
    }>('/api/agent/recharge', { method: 'POST', body: JSON.stringify(payload) }),

  checkSlug: (slug: string) =>
    apiRequest<{
      available: boolean;
      unchanged?: boolean;
      normalized: string;
      reason: string;
      suggestions: string[];
    }>(`/api/agent/check-slug?slug=${encodeURIComponent(slug)}`),

  updateBrand: (payload: {
    slug?: string;
    brand_name?: string;
    brand_tagline?: string;
    announcement_banner?: string;
    support_label?: string;
    support_url?: string;
    support_note?: string;
    support_media_json?: string;
    support_links_json?: string;
    markup_percent?: number;
    theme_accent?: string;
    favicon_url?: string;
    og_image_url?: string;
    seo_title?: string;
    seo_description?: string;
    footer_text?: string;
  }) =>
    apiRequest<{ ok: boolean; agent: AgentInfo; domain_message?: string }>('/api/agent/brand', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getNotices: () =>
    apiRequest<{
      settings: Record<string, string>;
      announcements: Announcement[];
      upstream_notices: Announcement[];
      upstream_popup: {
        enabled: boolean;
        title: string;
        content: string;
        frequency: string;
        version: string;
        source_name: string;
      };
    }>('/api/agent/notices'),

  updateNoticeSettings: (payload: Record<string, string>) =>
    apiRequest<{ ok: boolean }>('/api/agent/notices/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteDownlinePopupHistory: (historyId: string) =>
    apiRequest<{ ok: boolean; items: unknown[] }>(
      `/api/agent/notices/popup-history/${encodeURIComponent(historyId)}`,
      { method: 'DELETE' }
    ),

  createAnnouncement: (payload: {
    title: string;
    content: string;
    level: string;
    audience?: 'storefront' | 'direct_downlines';
    is_pinned: boolean;
  }) =>
    apiRequest<{ id: number; ok: boolean }>('/api/agent/announcements', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAnnouncement: (
    id: number,
    payload: {
      title?: string;
      content?: string;
      level?: string;
      audience?: 'storefront' | 'direct_downlines';
      is_pinned?: boolean;
    }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/agent/announcements/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteAnnouncement: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/announcements/${id}`, { method: 'DELETE' }),

  getMailConfig: () =>
    apiRequest<{ config: SiteMailConfigPublic; logs: EmailDeliveryLogRow[] }>('/api/agent/mail-config'),

  updateMailConfig: (payload: Record<string, unknown>) =>
    apiRequest<{ ok: boolean; config: SiteMailConfigPublic }>('/api/agent/mail-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  sendTestMail: (to_email: string) =>
    apiRequest<{ ok: boolean; provider?: string }>('/api/agent/mail-test', {
      method: 'POST',
      body: JSON.stringify({ to_email }),
    }),

  resendOrderEmail: (orderNo: string) =>
    apiRequest<{ ok: boolean; to: string; mail_status: 'pending' | 'sent' | 'disabled' | 'failed' }>(
      `/api/agent/orders/${encodeURIComponent(orderNo)}/resend-email`,
      {
        method: 'POST',
      }
    ),

  rotateKey: () => apiRequest<{ api_key: string }>('/api/agent/rotate-key', { method: 'POST' }),

  getPricing: () =>
    apiRequest<{
      tier_name: string;
      discount_rate: number;
      default_markup_percent: number;
      items: AgentPricingProductRow[];
    }>('/api/agent/pricing'),

  setCustomPrice: (payload: { product_id: number; spec_id: string; custom_price: number | null }) =>
    apiRequest<{ ok: boolean; custom_price?: number; cleared?: boolean }>('/api/agent/pricing', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  batchSetPricing: (payload: {
    mode: 'markup_cost_pct' | 'markup_main_pct' | 'markup_cost_fixed' | 'reset_all';
    value?: number;
    rounding?: 'none' | 'integer' | 'point9';
    scope?: 'all';
    targets?: Array<{ product_id: number; spec_id: string }>;
  }) =>
    apiRequest<{ ok: boolean; updated_count: number; cleared?: boolean }>('/api/agent/pricing/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProductOverride: (
    productId: number,
    payload: {
      is_listed?: boolean;
      custom_title?: string | null;
      custom_subtitle?: string | null;
      custom_detail_markdown?: string | null;
      custom_risk_notice?: string | null;
    }
  ) =>
    apiRequest<{ ok: boolean; is_listed: boolean }>(`/api/agent/products/${productId}/override`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  resetProductOverride: (productId: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/products/${productId}/override`, { method: 'DELETE' }),

  createDownlineTier: (payload: {
    code?: string;
    name: string;
    level_rank?: number;
    min_recharge: number;
    discount_rate: number;
    badge_color?: string;
    perks?: string[];
  }) =>
    apiRequest<{ ok: boolean; id: number }>('/api/agent/my-tiers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDownlineTier: (
    id: number,
    payload: {
      name?: string;
      level_rank?: number;
      min_recharge?: number;
      discount_rate?: number;
      badge_color?: string;
      perks?: string[];
    }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/agent/my-tiers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteDownlineTier: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/agent/my-tiers/${id}`, { method: 'DELETE' }),

  updateDirectDownline: (
    downlineId: number,
    payload: { tier_id?: number; status?: 'active' | 'suspended' }
  ) =>
    apiRequest<{ ok: boolean }>(`/api/agent/downlines/${downlineId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  createWithdrawal: (payload: {
    amount: number;
    channel: 'alipay' | 'wechat' | 'usdt_trc20';
    account_info: string;
    account_name?: string;
  }) =>
    apiRequest<{ ok: boolean; id: number; balance: number }>('/api/agent/withdrawals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listTickets: () => apiRequest<{ tickets: SupportTicketRecord[] }>('/api/agent/tickets'),

  getTicket: (id: number) =>
    apiRequest<{ ticket: SupportTicketRecord; messages: TicketMessageRecord[] }>(`/api/agent/tickets/${id}`),

  replyTicket: (id: number, content: string, mark_resolved = false) =>
    apiRequest<{ ok: boolean; status: string }>(`/api/agent/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content, mark_resolved }),
    }),

  escalateTicket: (id: number, note?: string) =>
    apiRequest<{ ok: boolean; status: string }>(`/api/agent/tickets/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  updateIpWhitelist: (ip_whitelist: string) =>
    apiRequest<{ ok: boolean; api_ip_whitelist: string; count: number }>('/api/agent/api-whitelist', {
      method: 'PUT',
      body: JSON.stringify({ ip_whitelist }),
    }),

  getAffiliateConfig: () =>
    apiRequest<{
      enabled: boolean;
      commission_rate: number;
      min_order_amount: number;
      max_reward: number;
    }>('/api/agent/affiliate-config'),

  updateAffiliateConfig: (payload: {
    enabled: boolean;
    commission_rate: number;
    min_order_amount: number;
    max_reward: number;
  }) =>
    apiRequest<{
      ok: boolean;
      enabled: boolean;
      commission_rate: number;
      min_order_amount: number;
      max_reward: number;
    }>('/api/agent/affiliate-config', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  testResellerApi: async (apiKey: string, endpoint: '/balance' | '/products') => {
    const res = await fetch(`/api/v1/reseller${endpoint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
    return data;
  },
};
