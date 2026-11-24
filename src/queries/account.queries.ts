/**
 * 会员中心与 2FA 保险箱 TanStack Query v5 Hooks
 */

import type { AccountAffiliateQuery } from '@shared/contracts/account.contract';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { accountApi } from '../api/account.api';
import { getCurrentHostScope } from '../api/http';
import { usePrivateSessionScope } from '../app/PrivateSession';
import { queryKeys } from './query-keys';

export function useAccountSummaryQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountSummary(),
    queryFn: () => accountApi.summary(),
    enabled,
  });
}

export function useAccountAffiliateQuery(enabled: boolean, page: AccountAffiliateQuery) {
  const scope = usePrivateSessionScope();
  const host = getCurrentHostScope();
  return useQuery({
    queryKey: queryKeys.accountAffiliate(page, host, scope),
    queryFn: () => accountApi.affiliate(page),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function useAccountRechargeIntentMutation() {
  return useMutation({ mutationFn: accountApi.createRechargeIntent });
}

export function useAccountOrdersQuery(enabled: boolean) {
  const scope = usePrivateSessionScope();
  return useInfiniteQuery({
    queryKey: [...queryKeys.accountOrders(), scope],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => accountApi.orders(pageParam),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled,
  });
}

export function useAccountTransactionsQuery(type: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountTransactions(type),
    queryFn: () => accountApi.transactions(type),
    enabled,
  });
}

export function useAccountTicketsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountTickets(),
    queryFn: () => accountApi.listTickets(),
    enabled,
  });
}

export function useAccountTicketDetailQuery(ticketId: number | null) {
  return useQuery({
    queryKey: queryKeys.accountTicket(ticketId || 0),
    queryFn: () => accountApi.getTicket(ticketId || 0),
    enabled: Boolean(ticketId),
  });
}

export function useAccountSecurityQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountSecurity(),
    queryFn: () => accountApi.security(),
    enabled,
  });
}

export function useTotpVaultQuery(enabled: boolean) {
  const scope = usePrivateSessionScope();
  return useQuery({
    queryKey: queryKeys.totpVault(scope),
    queryFn: ({ signal }) => accountApi.totpVaultList(signal),
    enabled,
  });
}

export function useInvalidateAccount() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['account'] });
}
