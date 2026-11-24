import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { findOrderByNo } from '../payment/payment.order.repo';
import { verifyAndParseUpstreamWebhook } from './upstream.catalog.adapter';
import { executeUpstreamProcurement, finalizeOrderDeliveryWithCards } from './upstream.fulfillment.service';
import {
  findUpstreamOrderByIdRepo,
  findUpstreamOrderForWebhookRepo,
  getUpstreamDeliveredProfitAggRepo,
  listExceptionOrdersRepo,
  listUpstreamOrdersLedgerRepo,
  markPendingOrderFailedRepo,
  updateOrderUpstreamStateRepo,
  updateUpstreamOrderRepo,
} from './upstream.orders.repo';
import { settleAsyncUpstreamCardsOutcome } from './upstream.poll.service';
import { findUpstreamSourceById } from './upstream.repo';

/** 接收并验签处理上游异步发货 Webhook 回调 */
export async function processUpstreamWebhook(
  env: Env,
  sourceId: number,
  body: Record<string, unknown>,
  headers: Headers,
  originUrl: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const db = createDb(env.DB);
  const source = await findUpstreamSourceById(db, sourceId);
  if (!source) return { status: 404, body: { error: '上游源不存在' } };

  const parsed = await verifyAndParseUpstreamWebhook(env, source, body, headers);
  if (!parsed.verified) {
    return { status: 401, body: { error: parsed.error || '签名校验失败' } };
  }

  const upOrder = await findUpstreamOrderForWebhookRepo(
    db,
    sourceId,
    parsed.outTradeNo,
    parsed.upstreamOrderNo
  );
  if (!upOrder) return { status: 404, body: { error: '未匹配到对应的上游采购订单' } };

  const localOrderNo = upOrder.localOrderNo || '';
  if (parsed.status === 'succeeded' && parsed.cards.length > 0) {
    const settled = await settleAsyncUpstreamCardsOutcome(env, {
      upOrder,
      sourceId,
      cards: parsed.cards,
      upstreamOrderNo: parsed.upstreamOrderNo || upOrder.upstreamOrderNo || '',
      actualCost: parsed.actualCost || Number(upOrder.upstreamCost || 0),
      originUrl,
      rawResponseJson: JSON.stringify(body),
    });
    return {
      status: 200,
      body: {
        code: 200,
        ok: true,
        status: settled.status === 'succeeded' ? 'delivered' : settled.status,
        order_no: localOrderNo,
      },
    };
  }

  if (parsed.status === 'failed') {
    const errMsg = String(body.msg ?? body.error ?? '上游异步回调通知发货失败');
    const updated = await updateUpstreamOrderRepo(env, upOrder.id, {
      status: 'failed',
      errorMessage: errMsg,
      rawResponseJson: JSON.stringify(body),
    });
    if (!updated) {
      const current = await findUpstreamOrderByIdRepo(db, upOrder.id);
      const status = current?.status === 'succeeded' ? 'delivered' : (current?.status ?? 'pending');
      return { status: 200, body: { code: 200, ok: true, status } };
    }
    if (localOrderNo && ['order_fulfill', 'manual_retry'].includes(upOrder.purpose)) {
      await markPendingOrderFailedRepo(db, localOrderNo, errMsg);
    }
    return { status: 200, body: { code: 200, ok: true, status: 'failed' } };
  }

  return { status: 200, body: { code: 200, ok: true, status: 'pending' } };
}

/** 查询上游采购台账、异常待恢复订单队列与已交付净利润汇总 */
export async function getUpstreamOrdersLedger(env: Env) {
  const db = createDb(env.DB);
  const [upOrders, exceptionOrders, profitAgg] = await Promise.all([
    listUpstreamOrdersLedgerRepo(db, 100),
    listExceptionOrdersRepo(db, 80),
    getUpstreamDeliveredProfitAggRepo(db),
  ]);

  const rev = Number(profitAgg?.grossRevenue || 0);
  const comm = Number(profitAgg?.totalCommission || 0);
  const cost = Number(profitAgg?.totalUpstreamCost || 0);

  return {
    upstream_orders: upOrders,
    exception_orders: exceptionOrders,
    profit_summary: {
      delivered_count: Number(profitAgg?.count || 0),
      gross_revenue: Number(rev.toFixed(2)),
      total_commission: Number(comm.toFixed(2)),
      total_upstream_cost: Number(cost.toFixed(2)),
      net_profit: Number((rev - comm - cost).toFixed(2)),
    },
  };
}

