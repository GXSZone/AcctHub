import { roundCurrency } from '@shared/domain/money';
import { eq } from 'drizzle-orm';
import {
  type OrderRefund,
  type OrderRow,
  orders,
  paymentIntents,
  type RefundMode,
  type RefundRoute,
  refundPolicies,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { AppError, Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import {
  claimRefundPollBatch,
  finishOrderRefund,
  insertOrderRefund,
  readOrderRefund,
  readRefundMode,
  releaseRefundPollLease,
  updateProviderRefund,
} from './refund.repo';
import { createStripeRefund, queryStripeRefund, stripeRefundKey } from './refund.stripe';

interface RefundEvidence {
  originalPayment: string;
  amount: number;
  currency: string;
  reference: string;
}

export interface RefundCommand {
  action?: 'request' | 'query' | 'confirm';
  route?: 'original_payment' | 'wallet' | 'wallet_compensation';
  evidence?: RefundEvidence;
}

const refundable = ['delivered', 'paid', 'fulfillment_failed'];
const referenceFormat = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,127}$/;

function findOrderByNo(db: ReturnType<typeof createDb>, orderNo: string) {
  return db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
}

function findPaymentIntentByNo(db: ReturnType<typeof createDb>, intentNo: string) {
  return db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, intentNo)).get();
}

function publicRefund(event: OrderRefund) {
  const { mode, route, status, provider, originalPayment, currency, amount, amountCny, proofReference } =
    event;
  return { mode, route, status, provider, originalPayment, currency, amount, amountCny, proofReference };
}

export async function getRefundPolicy(env: Env) {
  return { mode: await readRefundMode(env.DB) };
}

export async function saveRefundPolicy(env: Env, mode: unknown): Promise<{ mode: RefundMode }> {
  if (mode !== 'manual' && mode !== 'automatic') throw Errors.validation('请选择有效的全站退款模式');
  const db = createDb(env.DB);
  await db.insert(refundPolicies).values({ siteAgentId: 0, mode }).onConflictDoUpdate({
    target: refundPolicies.siteAgentId,
    set: { mode },
  });
  return { mode };
}

export async function getOrderRefund(env: Env, orderNo: string) {
  const order = await findOrderByNo(createDb(env.DB), orderNo);
  if (!order) throw Errors.notFound('订单不存在');
  const event = await readOrderRefund(env.DB, orderNo);
  return {
    refund: event ? publicRefund(event) : null,
    mode: event?.mode ?? (await readRefundMode(env.DB)),
    route: order.paymentMethod === 'balance' ? ('wallet' as const) : ('original_payment' as const),
  };
}

async function getOriginalPayment(env: Env, order: OrderRow, route?: RefundRoute) {
  const amountCny = roundCurrency(Number(order.totalAmount));
  if (!Number.isFinite(amountCny) || amountCny < 0) throw Errors.conflict('订单金额无效');
  if (order.paymentMethod === 'balance') {
    if (!order.userId || (route && route !== 'wallet')) throw Errors.validation('该订单需退回原钱包');
    return {
      route: 'wallet' as const,
      provider: 'balance',
      originalPayment: order.orderNo,
      currency: 'CNY',
      amount: amountCny,
      amountCny,
      paymentIntentNo: null,
    };
  }
  if (
    route === 'wallet' ||
    (route === 'wallet_compensation' && (!order.userId || order.status !== 'fulfillment_failed'))
  ) {
    throw Errors.validation('仅已确认失败的会员在线订单可执行钱包补偿');
  }
  const payment = order.paymentIntentNo
    ? await findPaymentIntentByNo(createDb(env.DB), order.paymentIntentNo)
    : null;
  if (
    payment?.status !== 'paid' ||
    payment.bizType !== 'order' ||
    payment.bizRef !== order.orderNo ||
    payment.provider !== order.paymentMethod ||
    payment.siteAgentId !== (order.agentId ?? 0) ||
    payment.userId !== order.userId ||
    roundCurrency(payment.amountCny) !== amountCny ||
    !payment.providerTradeNo.trim() ||
    !Number.isFinite(payment.payAmount) ||
    payment.payAmount <= 0 ||
    !/^[A-Z]{3,4}$/.test(payment.currency)
  ) {
    throw Errors.conflict('未找到与订单匹配的已收款原交易，需先核对支付记录');
  }
  return {
    route: route === 'wallet_compensation' ? route : ('original_payment' as const),
    provider: payment.provider,
    originalPayment: payment.providerTradeNo,
    currency: payment.currency,
    amount: payment.payAmount,
    amountCny,
    paymentIntentNo: payment.intentNo,
  };
}

