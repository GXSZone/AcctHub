/**
 * 运营总控后台：会员管理与全店非商品资金流水薄 API 客户端
 */

import type {
  AdminCashflowsResponse,
  AdminMembersResponse,
  AdminMemberTransactionsResponse,
} from './admin.types';
import { apiRequest } from './http';

export const adminMembersApi = {
  financeCashflows: () =>
    apiRequest<AdminCashflowsResponse>('/api/admin/finance/cashflows', {}, { admin: true }),

  listMembers: (params?: {
    q?: string;
    role?: 'all' | 'user' | 'agent' | 'admin';
    status?: 'all' | 'active' | 'frozen' | 'blacklisted';
    page?: number;
    page_size?: number;
  }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.role) sp.set('role', params.role);
    if (params?.status) sp.set('status', params.status);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.page_size) sp.set('page_size', String(params.page_size));
    const qs = sp.size ? `?${sp.toString()}` : '';
    return apiRequest<AdminMembersResponse>(`/api/admin/members${qs}`, {}, { admin: true });
  },

  listMemberTransactions: (userId: number) =>
    apiRequest<AdminMemberTransactionsResponse>(
      `/api/admin/members/${userId}/transactions`,
      {},
      { admin: true }
    ),

  adjustMemberBalance: (userId: number, payload: { amount: number; reason: string }) =>
    apiRequest<{ ok: boolean; ref_no: string; balance: number }>(
      `/api/admin/members/${userId}/adjust-balance`,
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  revokeMemberSessions: (userId: number) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/members/${userId}/revoke-sessions`,
      { method: 'POST' },
      { admin: true }
    ),

  updateMemberStatus: (
    userId: number,
    payload: { status: 'active' | 'frozen' | 'blacklisted'; reason?: string }
  ) =>
    apiRequest<{ ok: boolean; status: string }>(
      `/api/admin/members/${userId}/status`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteMember: (userId: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/members/${userId}`, { method: 'DELETE' }, { admin: true }),
};
