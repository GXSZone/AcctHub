import type {
  BusinessWebhookEvent,
  OutboundWebhookDto,
  SelectableCardPublicDto,
} from '@shared/contracts/extensions.contract';
import { apiRequest } from './http';

export const extensionsApi = {
  listSelectableCards: (productIdOrSlug: string, specId?: string) => {
    const qs = specId ? `?spec_id=${encodeURIComponent(specId)}` : '';
    return apiRequest<{
      allow_card_selection: boolean;
      default_select_fee: number;
      cards: SelectableCardPublicDto[];
    }>(`/api/storefront/products/${encodeURIComponent(productIdOrSlug)}/selectable-cards${qs}`);
  },

  // 管理员 2FA
  getAdmin2FaStatus: () =>
    apiRequest<{ enabled: boolean; email: string }>('/api/admin/2fa/status', {}, { admin: true }),
  setupAdmin2Fa: () =>
    apiRequest<{ secret: string; otpauth_url: string; already_enabled: boolean }>(
      '/api/admin/2fa/setup',
      { method: 'POST' },
      { admin: true }
    ),
  enableAdmin2Fa: (secret: string, code: string) =>
    apiRequest<{ ok: boolean; enabled: boolean }>(
      '/api/admin/2fa/enable',
      { method: 'POST', body: JSON.stringify({ secret, code }) },
      { admin: true }
    ),
  disableAdmin2Fa: (code: string) =>
    apiRequest<{ ok: boolean; enabled: boolean }>(
      '/api/admin/2fa/disable',
      { method: 'POST', body: JSON.stringify({ code }) },
      { admin: true }
    ),

  // 业务出站 Webhook
  listWebhooks: () =>
    apiRequest<{ webhooks: OutboundWebhookDto[] }>('/api/admin/webhooks', {}, { admin: true }),
  createWebhook: (payload: {
    name: string;
    url: string;
    secret?: string;
    events: BusinessWebhookEvent[];
    enabled?: boolean;
    allow_fulfill_override?: boolean;
  }) =>
    apiRequest<{ ok: boolean; webhook: OutboundWebhookDto }>(
      '/api/admin/webhooks',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),
  deleteWebhook: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/webhooks/${id}`, { method: 'DELETE' }, { admin: true }),
  testWebhook: (id: number) =>
    apiRequest<{ ok: boolean; status: number; error: string }>(
      `/api/admin/webhooks/${id}/test`,
      { method: 'POST' },
      { admin: true }
    ),
};
