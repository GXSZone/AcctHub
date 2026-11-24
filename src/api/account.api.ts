/**
 * 会员中心（钱包、订单、CDK、工单、安全、2FA 保险箱）API 客户端
 */

import type { AccountAffiliateQuery, AccountRechargeIntentInput } from '@shared/contracts/account.contract';
import type { BatchTotpVaultInput, CreateTotpVaultInput } from '@shared/index';
import type {
  OrderRecord,
  PaymentIntentInfo,
  SupportTicketRecord,
  TicketMessageRecord,
  TotpVaultItem,
  WalletTransactionRecord,
} from '../types';
import { apiRequest } from './http';

export interface AccountSummaryResponse {
  balance: number;
  monthly_spend: number;
  total_orders: number;
  open_tickets: number;
  totp_count: number;
  recent_orders: OrderRecord[];
  recent_transactions: WalletTransactionRecord[];
}

export interface AccountSecurityResponse {
  email: string;
  display_name: string;
  role: string;
  login_logs: Array<{ id: number; ip: string; user_agent: string; created_at: string }>;
}

export interface AccountAffiliateResponse {
  available_on_site: boolean;
  affiliate_enabled: boolean;
  commission_rate: number;
  min_order_amount: number;
  max_reward?: number;
  referral_code: string | null;
  referral_path: string | null;
  promo_balance: number;
  referred_count: number;
  settled_reward_total: number;
  ledger_next_before_id: number | null;
  promo_next_before_id: number | null;
  ledgers: Array<{
    id: number;
    order_no: string;
    order_amount: number;
    commission_rate: number;
    reward_amount: number;
    clawed_back_amount: number;
    status: string;
    created_at: string;
  }>;
  promo_transactions: Array<{
    id: number;
    type: string;
    amount: number;
    balance_after: number;
    ref_no: string;
    note: string;
    created_at: string;
  }>;
}

export const accountApi = {
  summary: () => apiRequest<AccountSummaryResponse>('/api/account/summary'),
  affiliate: (page: AccountAffiliateQuery) => {
    const cursor = new URLSearchParams();
    if (page.ledger_before_id !== undefined) cursor.set('ledger_before_id', String(page.ledger_before_id));
    if (page.promo_before_id !== undefined) cursor.set('promo_before_id', String(page.promo_before_id));
    return apiRequest<AccountAffiliateResponse>(`/api/account/affiliate${cursor.size ? `?${cursor}` : ''}`);
  },
  orders: (cursor?: number) =>
    apiRequest<{ orders: OrderRecord[]; next_cursor: number | null }>(
      cursor ? `/api/account/orders?cursor=${encodeURIComponent(cursor)}` : '/api/account/orders'
    ),
  transactions: (type?: string) =>
    apiRequest<{ balance: number; transactions: WalletTransactionRecord[] }>(
      `/api/account/transactions${type ? `?type=${encodeURIComponent(type)}` : ''}`
    ),
  createRechargeIntent: (input: AccountRechargeIntentInput) =>
    apiRequest<{ ok: boolean; requires_payment: boolean; payment_intent: PaymentIntentInfo }>(
      '/api/account/recharge/intent',
      { method: 'POST', body: JSON.stringify(input) }
    ),
  redeemCdk: (code: string, turnstile_token?: string) =>
    apiRequest<{ ok: boolean; code: string; added: number; balance: number }>('/api/account/redeem-cdk', {
      method: 'POST',
      body: JSON.stringify({ code, turnstile_token }),
    }),
  listTickets: () => apiRequest<{ tickets: SupportTicketRecord[] }>('/api/account/tickets'),
  createTicket: (payload: { order_no?: string; category?: string; subject: string; content: string }) =>
    apiRequest<{ ok: boolean; id: number; ticket_no: string }>('/api/account/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTicket: (id: number) =>
    apiRequest<{ ticket: SupportTicketRecord; messages: TicketMessageRecord[] }>(
      `/api/account/tickets/${id}`
    ),
  replyTicket: (id: number, content: string) =>
    apiRequest<{ ok: boolean }>(`/api/account/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  closeTicket: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/account/tickets/${id}/close`, { method: 'POST' }),
  security: () => apiRequest<AccountSecurityResponse>('/api/account/security'),
  updateProfile: (display_name: string) =>
    apiRequest<{ ok: boolean; display_name: string }>('/api/account/profile', {
      method: 'PUT',
      body: JSON.stringify({ display_name }),
    }),
  updatePassword: (current_password: string, new_password: string) =>
    apiRequest<{ ok: boolean }>('/api/account/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password, new_password }),
    }),
  totpVaultList: (signal?: AbortSignal) =>
    apiRequest<{ items: TotpVaultItem[] }>('/api/account/totp-vault', { signal }),
  totpVaultAdd: (payload: CreateTotpVaultInput) =>
    apiRequest<{ ok: boolean; item: TotpVaultItem }>('/api/account/totp-vault', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  totpVaultBatch: (items: BatchTotpVaultInput['items']) =>
    apiRequest<{ ok: boolean; imported: number }>('/api/account/totp-vault/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  totpVaultDelete: (id: string) =>
    apiRequest<{ ok: boolean }>(`/api/account/totp-vault/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
