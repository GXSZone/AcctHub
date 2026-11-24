import { eq } from 'drizzle-orm';
import { paymentIntents, upstreamOrders } from '../../db/schema/index';
import type { OrderRow } from '../../db/schema/orders';
import type { Env } from '../../env';
import {
  readDeliveryPayload,
  readStoredCredential,
  sealDeliveryPayload,
} from '../../infra/credential-storage';
import { encryptSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { dispatchOrderDeliveryEmail } from '../../infra/mail';
import { findOrderByNo } from '../payment/payment.order.repo';
import { getCandidateBindingsForSpec } from './upstream.fulfillment.service';
import { hasCompleteUpstreamUnits, placeUpstreamOrder } from './upstream.order.adapter';
import { updateUpstreamOrderRepo } from './upstream.orders.repo';
import { findSupportTicketByIdRepo, resolveOrderBrandNameRepo } from './upstream.recovery.repo';
import {
  completeReplacementRepo,
  orphanReplacementRepo,
  rememberReplacementMailStatusRepo,
  retryReplacementMailRepo,
} from './upstream.replacement.repo';

type Purchase = typeof upstreamOrders.$inferSelect;
type SupportTicket = NonNullable<Awaited<ReturnType<typeof findSupportTicketByIdRepo>>>;

function isOriginalDelivery(order: OrderRow | null, ticket: SupportTicket): order is OrderRow {
  return (
    !!order &&
    order.status === 'delivered' &&
    !!order.deliveredPayload?.trim() &&
    Number(order.totalAmount || 0) + Number(order.promoUsedAmount || 0) > 0 &&
    ticket.orderNo === order.orderNo &&
    ticket.userId === order.userId &&
    ticket.siteAgentId === (order.agentId ?? 0) &&
    (order.userId !== null || ticket.contactEmail.toLowerCase() === order.contactEmail.toLowerCase())
  );
}

async function hasConfirmedPayment(db: ReturnType<typeof createDb>, order: OrderRow): Promise<boolean> {
  // 余额结账只有扣款完成后才能写入 delivered，在线支付另有付款流水。
  if (order.paymentMethod === 'balance') return true;
  const [payment] = await db.select().from(paymentIntents).where(eq(paymentIntents.bizRef, order.orderNo));
  return payment?.bizType === 'order' && payment.status === 'paid';
}

async function getReplacement(env: Env, ticketId: number) {
  const [row] = await createDb(env.DB)
    .select()
    .from(upstreamOrders)
    .where(eq(upstreamOrders.replacementTicketId, ticketId))
    .limit(1);
  return row;
}

export async function getCompletedReplacementMailStatus(env: Env, ticketId: number) {
  const purchase = await getReplacement(env, ticketId);
  return purchase?.status === 'succeeded' ? purchase.replacementMailStatus : null;
}

function toReceipt(row: Purchase, cards: string[] = []) {
  const status = row.status === 'succeeded' ? 'delivered' : row.status;
  return {
    ok: true as const,
    status,
    cards,
    upstreamOrderNo: row.upstreamOrderNo,
    upstreamSourceName: row.sourceName,
    cost: row.upstreamCost,
    mailStatus: row.replacementMailStatus || 'not_requested',
    errorMessage: row.errorMessage,
  };
}

export async function deliverReplacementPurchase(
  env: Env,
  row: Purchase,
  cards: string[],
  upstreamOrderNo: string,
  actualCost: number,
  originUrl: string
): Promise<'succeeded' | 'orphan' | 'pending'> {
  if (row.status === 'succeeded') return 'succeeded';
  if (row.status === 'orphan') return 'orphan';
  if (!hasCompleteUpstreamUnits(cards, row.quantity)) return 'pending';
  const cardsJson = await encryptSecret(env, JSON.stringify(cards), `upstream-cards:${row.id}`);
  const db = createDb(env.DB);
  const ticket = row.replacementTicketId
    ? await findSupportTicketByIdRepo(db, row.replacementTicketId)
    : null;
  const order = row.replacementOrderNo ? await findOrderByNo(db, row.replacementOrderNo) : null;
  if (
    !ticket ||
    !isOriginalDelivery(order, ticket) ||
    ticket.status === 'closed' ||
    !(await hasConfirmedPayment(db, order))
  ) {
    await orphanReplacementRepo(db, row.id, { upstreamOrderNo, upstreamCost: actualCost, cardsJson });
    return 'orphan';
  }

  const reply = row.replacementNote || '您好，换新已完成。请使用原订单的查单方式查看新凭证。';
  const previousDelivery = await readDeliveryPayload(env, order.orderNo, order.deliveredPayload);
  const newDelivery = await sealDeliveryPayload(
    env,
    order.orderNo,
    `${previousDelivery}\n\n--- 售后换新补发 ---\n${cards.join('\n')}`
  );
  const completed = await completeReplacementRepo(db, {
    purchaseId: row.id,
    orderNo: order.orderNo,
    ticketId: ticket.id,
    previousDelivery: order.deliveredPayload,
    newDelivery,
    cardsJson,
    upstreamOrderNo,
    actualCost,
    reply,
  });
  if (!completed) {
    const current = await getReplacement(env, ticket.id);
    return current?.status === 'succeeded' || current?.status === 'orphan' ? current.status : 'pending';
  }
  await sendReplacementMail(env, ticket.id, originUrl).catch(() => undefined);
  return 'succeeded';
}

export async function sendReplacementMail(env: Env, ticketId: number, originUrl: string, retry = false) {
  const db = createDb(env.DB);
  const row = await getReplacement(env, ticketId);
  if (row?.status !== 'succeeded' || !row.replacementOrderNo) throw new Error('换新尚未交付');
  if (row.replacementMailStatus === 'sent') return { mailStatus: 'sent' };
  const order = await findOrderByNo(db, row.replacementOrderNo);
  if (order && !order.publicOrderNo) return { mailStatus: 'disabled' };
  if (order?.status !== 'delivered') throw new Error('原订单当前无法补发邮件');
  const ownerAgentId = order.agentId ?? 0;
  const cards = safeJsonParse<string[]>(
    await readStoredCredential(env, row.cardsJson, `upstream-cards:${row.id}`),
    []
  );
  if (retry) {
    await retryReplacementMailRepo(db, ownerAgentId, `order_replacement:${order.publicOrderNo}:${row.id}`);
  }
  const tenantQuery = order.tenantSlug ? `?tenant=${encodeURIComponent(order.tenantSlug)}` : '';
  const result = await dispatchOrderDeliveryEmail(env, {
    ownerAgentId,
    brandName: await resolveOrderBrandNameRepo(db, ownerAgentId),
    toEmail: order.contactEmail,
    orderNo: order.publicOrderNo || '',
    productTitle: order.productTitle,
    specName: order.specName,
    quantity: row.quantity,
    totalAmount: 0,
    deliveredPayload: cards.join('\n'),
    lookupUrl: `${originUrl.replace(/\/$/, '')}/orders${tenantQuery}`,
    scene: 'order_replacement',
    eventKey: String(row.id),
  }).catch(() => ({ mail_status: 'failed' }));
  await rememberReplacementMailStatusRepo(db, row.id, result.mail_status);
  return { mailStatus: result.mail_status };
}

export async function procureAfterSaleReplacementForTicket(
  env: Env,
  params: { ticketId: number; quantity?: number; specificSourceId?: number; note?: string; originUrl: string }
) {
  const db = createDb(env.DB);
  const ticket = await findSupportTicketByIdRepo(db, params.ticketId);
  if (!ticket) throw new Error('工单不存在');
  const existing = await getReplacement(env, ticket.id);
  if (existing) return toReceipt(existing);
  const order = ticket.orderNo ? await findOrderByNo(db, ticket.orderNo) : null;
  if (!isOriginalDelivery(order, ticket) || !(await hasConfirmedPayment(db, order))) {
    throw new Error('仅支持已付款且完成交付的关联原订单换新');
  }
  if (
    !['open', 'escalated', 'agent_replied', 'admin_replied'].includes(ticket.status) ||
    ticket.category !== 'after_sale' ||
    order.warrantyType === 'none'
  ) {
    throw new Error('该工单或原订单不具备换新资格');
  }
  const quantity = params.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > order.quantity) {
    throw new Error(`单次换新数量须为 1 至 ${order.quantity} 的整数`);
  }
  const [candidate] = await getCandidateBindingsForSpec(env, order.productId, order.specId, quantity, {
    specificSourceId: params.specificSourceId,
  });
  if (!candidate) throw new Error('原规格暂时没有可换新的货源');
  const operationNo = `${order.orderNo}-RP-${ticket.id}`;
  const assetCost = Number((candidate.cached_cost * quantity).toFixed(2));
  const [row] = await db
    .insert(upstreamOrders)
    .values({
      localOrderNo: operationNo,
      idempotencyOutTradeNo: operationNo,
      sourceId: candidate.source_id,
      sourceName: candidate.source.name,
      bindingId: candidate.binding_id,
      productId: order.productId,
      specId: order.specId,
      upstreamItemId: candidate.upstream_item_id,
      upstreamSpecId: candidate.upstream_spec_id,
      quantity,
      upstreamCost: assetCost,
      purpose: 'after_sale_replace',
      status: 'pending',
      replacementTicketId: ticket.id,
      replacementOrderNo: order.orderNo,
      replacementNote: params.note?.trim().slice(0, 3000) || null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const accepted = await getReplacement(env, ticket.id);
    if (!accepted) throw new Error('换新采购锁定失败，请核对原工单');
    return toReceipt(accepted);
  }
  const result = await placeUpstreamOrder(env, candidate.source, {
    upstreamItemId: row.upstreamItemId,
    upstreamSpecId: row.upstreamSpecId,
    quantity,
    outTradeNo: operationNo,
    contactEmail: order.contactEmail,
    webhookUrl: `${params.originUrl.replace(/\/$/, '')}/api/webhooks/upstream/${candidate.source_id}`,
    unitCostHint: candidate.cached_cost,
  }).catch(() => ({
    status: 'timeout_unknown' as const,
    upstreamOrderNo: '',
    cards: [],
    actualCost: assetCost,
    errorMessage: '供应商是否受理尚待确认',
  }));
  if (result.status === 'succeeded' && hasCompleteUpstreamUnits(result.cards, quantity)) {
    await deliverReplacementPurchase(
      env,
      row,
      result.cards,
      result.upstreamOrderNo,
      result.actualCost,
      params.originUrl
    );
  } else {
    await updateUpstreamOrderRepo(env, row.id, {
      status: result.status === 'succeeded' ? 'pending' : result.status,
      upstreamOrderNo: result.upstreamOrderNo,
      errorMessage: result.errorMessage,
    });
  }
  const receipt = (await getReplacement(env, ticket.id)) ?? row;
  return toReceipt(receipt, receipt.status === 'succeeded' ? result.cards : []);
}
