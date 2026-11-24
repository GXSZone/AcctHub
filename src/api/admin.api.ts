/**
 * 运营总控后台与财务对账领域 API 客户端
 */

import type { AdminAuditLogsQuery } from '@shared/index';
import type {
  EmailDeliveryLogRow,
  SiteMailConfigPublic,
  SupportTicketRecord,
  TicketMessageRecord,
} from '../types';
import type {
  AdminAuditLogRow,
  AdminCashflowsResponse,
  AdminMembersResponse,
  AdminMemberTransactionsResponse,
  FinanceReconciliationResponse,
} from './admin.types';
import { adminMembersApi } from './admin-members.api';
import { apiDownloadBlob, apiRequest } from './http';

export type {
  AdminAuditLogRow,
  AdminCashflowsResponse,
  AdminMembersResponse,
  AdminMemberTransactionsResponse,
  FinanceReconciliationResponse,
};

type AuditFilters = Partial<Pick<AdminAuditLogsQuery, 'action' | 'target_type' | 'q' | 'days'>>;

type AgentTierLossPreview = {
  loss_confirmation: string | null;
  safe_min_discount: number;
  loss_items: Array<{
    product_title: string;
    spec_name: string;
    sell_price: number;
    cost_price: number;
    min_agent_price: number;
    loss_amount: number;
  }>;
};

function auditQueryString(filters?: AuditFilters): string {
  const sp = new URLSearchParams();
  if (filters?.action) sp.set('action', filters.action);
  if (filters?.target_type) sp.set('target_type', filters.target_type);
  if (filters?.q) sp.set('q', filters.q);
  if (filters?.days) sp.set('days', String(filters.days));
  return sp.size ? `?${sp.toString()}` : '';
}

