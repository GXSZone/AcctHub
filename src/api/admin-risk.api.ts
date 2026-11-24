/**
 * 安全风控、订单高级检索/审核/人工补单、卡密反查/导出与管理员代重置密码 API 客户端
 */

import type { IpBlacklistItemDto, RiskControlConfig, RiskEmergencyMode, RiskEventDto } from '@shared/index';
import { apiDownloadBlob, apiRequest } from './http';

export interface AdminRiskOverviewResponse {
  config: RiskControlConfig;
  live_metrics: {
    cards_5m: number;
    cards_1h: number;
    upstream_spend_today: number;
    risk_review_orders: number;
  };
  ip_blacklist: IpBlacklistItemDto[];
  events: RiskEventDto[];
}

export interface AdminOrderSearchItem {
  id: number;
  order_no: string;
  public_order_no: string | null;
  product_id: number;
  product_title: string;
  spec_id: string;
  spec_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  payment_fee_amount: number;
  discount_amount: number;
  promo_used_amount: number;
  commission_amount: number;
  contact_email: string;
  buyer_ip: string;
  payment_method: string;
  channel: string;
  status: string;
  risk_flag: string;
  risk_note: string;
  fulfillment_source: string;
  upstream_error: string;
  agent_id: number | null;
  tenant_slug: string | null;
  created_at: string;
}

export interface AdminOrderDetailResponse {
  order: AdminOrderSearchItem & {
    user_id: number | null;
    product_owner_agent_id: number;
    coupon_code: string | null;
    coupon_discount: number;
    settlement_mode: string;
    upstream_order_no: string;
    upstream_cost_total: number;
    upstream_status: string;
    custom_inputs: Record<string, string>;
    delivered_payload: string;
    warranty_type: string;
    warranty_days: number;
    warranty_summary: string;
  };
  payment_intent: {
    intent_no: string;
    provider: string;
    currency: string;
    amount_cny: number;
    pay_amount: number;
    status: string;
    fulfill_status: string;
    provider_trade_no: string;
    paid_at: string | null;
    created_at: string;
  } | null;
}

export interface CardLookupMatch {
  card_id: number;
  product_id: number;
  product_title: string;
  spec_id: string;
  status: string;
  is_loop: number;
  order_no: string | null;
  sold_at: string | null;
  card_content: string;
  contact_email?: string;
  buyer_ip?: string;
  order_status?: string;
}

export const adminRiskApi = {
  getRiskOverview: () =>
    apiRequest<AdminRiskOverviewResponse>('/api/admin/risk/overview', {}, { admin: true }),

  updateRiskConfig: (cfg: RiskControlConfig) =>
    apiRequest<{ ok: boolean; config: RiskControlConfig }>(
      '/api/admin/risk/config',
      { method: 'PUT', body: JSON.stringify(cfg) },
      { admin: true }
    ),

  switchEmergencyMode: (emergency_mode: RiskEmergencyMode, reason = '') =>
    apiRequest<{ ok: boolean; emergency_mode: RiskEmergencyMode }>(
      '/api/admin/risk/emergency',
      { method: 'POST', body: JSON.stringify({ emergency_mode, reason }) },
      { admin: true }
    ),

  sendTestAlert: () =>
    apiRequest<{ ok: boolean; mail_sent_count: number; event_id: number }>(
      '/api/admin/risk/test-alert',
      { method: 'POST' },
      { admin: true }
    ),

  addIpBlacklist: (ip_pattern: string, reason = '') =>
    apiRequest<{ ok: boolean; item: IpBlacklistItemDto }>(
      '/api/admin/risk/ip-blacklist',
      { method: 'POST', body: JSON.stringify({ ip_pattern, reason }) },
      { admin: true }
    ),

  deleteIpBlacklist: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/risk/ip-blacklist/${id}`, { method: 'DELETE' }, { admin: true }),

  searchOrders: (params: {
    q?: string;
    status?: string;
    payment_method?: string;
    page?: number;
    page_size?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params.q) sp.set('q', params.q);
    if (params.status && params.status !== 'all') sp.set('status', params.status);
    if (params.payment_method && params.payment_method !== 'all')
      sp.set('payment_method', params.payment_method);
    if (params.page) sp.set('page', String(params.page));
    if (params.page_size) sp.set('page_size', String(params.page_size));
    return apiRequest<{
      total: number;
      page: number;
      page_size: number;
      items: AdminOrderSearchItem[];
    }>(`/api/admin/orders/search?${sp.toString()}`, {}, { admin: true });
  },

  getOrderDetail: (orderNo: string) =>
    apiRequest<AdminOrderDetailResponse>(
      `/api/admin/orders/${encodeURIComponent(orderNo)}/detail`,
      {},
      { admin: true }
    ),

  approveRiskOrder: (orderNo: string, note = '') =>
    apiRequest<{ ok: boolean; status: string; delivered_payload: string }>(
      `/api/admin/orders/${encodeURIComponent(orderNo)}/approve-risk`,
      { method: 'POST', body: JSON.stringify({ note }) },
      { admin: true }
    ),

  manualConfirmOrder: (orderNo: string, manual_payload = '', note = '') =>
    apiRequest<{ ok: boolean; status: string; delivered_payload: string }>(
      `/api/admin/orders/${encodeURIComponent(orderNo)}/manual-confirm`,
      { method: 'POST', body: JSON.stringify({ manual_payload, note }) },
      { admin: true }
    ),

  lookupCards: (q: string) =>
    apiRequest<{ matches: CardLookupMatch[] }>(
      `/api/admin/cards/lookup?q=${encodeURIComponent(q)}`,
      {},
      { admin: true }
    ),

  exportCardsTxt: (productId: number, specId?: string) => {
    const qs = specId ? `?spec_id=${encodeURIComponent(specId)}` : '';
    return apiDownloadBlob(`/api/admin/products/${productId}/cards/export${qs}`, { admin: true });
  },

  resetMemberPassword: (userId: number, new_password: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/members/${userId}/password`,
      { method: 'PUT', body: JSON.stringify({ new_password }) },
      { admin: true }
    ),
};
