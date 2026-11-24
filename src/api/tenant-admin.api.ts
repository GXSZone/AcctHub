/**
 * 总控 SaaS 全局策略与分站多域名授权治理 API 客户端
 */

import type { GlobalSaasPolicy, TenantDomainItem } from '../types';
import { apiRequest } from './http';

export interface AdminTenantDomainRow extends TenantDomainItem {
  agent_status?: string | null;
}

export const tenantAdminApi = {
  getSaasPolicy: () => apiRequest<GlobalSaasPolicy>('/api/admin/saas-policy', {}, { admin: true }),

  updateSaasPolicy: (payload: Partial<GlobalSaasPolicy>) =>
    apiRequest<{ ok: boolean } & GlobalSaasPolicy>(
      '/api/admin/saas-policy',
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  listDomains: (status?: string) =>
    apiRequest<{ items: AdminTenantDomainRow[] }>(
      `/api/admin/domains${status ? `?status=${encodeURIComponent(status)}` : ''}`,
      {},
      { admin: true }
    ),

  authorizeDomain: (
    id: number,
    payload: {
      action: 'approve' | 'revoke' | 'sync' | 'set_expiry';
      expires_at?: string | null;
      note?: string;
    }
  ) =>
    apiRequest<{ ok: boolean; status: string; message?: string }>(
      `/api/admin/domains/${id}/authorize`,
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),
};
