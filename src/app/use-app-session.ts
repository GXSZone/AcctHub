import { useMemo } from 'react';
import { getAuthToken } from '../api/http';
import { useAuthActions, useAuthScope, useMeQuery } from '../queries/storefront.queries';
import { createQueryClient } from './query-client';

export function useAppSession() {
  const authScope = useAuthScope();
  const meQuery = useMeQuery(authScope);
  const user = meQuery.data ?? null;
  const privateScope = JSON.stringify([authScope, user?.site_agent_id ?? 0, user?.id ?? null, user?.role]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 每次身份变化都要重新建立查询缓存。
  const privateClient = useMemo(createQueryClient, [privateScope]);
  const actions = useAuthActions(authScope);

  return {
    authScope,
    privateScope,
    privateClient,
    user,
    awaitingIdentity: getAuthToken() !== null && meQuery.isPending,
    actions,
  };
}