/** 异常订单换源重试采购（严禁对 upstream_pending 直接重试，防双重采购） */
export async function retryLocalOrderProcurement(
  env: Env,
  orderNo: string,
  specificSourceId: number | undefined,
  originUrl: string
) {
  const db = createDb(env.DB);
  const order = await findOrderByNo(db, orderNo);
  if (!order) throw Errors.notFound('本地订单不存在');
  if (order.status === 'upstream_pending') {
    throw Errors.conflict(
      '该订单当前处于上游异步处理或超时待查单状态，请先点击「立即查单」确认结果后再决定是否换源重试，避免双重采购扣款'
    );
  }
  if (order.status !== 'fulfillment_failed') throw Errors.validation('仅实际付款且履约失败的订单可重试');

  const outcome = await executeUpstreamProcurement(env, {
    localOrderNo: orderNo,
    productId: order.productId,
    specId: order.specId || 'default',
    quantity: Number(order.quantity || 1),
    contactEmail: order.contactEmail || '',
    originUrl,
    purpose: 'manual_retry',
    specificSourceId,
  });

  if (outcome.status === 'delivered') {
    const finalized = await finalizeOrderDeliveryWithCards(env, {
      localOrderNo: orderNo,
      cards: outcome.cards,
      upstreamSourceId: outcome.upstreamSourceId,
      upstreamOrderNo: outcome.upstreamOrderNo,
      upstreamCostTotal: outcome.upstreamCostTotal,
      upstreamOrderRowId: outcome.upstreamOrderRowId,
      originUrl,
    });
    if (!finalized.ok) throw Errors.conflict('订单状态已变更，请人工核对本次采购');
    return {
      ok: true,
      status: 'delivered',
      upstream_order_no: outcome.upstreamOrderNo,
      cards: outcome.cards,
    };
  }

  if (outcome.status === 'upstream_pending') {
    await updateOrderUpstreamStateRepo(db, orderNo, {
      status: 'upstream_pending',
      upstreamSourceId: outcome.upstreamSourceId,
      upstreamOrderNo: outcome.upstreamOrderNo,
      upstreamCostTotal: outcome.upstreamCostTotal,
      upstreamStatus: 'pending',
      upstreamError: outcome.errorMessage,
    });
    return { ok: true, status: 'upstream_pending', message: '已重新下单，等待上游异步出卡或查单确认' };
  }

  await updateOrderUpstreamStateRepo(db, orderNo, {
    status: 'fulfillment_failed',
    upstreamStatus: 'failed',
    upstreamError: outcome.errorMessage,
  });
  throw Errors.conflict(`重试采购失败：${outcome.errorMessage}`);
}

/** 异常订单人工填入卡密补发（禁止覆盖已退款/已交付订单） */
export async function manualFulfillLocalOrder(
  env: Env,
  orderNo: string,
  body: { cards_text?: string; upstream_order_no?: string; upstream_cost?: number },
  originUrl: string
) {
  const lines = (body.cards_text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) throw Errors.validation('请填写至少一行交付卡密/凭证');

  const existing = await findOrderByNo(createDb(env.DB), orderNo);
  if (!existing) throw Errors.notFound('订单不存在');
  if (!['paid', 'upstream_pending', 'fulfillment_failed'].includes(existing.status)) {
    throw Errors.conflict('仅允许为已付款、等待交付的订单填写凭证');
  }

  const res = await finalizeOrderDeliveryWithCards(env, {
    localOrderNo: orderNo,
    cards: lines,
    upstreamOrderNo: (body.upstream_order_no || '').trim(),
    upstreamCostTotal: Number(body.upstream_cost || 0),
    originUrl,
  });
  if (!res.ok) throw Errors.conflict('订单状态已变更，无法完成人工补发');
  return { ok: true, status: 'delivered', count: lines.length, mail_status: res.mail_status ?? 'disabled' };
}
