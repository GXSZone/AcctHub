import type { OAuthProvider } from '@shared/contracts/oauth.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentHostScope } from '../api/http';
import { oauthApi, type SiteOAuthConfigUpdatePayload } from '../api/oauth.api';

export const oauthQueryKeys = {
  publicProviders: () => ['oauth', 'public-providers', getCurrentHostScope()] as const,
  myBindings: () => ['oauth', 'my-bindings', getCurrentHostScope()] as const,
  siteConfig: (mode: 'admin' | 'agent') => ['oauth', 'site-config', mode, getCurrentHostScope()] as const,
};

export function usePublicOAuthProvidersQuery(enabled = true) {
  return useQuery({
    queryKey: oauthQueryKeys.publicProviders(),
    queryFn: () => oauthApi.listPublicProviders(),
    enabled,
    staleTime: 60_000,
  });
}

export function useMyOAuthBindingsQuery(enabled = true) {
  return useQuery({
    queryKey: oauthQueryKeys.myBindings(),
    queryFn: () => oauthApi.listMyBindings(),
    enabled,
  });
}

export function useUnbindOAuthMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: OAuthProvider) => oauthApi.unbindMyProvider(provider),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: oauthQueryKeys.myBindings() });
    },
  });
}

export function useSiteOAuthConfigQuery(mode: 'admin' | 'agent') {
  return useQuery({
    queryKey: oauthQueryKeys.siteConfig(mode),
    queryFn: () => oauthApi.getSiteConfig(mode),
  });
}

export function useSaveSiteOAuthConfigMutation(mode: 'admin' | 'agent') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SiteOAuthConfigUpdatePayload) => oauthApi.updateSiteConfig(mode, payload),
    onSuccess: (data) => {
      qc.setQueryData(oauthQueryKeys.siteConfig(mode), data);
      void qc.invalidateQueries({ queryKey: oauthQueryKeys.publicProviders() });
    },
  });
}
