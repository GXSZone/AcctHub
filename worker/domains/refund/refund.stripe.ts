import type { OrderRefund } from '../../db/schema/index';
import { type Env, isSandboxEnabled } from '../../env';
import {
  isStripeLiveSecret,
  loadPaymentPluginConfig,
  type StripePluginConfig,
} from '../payment/payment.gateway';

type Result = { status: 'succeeded' | 'pending' | 'failed' | 'unknown'; id?: string };
type StripeRefund = {
  id?: string;
  object?: string;
  status?: string;
  amount?: number;
  currency?: string;
  payment_intent?: string;
  metadata?: { accthub_refund_id?: string };
};

const stripeBase = 'https://api.stripe.com/v1';
const sessionIdPattern = /^cs_(?:test|live)_[A-Za-z0-9]+$/;
const paymentIdPattern = /^pi_[A-Za-z0-9]+$/;
const refundIdPattern = /^re_[A-Za-z0-9]+$/;

async function stripeRequest<T>(key: string, path: string, init?: RequestInit): Promise<T | null> {
  try {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${key}`);
    const response = await fetch(`${stripeBase}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function stripeRefundKey(env: Env, event: OrderRefund) {
  // Stripe 结账只接受项目配置支持的两位小数币种。
  if (!sessionIdPattern.test(event.originalPayment) || !['USD', 'CNY', 'HKD'].includes(event.currency))
    return null;
  const plugin = await loadPaymentPluginConfig<StripePluginConfig>(env, 'stripe');
  const key = plugin.config.secret_key?.trim();
  if (
    !key ||
    (!isSandboxEnabled(env) && (!isStripeLiveSecret(key) || event.originalPayment.startsWith('cs_test_')))
  ) {
    return null;
  }
  return key;
}

async function retrieveOriginalPayment(key: string, event: OrderRefund) {
  const session = await stripeRequest<{
    id?: string;
    object?: string;
    status?: string;
    payment_status?: string;
    livemode?: boolean;
    payment_intent?: string;
    amount_total?: number;
    currency?: string;
    client_reference_id?: string;
    metadata?: { intent_no?: string };
  }>(key, `/checkout/sessions/${encodeURIComponent(event.originalPayment)}`);
  if (
    session?.object !== 'checkout.session' ||
    (isStripeLiveSecret(key) && session.livemode !== true) ||
    session.id !== event.originalPayment ||
    session.status !== 'complete' ||
    session.payment_status !== 'paid' ||
    session.client_reference_id !== event.paymentIntentNo ||
    session.metadata?.intent_no !== event.paymentIntentNo ||
    session.amount_total !== Math.round(event.amount * 100) ||
    session.currency?.toUpperCase() !== event.currency ||
    !session.payment_intent ||
    !paymentIdPattern.test(session.payment_intent)
  )
    return null;
  return session.payment_intent;
}

function normalizeRefund(event: OrderRefund, paymentId: string, row?: StripeRefund | null): Result {
  if (
    !row?.id ||
    !refundIdPattern.test(row.id) ||
    row.object !== 'refund' ||
    row.payment_intent !== paymentId ||
    row.amount !== Math.round(event.amount * 100) ||
    row.currency?.toUpperCase() !== event.currency
  )
    return { status: 'unknown' };
  const id = row.id;
  switch (row.status) {
    case 'succeeded':
      return { status: 'succeeded', id };
    case 'pending':
    case 'requires_action':
      return { status: 'pending', id };
    case 'failed':
    case 'canceled':
      return { status: 'failed', id };
    default:
      return { status: 'unknown', id };
  }
}

export async function createStripeRefund(key: string, event: OrderRefund): Promise<Result> {
  const paymentId = await retrieveOriginalPayment(key, event);
  if (!paymentId) return { status: 'unknown' };
  const body = new URLSearchParams({
    payment_intent: paymentId,
    amount: String(Math.round(event.amount * 100)),
    'metadata[accthub_refund_id]': event.operationId,
  });
  const response = await stripeRequest<StripeRefund>(key, '/refunds', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `accthub-refund-${event.operationId}`,
    },
    body,
  });
  if (response?.metadata?.accthub_refund_id !== event.operationId) return { status: 'unknown' };
  return normalizeRefund(event, paymentId, response);
}

export async function queryStripeRefund(key: string, event: OrderRefund, proofId?: string): Promise<Result> {
  const paymentId = await retrieveOriginalPayment(key, event);
  if (!paymentId) return { status: 'unknown' };
  const id = proofId ?? event.providerRefundId;
  if (id) {
    if (!refundIdPattern.test(id)) return { status: 'unknown' };
    const refund = await stripeRequest<StripeRefund>(key, `/refunds/${encodeURIComponent(id)}`);
    if (refund?.id !== id || (!proofId && refund.metadata?.accthub_refund_id !== event.operationId)) {
      return { status: 'unknown' };
    }
    return normalizeRefund(event, paymentId, refund);
  }
  const params = new URLSearchParams({ payment_intent: paymentId, limit: '100' });
  const collection = await stripeRequest<{ data?: StripeRefund[]; has_more?: boolean }>(
    key,
    `/refunds?${params}`
  );
  const found = collection?.data?.filter((row) => row.metadata?.accthub_refund_id === event.operationId);
  if (found?.length !== 1) return { status: 'unknown' };
  return normalizeRefund(event, paymentId, found[0]);
}
