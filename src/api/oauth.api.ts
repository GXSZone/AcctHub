import type {
  AdminOAuthProviderConfigDto,
  OAuthBindingItemDto,
  OAuthProvider,
  PublicOAuthProviderDto,
} from '@shared/contracts/oauth.contract';
import type { UserProfile } from '../types';
import { apiRequest } from './http';

export interface SiteOAuthConfigPayload {
  callback_base_url: string;
  providers: AdminOAuthProviderConfigDto[];
}

export interface SiteOAuthConfigUpdatePayload {
  callback_base_url?: string;
  providers: Partial<
    Record<
      OAuthProvider,
      {
        enabled: boolean;
        client_id?: string;
        client_secret?: string;
        clear_secret?: boolean;
      }
    >
  >;
}

export interface OAuthExchangeResponse {
  ok: boolean;
  token: string;
  action: 'login' | 'bind';
  provider: OAuthProvider;
  redirect_path: string;
  user: UserProfile;
}

export const oauthApi = {
  listPublicProviders: () => apiRequest<{ providers: PublicOAuthProviderDto[] }>('/api/auth/oauth/providers'),

  startAuthorize: (input: {
    provider: OAuthProvider;
    mode?: 'login' | 'bind';
    redirect_path?: string;
    referral_code?: string;
  }) =>
    apiRequest<{ ok: boolean; authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  exchangeTicket: (ticket: string) =>
    apiRequest<OAuthExchangeResponse>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    }),

  listMyBindings: () => apiRequest<{ bindings: OAuthBindingItemDto[] }>('/api/auth/oauth/bindings'),

  unbindMyProvider: (provider: OAuthProvider) =>
    apiRequest<{ ok: boolean }>(`/api/auth/oauth/bindings/${provider}`, {
      method: 'DELETE',
    }),

  getSiteConfig: (mode: 'admin' | 'agent') =>
    apiRequest<SiteOAuthConfigPayload>(
      mode === 'admin' ? '/api/admin/oauth/config' : '/api/agent/oauth/config',
      {},
      { admin: mode === 'admin' }
    ),

  updateSiteConfig: (mode: 'admin' | 'agent', payload: SiteOAuthConfigUpdatePayload) =>
    apiRequest<SiteOAuthConfigPayload>(
      mode === 'admin' ? '/api/admin/oauth/config' : '/api/agent/oauth/config',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      { admin: mode === 'admin' }
    ),
};