function refundResult(event: OrderRefund) {
  return { ok: true, order_no: event.orderNo, restocked: false, refund: publicRefund(event) };
}

function isWorking(event: OrderRefund) {
  return ['submitting', 'pending', 'unknown'].includes(event.status);
}

async function existingPaymentWasLive(env: Env, event: OrderRefund) {
  const intent = event.paymentIntentNo
    ? await findPaymentIntentByNo(createDb(env.DB), event.paymentIntentNo)
    : null;
  return (
    intent?.status === 'paid' &&
    intent.bizType === 'order' &&
    intent.bizRef === event.orderNo &&
    intent.siteAgentId === event.siteAgentId &&
    intent.provider === event.provider &&
    intent.providerTradeNo === event.originalPayment &&
    intent.currency === event.currency &&
    intent.payAmount === event.amount &&
    safeJsonParse<{ sandbox_simulated?: boolean }>(intent.payloadJson, {}).sandbox_simulated === false
  );
}

function validateEvidence(event: OrderRefund, evidence?: RefundEvidence) {
  if (
    !evidence ||
    typeof evidence.reference !== 'string' ||
    !referenceFormat.test(evidence.reference.trim()) ||
    typeof evidence.amount !== 'number' ||
    evidence.amount !== event.amount ||
    evidence.currency !== event.currency ||
    evidence.originalPayment !== event.originalPayment
  ) {
    throw Errors.validation('退款证明必须匹配原交易、退款金额和币种，并提供唯一凭据编号');
  }
  return evidence.reference.trim();
}

function assertRefundable(order: OrderRow) {
  if (!refundable.includes(order.status))
    throw Errors.conflict('仅已付款订单可退款，待支付、过期、处理中及已退款订单需先核对状态');
}

async function reconcileOnlineRefund(
  env: Env,
  order: OrderRow,
  event: OrderRefund,
  key: string,
  pollLease?: string
) {
  const result = await queryStripeRefund(key, event);
  if (result.status === 'succeeded' && result.id) {
    await finishOrderRefund(
      env.DB,
      order,
      event,
      { reference: result.id, providerRefundId: result.id },
      pollLease
    );
  } else if (!(event.status === 'submitting' && result.status === 'unknown')) {
    await updateProviderRefund(
      env.DB,
      event,
      result.status === 'succeeded' ? 'unknown' : result.status,
      result.id,
      pollLease
    );
  }
}

/** 已发起的自动退款按原网关查证，定时入口不会提交新的退款请求。 */
export async function runScheduledRefundReconciliation(env: Env) {
  const token = crypto.randomUUID();
  const events = await claimRefundPollBatch(env.DB, token);
  const db = createDb(env.DB);
  const outcomes = await Promise.allSettled(
    events.map(async (event) => {
      try {
        const order = await findOrderByNo(db, event.orderNo);
        if (!order || !refundable.includes(order.status) || !(await existingPaymentWasLive(env, event)))
          return;
        const key = await stripeRefundKey(env, event);
        if (key) await reconcileOnlineRefund(env, order, event, key, token);
      } finally {
        await releaseRefundPollLease(env.DB, event.orderNo, token);
      }
    })
  );
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === 'fulfilled') continue;
    const error: unknown = outcome.reason;
    if (error instanceof AppError && error.code === 'CONFLICT') continue;
    console.warn('自动退款查询暂未完成', events[index]?.orderNo);
  }
}

