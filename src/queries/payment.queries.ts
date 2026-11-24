import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../api/orders.api';
import type { OrderRecord, PaymentIntentInfo } from '../types';
import { queryKeys } from './query-keys';

export function isWalletRechargeAwaitingCredit(intent: PaymentIntentInfo) {
  return (
    intent.biz_type === 'wallet_recharge' && intent.status === 'paid' && intent.fulfill_status !== 'done'
  );
}

export function hasDeliveredOrder(order?: OrderRecord | null): boolean {
  return Boolean(order?.status === 'delivered' && order.delivered_payload && !order.locked);
}

export function hasTerminalOrderFailure(order?: OrderRecord | null): boolean {
  return ['closed', 'expired', 'failed', 'fulfillment_failed', 'refunded'].includes(order?.status ?? '');
}

export function isOrderAwaitingDelivery(intent: PaymentIntentInfo, order?: OrderRecord | null) {
  return (
    intent.biz_type === 'order' &&
    intent.status === 'paid' &&
    !hasDeliveredOrder(order) &&
    !hasTerminalOrderFailure(order)
  );
}

export function usePaymentIntentQuery(initial: PaymentIntentInfo | null) {
  return useQuery({
    queryKey: queryKeys.paymentIntent(initial?.intent_no, initial?.view_token),
    enabled: !!initial,
    queryFn: () => ordersApi.getPaymentIntent(initial?.intent_no ?? '', initial?.view_token),
    refetchInterval: (query) => {
      const intent = query.state.data?.intent ?? initial;
      return intent &&
        (intent.status === 'pending' ||
          isWalletRechargeAwaitingCredit(intent) ||
          isOrderAwaitingDelivery(intent, query.state.data?.order))
        ? 3000
        : false;
    },
  });
}
