/**
 * 代理分站工作台 TanStack Query v5 Hooks
 */

import { useQuery } from '@tanstack/react-query';
import { agentApi } from '../api/agent.api';
import { queryKeys } from './query-keys';

export function useAgentTiersQuery() {
  return useQuery({
    queryKey: queryKeys.agentTiers(),
    queryFn: () => agentApi.getTiers(),
    staleTime: 60_000,
  });
}

export function useAgentMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agentMe(),
    queryFn: () => agentApi.getMe(),
    enabled,
  });
}

export function useAgentPricingQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agentPricing(),
    queryFn: () => agentApi.getPricing(),
    enabled,
  });
}

export function useAgentNoticesQuery(enabled: boolean, userId?: number) {
  return useQuery({
    queryKey: queryKeys.agentNotices(userId),
    queryFn: () => agentApi.getNotices(),
    enabled,
  });
}

export function useAgentTicketsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agentTickets(),
    queryFn: () => agentApi.listTickets(),
    enabled,
    // 每 20 秒轮询并在窗口重新聚焦时刷新，确保顾客或总控新消息及时点亮店铺工单角标
    refetchInterval: enabled ? 20_000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useAgentMailConfigQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agentMailConfig(),
    queryFn: () => agentApi.getMailConfig(),
    enabled,
  });
}

export function useAgentAffiliateConfigQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.agentAffiliateConfig(),
    queryFn: () => agentApi.getAffiliateConfig(),
    enabled,
  });
}
