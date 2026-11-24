import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import {
  type GroupBuyMemberRow,
  type GroupBuySessionRow,
  groupBuyMembers,
  groupBuySessions,
  products,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export async function createGroupBuySessionRepo(
  db: AppDatabase,
  row: typeof groupBuySessions.$inferInsert
): Promise<GroupBuySessionRow> {
  const [created] = await db.insert(groupBuySessions).values(row).returning();
  return created;
}

export async function findGroupBuySessionByIdRepo(
  db: AppDatabase,
  id: number
): Promise<GroupBuySessionRow | null> {
  const rows = await db.select().from(groupBuySessions).where(eq(groupBuySessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findGroupBuySessionByCodeRepo(
  db: AppDatabase,
  code: string
): Promise<GroupBuySessionRow | null> {
  const rows = await db
    .select()
    .from(groupBuySessions)
    .where(eq(groupBuySessions.code, code.trim().toUpperCase()))
    .limit(1);
  return rows[0] ?? null;
}

export async function listOpenGroupBuySessionsForProductRepo(
  db: AppDatabase,
  siteAgentId: number,
  productId: number,
  nowIso: string
): Promise<GroupBuySessionRow[]> {
  return db
    .select()
    .from(groupBuySessions)
    .where(
      and(
        eq(groupBuySessions.siteAgentId, siteAgentId),
        eq(groupBuySessions.productId, productId),
        eq(groupBuySessions.status, 'open'),
        gt(groupBuySessions.expiresAt, nowIso)
      )
    )
    .orderBy(asc(groupBuySessions.expiresAt), desc(groupBuySessions.currentSize))
    .limit(20);
}

export async function findGroupBuyMemberByUserRepo(
  db: AppDatabase,
  sessionId: number,
  userId: number
): Promise<GroupBuyMemberRow | null> {
  const rows = await db
    .select()
    .from(groupBuyMembers)
    .where(and(eq(groupBuyMembers.sessionId, sessionId), eq(groupBuyMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findGroupBuyMemberByOrderNoRepo(
  db: AppDatabase,
  orderNo: string
): Promise<GroupBuyMemberRow | null> {
  const rows = await db.select().from(groupBuyMembers).where(eq(groupBuyMembers.orderNo, orderNo)).limit(1);
  return rows[0] ?? null;
}

export async function listGroupBuyMembersRepo(
  db: AppDatabase,
  sessionId: number
): Promise<GroupBuyMemberRow[]> {
  return db
    .select()
    .from(groupBuyMembers)
    .where(eq(groupBuyMembers.sessionId, sessionId))
    .orderBy(asc(groupBuyMembers.id));
}

/** 原子增加拼团人数（仅当团仍处于 open 且未满员且未过期） */
export async function joinGroupBuySessionAtomicRepo(
  db: AppDatabase,
  params: {
    sessionId: number;
    userId: number;
    orderNo: string;
    email: string;
    paidAmount: number;
    promoUsedAmount: number;
    nowIso: string;
  }
): Promise<{ joined: boolean; session: GroupBuySessionRow | null }> {
  const updated = await db
    .update(groupBuySessions)
    .set({ currentSize: sql`${groupBuySessions.currentSize} + 1` })
    .where(
      and(
        eq(groupBuySessions.id, params.sessionId),
        eq(groupBuySessions.status, 'open'),
        lt(groupBuySessions.currentSize, groupBuySessions.requiredSize),
        gt(groupBuySessions.expiresAt, params.nowIso)
      )
    )
    .returning();
  if (!updated[0]) {
    return { joined: false, session: null };
  }
  await db
    .insert(groupBuyMembers)
    .values({
      sessionId: params.sessionId,
      userId: params.userId,
      orderNo: params.orderNo,
      email: params.email,
      paidAmount: params.paidAmount,
      promoUsedAmount: params.promoUsedAmount,
      status: 'paid',
    })
    .onConflictDoNothing();
  return { joined: true, session: updated[0] };
}

/** CAS 原子成团（open -> completed），防止并发最后两人同时触发重复发卡 */
export async function markGroupBuyCompletedCasRepo(
  db: AppDatabase,
  sessionId: number,
  nowIso: string
): Promise<GroupBuySessionRow | null> {
  const rows = await db
    .update(groupBuySessions)
    .set({ status: 'completed', completedAt: nowIso })
    .where(
      and(
        eq(groupBuySessions.id, sessionId),
        eq(groupBuySessions.status, 'open'),
        sql`${groupBuySessions.currentSize} >= ${groupBuySessions.requiredSize}`
      )
    )
    .returning();
  return rows[0] ?? null;
}

/** 扫描已超时的未成团拼团场次 */
export async function listExpiredOpenGroupBuysRepo(
  db: AppDatabase,
  nowIso: string
): Promise<GroupBuySessionRow[]> {
  return db
    .select()
    .from(groupBuySessions)
    .where(and(eq(groupBuySessions.status, 'open'), lte(groupBuySessions.expiresAt, nowIso)))
    .limit(50);
}

/** CAS 将超时未成团的拼团置为 expired_refunded */
export async function lockExpiredGroupBuyCasRepo(db: AppDatabase, sessionId: number): Promise<boolean> {
  const rows = await db
    .update(groupBuySessions)
    .set({ status: 'expired_refunded' })
    .where(and(eq(groupBuySessions.id, sessionId), eq(groupBuySessions.status, 'open')))
    .returning({ id: groupBuySessions.id });
  return rows.length > 0;
}

export async function updateGroupBuyMemberStatusRepo(
  db: AppDatabase,
  memberId: number,
  status: 'paid' | 'fulfilled' | 'refunded'
): Promise<void> {
  await db.update(groupBuyMembers).set({ status }).where(eq(groupBuyMembers.id, memberId));
}

/** 限时秒杀成交原子递增已售名额（若设置限量，超限时返回 false） */
export async function claimFlashSaleQuotaAtomicRepo(
  db: AppDatabase,
  productId: number,
  qty: number
): Promise<boolean> {
  const rows = await db
    .update(products)
    .set({ flashSaleSold: sql`${products.flashSaleSold} + ${qty}` })
    .where(
      and(
        eq(products.id, productId),
        sql`(${products.flashSaleLimit} <= 0 OR ${products.flashSaleSold} + ${qty} <= ${products.flashSaleLimit})`
      )
    )
    .returning({ id: products.id });
  return rows.length > 0;
}
