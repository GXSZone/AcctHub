import { and, asc, eq, exists, inArray, lte, sql } from 'drizzle-orm';
import { mailOutbox, orders, restockSubscriptions, upstreamOrders } from '../db/schema/index';
import type { AppDatabase } from './db';
import type { MailMessage } from './mail';

export type OutboxStatus = 'pending' | 'sent' | 'disabled' | 'failed';
export type OutboxRow = typeof mailOutbox.$inferSelect;

export async function enqueueMailRepo(
  db: AppDatabase,
  ownerAgentId: number,
  eventKey: string,
  scene: MailMessage['scene'],
  payload: string
): Promise<void> {
  await db
    .insert(mailOutbox)
    .values({ ownerAgentId, eventKey, scene, payload })
    .onConflictDoNothing({
      target: [mailOutbox.ownerAgentId, mailOutbox.eventKey],
    });
}

export async function claimDueMailRepo(
  db: AppDatabase,
  now: number,
  leaseUntil: number,
  limit: number,
  selector?: { owner: number; key: string }
) {
  const due = db
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(
      and(
        eq(mailOutbox.status, 'pending'),
        lte(mailOutbox.nextAttemptAt, now),
        lte(mailOutbox.leaseUntil, now),
        selector ? eq(mailOutbox.ownerAgentId, selector.owner) : undefined,
        selector ? eq(mailOutbox.eventKey, selector.key) : undefined
      )
    )
    .orderBy(asc(mailOutbox.nextAttemptAt), asc(mailOutbox.id))
    .limit(limit);
  return db
    .update(mailOutbox)
    .set({ leaseUntil, leaseToken: crypto.randomUUID(), attempts: sql`${mailOutbox.attempts} + 1` })
    .where(inArray(mailOutbox.id, due))
    .returning();
}

export async function findMailOutboxStatusRepo(db: AppDatabase, ownerAgentId: number, eventKey: string) {
  const [row] = await db
    .select({ status: mailOutbox.status, lastError: mailOutbox.lastError })
    .from(mailOutbox)
    .where(and(eq(mailOutbox.ownerAgentId, ownerAgentId), eq(mailOutbox.eventKey, eventKey)))
    .limit(1);
  return row;
}

export async function requeueOrderMailRepo(
  db: AppDatabase,
  orderId: number,
  ownerAgentId: number,
  publicOrderNo: string
) {
  const [pending] = await db
    .select({ eventKey: mailOutbox.eventKey })
    .from(mailOutbox)
    .where(
      and(
        eq(mailOutbox.orderId, orderId),
        eq(mailOutbox.ownerAgentId, ownerAgentId),
        inArray(mailOutbox.scene, ['order_delivery', 'order_resend']),
        eq(mailOutbox.status, 'pending')
      )
    )
    .orderBy(asc(mailOutbox.id))
    .limit(1);
  if (pending) {
    await db
      .update(mailOutbox)
      .set({ nextAttemptAt: 0 })
      .where(
        and(
          eq(mailOutbox.ownerAgentId, ownerAgentId),
          eq(mailOutbox.eventKey, pending.eventKey),
          eq(mailOutbox.status, 'pending')
        )
      );
    return pending.eventKey;
  }
  const eventKey = `order_resend:${publicOrderNo}:${Math.floor(Date.now() / 60_000)}`;
  await db
    .insert(mailOutbox)
    .values({ ownerAgentId, orderId, eventKey, scene: 'order_resend' })
    .onConflictDoNothing({ target: [mailOutbox.ownerAgentId, mailOutbox.eventKey] });
  return eventKey;
}

export async function findMailOrderRepo(db: AppDatabase, orderId: number, ownerAgentId: number) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), sql`coalesce(${orders.agentId}, 0) = ${ownerAgentId}`))
    .limit(1);
  return row;
}

export async function findMailSubscriptionRepo(
  db: AppDatabase,
  subscriptionId: number,
  ownerAgentId: number,
  cycle: number
) {
  const [row] = await db
    .select({ email: restockSubscriptions.email })
    .from(restockSubscriptions)
    .where(
      and(
        eq(restockSubscriptions.id, subscriptionId),
        eq(restockSubscriptions.siteAgentId, ownerAgentId),
        eq(restockSubscriptions.cycle, cycle),
        eq(restockSubscriptions.status, 'queued')
      )
    )
    .limit(1);
  return row;
}

export async function finishMailOutboxRepo(
  db: AppDatabase,
  row: OutboxRow,
  status: OutboxStatus,
  error: string,
  nextAttemptAt: number
) {
  const activeLease = and(eq(mailOutbox.id, row.id), eq(mailOutbox.leaseToken, row.leaseToken));
  const update = db
    .update(mailOutbox)
    .set({
      status,
      nextAttemptAt,
      leaseUntil: 0,
      lastError: error,
      ...(status === 'pending' ? {} : { payload: '' }),
    })
    .where(and(activeLease, eq(mailOutbox.status, 'pending')));
  if (status !== 'sent') {
    await update;
    return;
  }
  const sent = db
    .select({ id: mailOutbox.id })
    .from(mailOutbox)
    .where(and(activeLease, eq(mailOutbox.status, 'sent')));
  if (row.scene === 'order_replacement') {
    const purchaseId = Number(row.eventKey.slice(row.eventKey.lastIndexOf(':') + 1));
    if (Number.isSafeInteger(purchaseId) && purchaseId > 0) {
      const originalOrder = db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.orderNo, upstreamOrders.replacementOrderNo),
            sql`coalesce(${orders.agentId}, 0) = ${row.ownerAgentId}`,
            sql`'order_replacement:' || ${orders.publicOrderNo} || ':' || ${upstreamOrders.id} = ${row.eventKey}`
          )
        );
      await db.batch([
        update,
        db
          .update(upstreamOrders)
          .set({ replacementMailStatus: 'sent' })
          .where(
            and(
              eq(upstreamOrders.id, purchaseId),
              eq(upstreamOrders.purpose, 'after_sale_replace'),
              eq(upstreamOrders.status, 'succeeded'),
              exists(originalOrder),
              exists(sent)
            )
          ),
      ]);
      return;
    }
  }
  if (row.subscriptionId === null || row.subscriptionCycle === null) {
    await update;
    return;
  }
  await db.batch([
    update,
    db
      .update(restockSubscriptions)
      .set({ status: 'notified', notifiedAt: sql`datetime('now')` })
      .where(
        and(
          eq(restockSubscriptions.id, row.subscriptionId),
          eq(restockSubscriptions.siteAgentId, row.ownerAgentId),
          eq(restockSubscriptions.cycle, row.subscriptionCycle),
          eq(restockSubscriptions.status, 'queued'),
          exists(sent)
        )
      ),
  ]);
}
