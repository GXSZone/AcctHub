/**
 * 下单、查单与异步收银台支付（Orders & Payments）领域 API 客户端
 */

import type { OrderRecord, PaymentIntentInfo } from '../types';
import { apiRequest } from './http';

export interface CheckoutResult {
  order: OrderRecord;
  balance?: number;
  idempotent_replay?: boolean;
  requires_payment?: boolean;
  payment_intent?: PaymentIntentInfo;
}

export const ordersApi = {
  createOrder: (payload: {
    product_id: number;
    spec_id?: string;
    quantity: number;
    contact_email: string;
    query_password?: string;
    payment_method: string;
    coupon_code?: string;
    use_promo_balance?: boolean;
    custom_inputs?: Record<string, string>;
    idempotency_key?: string;
    checkout_secret?: string;
    turnstile_token?: string;
    access_code?: string;
    group_buy_mode?: 'start' | 'join';
    group_buy_code?: string;
    selected_card_id?: number;
  }) =>
    apiRequest<CheckoutResult>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  recoverCheckout: (proof: { idempotency_key: string; checkout_secret: string }) =>
    apiRequest<{ found: false } | ({ found: true } & CheckoutResult)>('/api/orders/recover', {
      method: 'POST',
      body: JSON.stringify(proof),
    }),

  lookupOrders: (payload: { q?: string; password?: string; cursor?: number; turnstile_token?: string }) =>
    apiRequest<{ orders: Array<OrderRecord | { locked: true }>; next_cursor?: number | null }>(
      '/api/orders/lookup',
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  getPaymentIntent: async (intentNo: string, viewToken?: string) => {
    const result = await apiRequest<
      | { locked: true }
      | { locked?: false; intent: PaymentIntentInfo; order?: OrderRecord | null; balance?: number }
    >(
      `/api/payments/intents/${encodeURIComponent(intentNo)}`,
      viewToken ? { headers: { 'X-Intent-Token': viewToken } } : undefined
    );
    return result.locked ? null : result;
  },

  checkPaymentIntent: (intentNo: string, viewToken?: string) =>
    apiRequest<{ ok: boolean; status: string; paid_at: string | null }>(
      `/api/payments/intents/${encodeURIComponent(intentNo)}/check`,
      { method: 'POST', headers: viewToken ? { 'X-Intent-Token': viewToken } : undefined }
    ),

  ...(__ACCTHUB_SANDBOX__
    ? {
        simulateSandboxPay: (intentNo: string) =>
          apiRequest<{ ok: boolean; bizType?: string; bizRef?: string }>(
            '/api/payments/sandbox/simulate-pay',
            {
              method: 'POST',
              body: JSON.stringify({ intent_no: intentNo }),
            }
          ),
      }
    : {}),
};
