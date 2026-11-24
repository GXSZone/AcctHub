import type { BusinessWebhookEvent } from '@shared/contracts/extensions.contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { extensionsApi } from '../api/extensions.api';
import { getCurrentHostScope } from '../api/http';

export const extensionsQueryKeys = {
  selectableCards: (productId: number, specId: string) =>
    ['storefront', 'selectable-cards', getCurrentHostScope(), productId, specId] as const,
  admin2Fa: () => ['admin', '2fa-status'] as const,
  adminWebhooks: () => ['admin', 'webhooks'] as const,
};

export function useSelectableCardsQuery(productId: number, specId: string, enabled: boolean) {
  return useQuery({
    queryKey: extensionsQueryKeys.selectableCards(productId, specId),
    queryFn: () => extensionsApi.listSelectableCards(String(productId), specId),
    enabled,
    staleTime: 15_000,
  });
}

export function useAdmin2FaStatusQuery() {
  return useQuery({
    queryKey: extensionsQueryKeys.admin2Fa(),
    queryFn: () => extensionsApi.getAdmin2FaStatus(),
  });
}

export function useAdminWebhooksQuery() {
  return useQuery({
    queryKey: extensionsQueryKeys.adminWebhooks(),
    queryFn: () => extensionsApi.listWebhooks(),
  });
}

export function useCreateWebhookMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      url: string;
      secret?: string;
      events: BusinessWebhookEvent[];
      enabled?: boolean;
      allow_fulfill_override?: boolean;
    }) => extensionsApi.createWebhook(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: extensionsQueryKeys.adminWebhooks() });
    },
  });
}

export function useDeleteWebhookMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => extensionsApi.deleteWebhook(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: extensionsQueryKeys.adminWebhooks() });
    },
  });
}
