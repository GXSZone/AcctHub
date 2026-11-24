/**
 * 总控后台、财务对账、AI 与上游货源 TanStack Query v5 Hooks
 */

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api/admin.api';
import { aiApi } from '../api/ai.api';
import { upstreamApi } from '../api/upstream.api';
import { usePrivateSessionScope } from '../app/PrivateSession';
import { queryKeys } from './query-keys';

export function useAdminOverviewQuery(enabled = true) {
  const scope = usePrivateSessionScope();
  return useQuery({
    queryKey: queryKeys.adminOverview(scope),
    queryFn: ({ signal }) => adminApi.overview(signal),
    enabled,
    retry: false,
  });
}

export function useAdminFinanceQuery(days: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminFinance(days),
    queryFn: () => adminApi.financeReconciliation(days),
    enabled,
  });
}

export function useAdminCashflowsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminCashflows(),
    queryFn: () => adminApi.financeCashflows(),
    enabled,
  });
}

export function useAdminMembersQuery(
  params: {
    q?: string;
    role?: 'all' | 'user' | 'agent' | 'admin';
    status?: 'all' | 'active' | 'frozen' | 'blacklisted';
    page?: number;
    page_size?: number;
  },
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.adminMembers({
      q: params.q,
      role: params.role,
      status: params.status,
      page: params.page,
    }),
    queryFn: () => adminApi.listMembers(params),
    enabled,
  });
}

export function useAdminMemberTransactionsQuery(userId: number | null) {
  return useQuery({
    queryKey: queryKeys.adminMemberTransactions(userId || 0),
    queryFn: () => adminApi.listMemberTransactions(userId || 0),
    enabled: Boolean(userId && userId > 0),
  });
}

export function useAdminMailConfigQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.adminMailConfig(),
    queryFn: () => adminApi.getMailConfig(),
    enabled,
  });
}

export function useAdminAiConfigQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.adminAiConfig(),
    queryFn: () => aiApi.getConfig(),
    enabled,
  });
}

export function useUpstreamSourcesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.upstreamSources(),
    queryFn: () => upstreamApi.listSources(),
    enabled,
  });
}

export function useUpstreamItemsQuery(sourceId: number | null) {
  return useQuery({
    queryKey: queryKeys.upstreamItems(sourceId || 0),
    queryFn: () => upstreamApi.listItems(sourceId || 0),
    enabled: Boolean(sourceId),
  });
}

export function useUpstreamBindingsQuery(productId?: number, enabled = true) {
  return useQuery({
    queryKey: queryKeys.upstreamBindings(productId),
    queryFn: () => upstreamApi.listBindings(productId),
    enabled,
  });
}

export function useUpstreamLedgerQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.upstreamLedger(),
    queryFn: () => upstreamApi.getLedger(),
    enabled,
  });
}