async function handleOnlineRefund(env: Env, order: OrderRow, event: OrderRefund, cmd: RefundCommand) {
  const key =
    event.provider === 'stripe' && (await existingPaymentWasLive(env, event))
      ? await stripeRefundKey(env, event)
      : null;
  if (cmd.action === 'confirm') {
    if (event.status === 'ready') throw Errors.conflict('请先提交退款申请再核对结果');
    const reference = validateEvidence(event, cmd.evidence);
    if (isWorking(event) || (event.provider === 'stripe' && key)) {
      if (!key) throw Errors.conflict('需通过原网关核对未知退款，当前无法查询');
      const result = await queryStripeRefund(key, event, reference);
      if (result.status !== 'succeeded') throw Errors.conflict('原网关未确认该证明对应的全额退款已成功');
      await finishOrderRefund(env.DB, order, event, { reference, providerRefundId: result.id });
    } else {
      await finishOrderRefund(env.DB, order, event, { reference: reference.toLowerCase() });
    }
    return refundResult({ ...event, status: 'succeeded', proofReference: reference });
  }

  if (cmd.action === 'query') {
    if (!isWorking(event)) return refundResult(event);
    if (!key) throw Errors.conflict('无法访问原网关，请按当前记录继续对账');
    await reconcileOnlineRefund(env, order, event, key);
    return refundResult((await readOrderRefund(env.DB, order.orderNo)) ?? event);
  }

  if (event.status !== 'ready') return refundResult(event);
  if (event.mode !== 'automatic' || !key) {
    const updated = await updateProviderRefund(env.DB, event, 'manual_required');
    return refundResult(updated ?? (await readOrderRefund(env.DB, order.orderNo)) ?? event);
  }
  const claimed = await updateProviderRefund(env.DB, event, 'submitting');
  if (!claimed) return refundResult((await readOrderRefund(env.DB, order.orderNo)) ?? event);
  const result = await createStripeRefund(key, claimed);
  if (result.status === 'succeeded' && result.id) {
    await finishOrderRefund(env.DB, order, claimed, { reference: result.id, providerRefundId: result.id });
  } else {
    await updateProviderRefund(
      env.DB,
      claimed,
      result.status === 'succeeded' ? 'unknown' : result.status,
      result.id
    );
  }
  return refundResult((await readOrderRefund(env.DB, order.orderNo)) ?? claimed);
}

export async function processOrderRefund(
  env: Env,
  orderNo: string,
  cmd: RefundCommand,
  exceptionOnly = false
) {
  if (cmd.action !== undefined && !['request', 'query', 'confirm'].includes(cmd.action)) {
    throw Errors.validation('无效的退款操作');
  }
  if (cmd.route !== undefined && !['original_payment', 'wallet', 'wallet_compensation'].includes(cmd.route)) {
    throw Errors.validation('无效的退款去向');
  }
  const order = await findOrderByNo(createDb(env.DB), orderNo);
  if (!order) throw Errors.notFound('订单不存在');
  const existing = await readOrderRefund(env.DB, orderNo);
  if (cmd.action === 'query' && existing?.status === 'succeeded') return refundResult(existing);
  assertRefundable(order);
  if (exceptionOnly && order.status !== 'fulfillment_failed')
    throw Errors.validation('仅可处理已确认失败的异常订单');

  let event = existing;
  if (!event) {
    if (cmd.action === 'query' || cmd.action === 'confirm') throw Errors.conflict('请先创建退款记录');
    const original = await getOriginalPayment(env, order, cmd.route);
    try {
      await insertOrderRefund(env.DB, order, {
        ...original,
        operationId: crypto.randomUUID(),
        siteAgentId: order.agentId ?? 0,
        status: 'ready',
      });
    } catch (error) {
      if (
        /uq_order_refund_original|order_refunds\.provider, order_refunds\.original_payment/.test(
          String(error)
        )
      ) {
        throw Errors.conflict('该原交易已关联其他退款记录，请先对账');
      }
      throw error;
    }
    event = await readOrderRefund(env.DB, orderNo);
  }
  if (!event) throw Errors.conflict('订单状态已变化，请刷新核对');
  if (cmd.route && event.route !== cmd.route) throw Errors.conflict('退款去向已固化，请按原记录继续核对');
  if (event.status === 'succeeded') throw Errors.conflict('该订单已完成退款');
  if (event.route !== 'original_payment') {
    if (cmd.action === 'confirm') throw Errors.validation('钱包退款不接收外部证明');
    if (cmd.action === 'query') return refundResult(event);
    await finishOrderRefund(env.DB, order, event);
    return refundResult({ ...event, status: 'succeeded' });
  }
  return handleOnlineRefund(env, order, event, cmd);
}