export const adminApi = {
  overview: (signal?: AbortSignal) =>
    apiRequest<Record<string, unknown>>('/api/admin/overview', { signal }, { admin: true }),

  ...adminMembersApi,

  financeReconciliation: (days = 30) =>
    apiRequest<FinanceReconciliationResponse>(
      `/api/admin/finance/reconciliation?days=${days}`,
      {},
      { admin: true }
    ),

  downloadFinanceCsv: (days = 30) =>
    apiDownloadBlob(`/api/admin/finance/reconciliation/csv?days=${days}`, { admin: true }),

  updateSettings: (settings: Record<string, string>) =>
    apiRequest('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) }, { admin: true }),

  deleteDownlinePopupHistory: (historyId: string) =>
    apiRequest<{ ok: boolean; items: unknown[] }>(
      `/api/admin/downline-popup-history/${encodeURIComponent(historyId)}`,
      { method: 'DELETE' },
      { admin: true }
    ),

  updateSaasConfig: (payload: {
    neutral_base_domain?: string;
    saas_cname_target?: string;
    cf_saas_zone_id?: string;
    cf_saas_api_token?: string;
    clear_cf_token?: boolean;
    agent_signup_platform_fee_pct?: number;
    agent_withdrawal_fee_pct?: number;
  }) =>
    apiRequest<{ ok: boolean }>(
      '/api/admin/saas-config',
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  reviewWithdrawal: (withdrawalId: number, payload: { action: 'paid' | 'rejected'; admin_note?: string }) =>
    apiRequest<{ ok: boolean; status: string }>(
      `/api/admin/withdrawals/${withdrawalId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  createCoupon: (payload: {
    code?: string;
    name: string;
    discount_type: 'fixed' | 'percent';
    discount_value: number;
    min_order_amount: number;
    max_uses: number;
    expires_at?: string;
  }) =>
    apiRequest<{ ok: boolean; id: number; code: string }>(
      '/api/admin/coupons',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  toggleCoupon: (id: number, is_active: number) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/coupons/${id}`,
      { method: 'PUT', body: JSON.stringify({ is_active }) },
      { admin: true }
    ),

  deleteCoupon: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/coupons/${id}`, { method: 'DELETE' }, { admin: true }),

  generateCdks: (payload: { amount: number; count: number; batch_note?: string; prefix?: string }) =>
    apiRequest<{ ok: boolean; generated: string[]; count: number }>(
      '/api/admin/cdks/generate',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteCdk: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/cdks/${id}`, { method: 'DELETE' }, { admin: true }),

  getTicket: (id: number) =>
    apiRequest<{
      ticket: SupportTicketRecord;
      messages: TicketMessageRecord[];
      replacementMailStatus: string | null;
    }>(`/api/admin/tickets/${id}`, {}, { admin: true }),

  replyTicket: (
    id: number,
    content: string,
    status: 'admin_replied' | 'resolved' | 'closed' = 'admin_replied'
  ) =>
    apiRequest<{ ok: boolean; status: string }>(
      `/api/admin/tickets/${id}/reply`,
      { method: 'POST', body: JSON.stringify({ content, status }) },
      { admin: true }
    ),

  updateTicketStatus: (id: number, status: string) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/tickets/${id}/status`,
      { method: 'PUT', body: JSON.stringify({ status }) },
      { admin: true }
    ),

  updateNotifyConfig: (payload: {
    tg_bot_token?: string;
    clear_tg_token?: boolean;
    tg_chat_id?: string;
    webhook_url?: string;
    events?: string[];
    low_stock_threshold?: number;
  }) =>
    apiRequest<{ ok: boolean }>(
      '/api/admin/notify-config',
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  testNotify: () =>
    apiRequest<{ ok: boolean; sentTelegram: boolean; sentWebhook: boolean }>(
      '/api/admin/notify-test',
      { method: 'POST' },
      { admin: true }
    ),

  createGroup: (payload: { slug: string; name: string; name_en: string; sort_order: number }) =>
    apiRequest('/api/admin/groups', { method: 'POST', body: JSON.stringify(payload) }, { admin: true }),

  updateGroup: (
    id: number,
    payload: { name?: string; name_en?: string; sort_order?: number; is_active?: number }
  ) =>
    apiRequest(`/api/admin/groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, { admin: true }),

  reorderGroups: (ordered_ids: number[]) =>
    apiRequest<{ ok: boolean }>(
      '/api/admin/groups/reorder',
      { method: 'PUT', body: JSON.stringify({ ordered_ids }) },
      { admin: true }
    ),

  deleteGroup: (id: number) => apiRequest(`/api/admin/groups/${id}`, { method: 'DELETE' }, { admin: true }),

  createCategory: (payload: {
    group_id: number;
    slug: string;
    name: string;
    name_en: string;
    icon: string;
    badge_text: string;
    schema_type: string;
    sort_order: number;
  }) =>
    apiRequest('/api/admin/categories', { method: 'POST', body: JSON.stringify(payload) }, { admin: true }),

  updateCategory: (
    id: number,
    payload: {
      group_id?: number;
      name?: string;
      name_en?: string;
      icon?: string;
      badge_text?: string;
      sort_order?: number;
    }
  ) =>
    apiRequest(
      `/api/admin/categories/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  reorderCategories: (ordered_ids: number[]) =>
    apiRequest<{ ok: boolean }>(
      '/api/admin/categories/reorder',
      { method: 'PUT', body: JSON.stringify({ ordered_ids }) },
      { admin: true }
    ),

  deleteCategory: (id: number) =>
    apiRequest(`/api/admin/categories/${id}`, { method: 'DELETE' }, { admin: true }),

  createProduct: (payload: Record<string, unknown>) =>
    apiRequest<{ id: number; ok: boolean }>(
      '/api/admin/products',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  updateProduct: (id: number, payload: Record<string, unknown>) =>
    apiRequest(
      `/api/admin/products/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteProduct: (id: number) =>
    apiRequest(`/api/admin/products/${id}`, { method: 'DELETE' }, { admin: true }),

  listCards: (productId: number) =>
    apiRequest<{
      cards: Array<{
        id: number;
        product_id: number;
        spec_id: string;
        card_content: string;
        status: string;
        is_loop?: number;
        order_no: string | null;
        created_at: string;
        sold_at: string | null;
      }>;
    }>(`/api/admin/products/${productId}/cards`, {}, { admin: true }),

  deleteCard: (cardId: number) =>
    apiRequest(`/api/admin/cards/${cardId}`, { method: 'DELETE' }, { admin: true }),

  importCards: (
    productId: number,
    specId: string,
    lines: string,
    options?: { is_loop?: boolean; dedupe?: boolean }
  ) =>
    apiRequest<{ imported: number; duplicates: number; rejected_samples: number }>(
      `/api/admin/products/${productId}/cards`,
      {
        method: 'POST',
        body: JSON.stringify({
          spec_id: specId,
          lines,
          is_loop: options?.is_loop,
          dedupe: options?.dedupe,
        }),
      },
      { admin: true }
    ),

  createAnnouncement: (payload: {
    title: string;
    content: string;
    level: string;
    audience?: 'storefront' | 'direct_downlines';
    is_pinned: boolean;
  }) =>
    apiRequest(
      '/api/admin/announcements',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

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
    apiRequest(
      `/api/admin/announcements/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteAnnouncement: (id: number) =>
    apiRequest(`/api/admin/announcements/${id}`, { method: 'DELETE' }, { admin: true }),

  createHelp: (payload: { category: string; title: string; content: string; sort_order?: number }) =>
    apiRequest('/api/admin/help', { method: 'POST', body: JSON.stringify(payload) }, { admin: true }),

  updateHelp: (
    id: number,
    payload: { category?: string; title?: string; content?: string; sort_order?: number }
  ) => apiRequest(`/api/admin/help/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, { admin: true }),

  deleteHelp: (id: number) => apiRequest(`/api/admin/help/${id}`, { method: 'DELETE' }, { admin: true }),

  updateAgent: (
    id: number,
    payload: {
      status?: string;
      commission_rate?: number;
      markup_percent?: number;
      tier_id?: number;
      allow_private_products_override?: number | null;
      allow_own_payment_override?: number | null;
    }
  ) =>
    apiRequest(`/api/admin/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) }, { admin: true }),

  createAgentTier: (payload: {
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
    allow_custom_domain?: boolean;
    max_custom_domains?: number;
    allow_private_products?: boolean;
    allow_own_payment?: boolean;
    loss_confirmation?: string;
  }) =>
    apiRequest('/api/admin/agent-tiers', { method: 'POST', body: JSON.stringify(payload) }, { admin: true }),

  previewNewAgentTierLoss: (code: string, discountRate: number) =>
    apiRequest<AgentTierLossPreview>(
      `/api/admin/agent-tiers/loss-preview?${new URLSearchParams({ code, discount_rate: String(discountRate) })}`,
      {},
      { admin: true }
    ),

  updateAgentTier: (
    id: number,
    payload: {
      name?: string;
      level_rank?: number;
      min_recharge?: number;
      discount_rate?: number;
      commission_rate?: number;
      sub_override_rate?: number;
      max_sub_agents?: number;
      badge_color?: string;
      allow_custom_domain?: boolean;
      max_custom_domains?: number;
      allow_private_products?: boolean;
      allow_own_payment?: boolean;
      loss_confirmation?: string;
    }
  ) =>
    apiRequest(
      `/api/admin/agent-tiers/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),
  previewAgentTierLoss: (id: number, discountRate: number) =>
    apiRequest<AgentTierLossPreview>(
      `/api/admin/agent-tiers/${id}/loss-preview?discount_rate=${encodeURIComponent(discountRate)}`,
      {},
      { admin: true }
    ),

  deleteAgentTier: (id: number) =>
    apiRequest(`/api/admin/agent-tiers/${id}`, { method: 'DELETE' }, { admin: true }),

  updatePaymentPlugin: (id: string, payload: { enabled?: boolean; config?: Record<string, string> }) =>
    apiRequest(
      `/api/admin/payment-plugins/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  getMailConfig: () =>
    apiRequest<{ config: SiteMailConfigPublic; logs: EmailDeliveryLogRow[] }>(
      '/api/admin/mail-config',
      {},
      { admin: true }
    ),

  updateMailConfig: (payload: Record<string, unknown>) =>
    apiRequest<{ ok: boolean; config: SiteMailConfigPublic }>(
      '/api/admin/mail-config',
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  sendTestMail: (to_email: string) =>
    apiRequest<{ ok: boolean; provider?: string }>(
      '/api/admin/mail-test',
      { method: 'POST', body: JSON.stringify({ to_email }) },
      { admin: true }
    ),

  resendOrderEmail: (orderNo: string) =>
    apiRequest<{ ok: boolean; to: string; mail_status: 'pending' | 'sent' | 'disabled' | 'failed' }>(
      `/api/admin/orders/${encodeURIComponent(orderNo)}/resend-email`,
      { method: 'POST' },
      { admin: true }
    ),

  auditLogs: (filters?: AuditFilters) =>
    apiRequest<{ logs: AdminAuditLogRow[] }>(
      `/api/admin/audit-logs${auditQueryString(filters)}`,
      {},
      { admin: true }
    ),

  downloadAuditLogsCsv: (filters?: AuditFilters) =>
    apiDownloadBlob(`/api/admin/audit-logs/csv${auditQueryString(filters)}`, { admin: true }),

  syncPaymentFx: () =>
    apiRequest<{
      ok: boolean;
      snapshot: { usd_cny: number; usdt_cny: number; updated_at: string; source: string };
      guardMessage?: string;
    }>('/api/admin/payment-plugins/sync-fx', { method: 'POST' }, { admin: true }),
};
