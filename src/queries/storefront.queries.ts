/**
 * 前台商城与认证领域 TanStack Query v5 Hooks
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { authApi } from '../api/auth.api';
import {
  getAuthRevision,
  getAuthScope,
  getAuthToken,
  getCurrentHostScope,
  setAuthToken,
  subscribeAuthChanges,
} from '../api/http';
import { storefrontApi } from '../api/storefront.api';
import { queryClient as sessionClient } from '../app/query-client';
import type { UserProfile } from '../types';
import { queryKeys } from './query-keys';

export function useBootstrapQuery() {
  const host = getCurrentHostScope();
  return useQuery({
    queryKey: queryKeys.bootstrap(host),
    queryFn: () => storefrontApi.bootstrap(),
    staleTime: 60_000,
    retry: (failureCount, err) => {
      if (err && typeof err === 'object' && 'status' in err && Number(err.status) === 403) return false;
      return failureCount < 1;
    },
  });
}

export function useProductsQuery(params: { category?: string; q?: string; tag?: string }) {
  return useQuery({
    queryKey: queryKeys.products(params),
    queryFn: () => storefrontApi.listProducts(params),
  });
}

export function useProductQuery(idOrSlug: string | undefined, accessCode = '') {
  return useQuery({
    queryKey: queryKeys.product(idOrSlug || '', accessCode),
    queryFn: () => storefrontApi.getProduct(idOrSlug || '', accessCode),
    enabled: Boolean(idOrSlug),
  });
}

export function useHelpArticlesQuery() {
  return useQuery({
    queryKey: queryKeys.helpArticles(),
    queryFn: () => storefrontApi.getHelp(),
    staleTime: 60_000,
  });
}

export function useAuthScope() {
  useLocation();
  useSyncExternalStore(subscribeAuthChanges, getAuthRevision, getAuthRevision);
  return getAuthScope();
}

export function useMeQuery(scope: string) {
  const qc = useQueryClient();
  useEffect(() => {
    qc.removeQueries({ queryKey: ['auth', 'me'], predicate: (query) => query.queryKey[2] !== scope });
  }, [qc, scope]);
  return useQuery({
    queryKey: queryKeys.me(scope),
    queryFn: async ({ signal }) => {
      if (!getAuthToken()) return null;
      try {
        const res = await authApi.me(signal);
        return res.user;
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useAuthActions(scope: string) {
  const qc = sessionClient;

  const setUserCache = (user: UserProfile | null) => {
    if (user && !getAuthToken()) return;
    qc.setQueryData(queryKeys.me(getAuthScope()), user);
  };

  const updateBalanceCache = (balance: number) => {
    if (getAuthScope() !== scope) return;
    qc.setQueryData<UserProfile | null>(queryKeys.me(scope), (prev) => (prev ? { ...prev, balance } : prev));
  };

  const clearSession = () => {
    if (getAuthScope() !== scope) return;
    setAuthToken(null);
    setUserCache(null);
  };

  const logout = async () => {
    const token = getAuthToken();
    if (token) await authApi.logout(token);
    if (getAuthScope() === scope && getAuthToken() === token) clearSession();
  };

  const refreshMe = () => qc.invalidateQueries({ queryKey: queryKeys.me(getAuthScope()) });
  const refreshBootstrap = async () => {
    const host = getCurrentHostScope();
    try {
      const fresh = await storefrontApi.bootstrap(true);
      qc.setQueryData(queryKeys.bootstrap(host), fresh);
    } catch {
      await qc.invalidateQueries({ queryKey: ['storefront', 'bootstrap'] });
    }
    await qc.invalidateQueries({ queryKey: ['storefront', 'products'] });
  };

  return {
    setUserCache,
    updateBalanceCache,
    clearSession,
    logout,
    refreshMe,
    refreshBootstrap,
  };
}
