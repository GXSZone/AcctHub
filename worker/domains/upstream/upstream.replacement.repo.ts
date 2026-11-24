import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { mailOutbox, orders, supportTickets, ticketMessages, upstreamOrders } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

const pending = inArray(upstreamOrders.status, ['pending', 'timeout_unknown']);

export async function orphanReplacementRepo(
  db: AppDatabase,
  purchaseId: number,
  data: {
    upstreamOrderNo: string;
    upstreamCost: number;
    cardsJson: string;
  }
) {
  await db
    .update(upstreamOrders)
    .set({ ...data, status: 'orphan', errorMessage: '原交付或发起工单需人工核对' })
    .where(and(eq(upstreamOrders.id, purchaseId), pending));
}

export async function completeReplacementRepo(
  db: AppDatabase,
  input: {
    purchaseId: number;
    orderNo: string;
    ticketId: number;
    previousDelivery: string;
    newDelivery: string;
    cardsJson: string;
    upstreamOrderNo: string;
    actualCost: number;
    reply: string;
  }
) {
  const token = crypto.randomUUID();
  const ownsWrite = sql`EXISTS (SELECT 1 FROM upstream_orders WHERE id = ${input.purchaseId}
    AND replacement_settlement_token = ${token})`;
  const verifiesOrder = sql`EXISTS (SELECT 1 FROM orders WHERE order_no = ${input.orderNo}
    AND status = 'delivered' AND delivered_payload = ${input.previousDelivery})`;
  const verifiesTicket = sql`EXISTS (SELECT 1 FROM support_tickets WHERE id = ${input.ticketId}
    AND order_no = ${input.orderNo} AND status <> 'closed')`;
  const result = await db.batch([
    db
      .update(upstreamOrders)
      .set({
        status: 'succeeded',
        upstreamOrderNo: input.upstreamOrderNo,
        upstreamCost: input.actualCost,
        cardsJson: input.cardsJson,
        replacementSettlementToken: token,
        replacementMailStatus: 'pending',
        errorMessage: '',
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(upstreamOrders.id, input.purchaseId), pending, verifiesOrder, verifiesTicket)),
    db
      .update(orders)
      .set({
        deliveredPayload: input.newDelivery,
        upstreamCostTotal: sql`round(${orders.upstreamCostTotal} + ${input.actualCost}, 2)`,
      })
      .where(and(eq(orders.orderNo, input.orderNo), ownsWrite)),
    db.insert(ticketMessages).select(
      db
        .select({
          id: sql<number>`NULL`.as('id'),
          ticketId: sql<number>`${input.ticketId}`.as('ticket_id'),
          senderRole: sql<string>`'admin'`.as('sender_role'),
          senderName: sql<string>`'平台总控客服'`.as('sender_name'),
          content: sql<string>`${input.reply}`.as('content'),
          createdAt: sql<string>`datetime('now')`.as('created_at'),
        })
        .from(upstreamOrders)
        .where(
          and(eq(upstreamOrders.id, input.purchaseId), eq(upstreamOrders.replacementSettlementToken, token))
        )
    ),
    db
      .update(supportTickets)
      .set({ status: 'resolved', updatedAt: sql`datetime('now')` })
      .where(and(eq(supportTickets.id, input.ticketId), ownsWrite)),
  ]);
  return (result[0].meta.changes ?? 0) > 0;
}

export async function retryReplacementMailRepo(db: AppDatabase, ownerAgentId: number, eventKey: string) {
  await db
    .update(mailOutbox)
    .set({ status: 'pending', nextAttemptAt: 0, attempts: 0 })
    .where(
      and(
        eq(mailOutbox.ownerAgentId, ownerAgentId),
        eq(mailOutbox.eventKey, eventKey),
        inArray(mailOutbox.status, ['failed', 'disabled'])
      )
    );
}

export async function rememberReplacementMailStatusRepo(db: AppDatabase, purchaseId: number, status: string) {
  await db
    .update(upstreamOrders)
    .set({ replacementMailStatus: status })
    .where(and(eq(upstreamOrders.id, purchaseId), ne(upstreamOrders.replacementMailStatus, 'sent')));
}
