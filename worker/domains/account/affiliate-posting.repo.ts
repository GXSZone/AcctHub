import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { affiliateLedgers, agents, orders, users, walletEvents } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { loadAffiliateConfigRepo } from './affiliate.repo';
import { accountCanPost, commitWalletEvent, promoPosting, walletEventKey } from './wallet-event.repo';

export async function listUnsettledAffiliateOrders(db: AppDatabase) {
  return db
    .select({ reward: affiliateLedgers })
    .from(affiliateLedgers)
    .innerJoin(orders, eq(orders.orderNo, affiliateLedgers.orderNo))
    .innerJoin(users, eq(users.id, affiliateLedgers.referrerUserId))
    .where(and(eq(affiliateLedgers.status, 'pending'), inArray(orders.status, ['paid', 'delivered'])))
    .orderBy(asc(affiliateLedgers.id))
    .limit(30);
}

export function findAffiliateReward(db: AppDatabase, orderNo: string) {
  return db.select().from(affiliateLedgers).where(eq(affiliateLedgers.orderNo, orderNo)).get();
}

/** 生成与订单完成写入一并提交的待发记录，金额和比例此后固定。 */
export async function prepareAffiliateRewardAfterOrderFinalization(
  db: AppDatabase,
  orderNo: string,
  status: string | undefined
) {
  if (status !== 'paid' && status !== 'delivered') return [];
  const orderMeta = await db
    .select({ agentId: orders.agentId })
    .from(orders)
    .where(eq(orders.orderNo, orderNo))
    .get();
  const siteId = Number(orderMeta?.agentId ?? 0);
  const config = await loadAffiliateConfigRepo(db, siteId);
  if (!config.enabled || config.commissionRate <= 0) return [];
  const paid = sql`round(${orders.totalAmount}, 2)`;
  const rawReward = sql`round(${paid} * ${config.commissionRate}, 2)`;
  const reward = config.maxReward > 0 ? sql`round(min(${rawReward}, ${config.maxReward}), 2)` : rawReward;
  const referrerScope =
    siteId > 0
      ? sql`(referrer.site_agent_id = ${siteId} or exists (select 1 from ${agents} where ${agents.id} = ${siteId} and ${agents.userId} = referrer.id and ${agents.status} = 'active'))`
      : sql`referrer.site_agent_id = 0`;
  return [
    db
      .insert(affiliateLedgers)
      .select(sql`
      select null, referrer.id, buyer.id, ${orders.orderNo}, ${paid}, ${config.commissionRate}, ${reward},
        0, 'pending', datetime('now')
      from ${orders}
      join ${users} buyer on buyer.id = ${orders.userId}
      join ${users} referrer on referrer.id = buyer.referred_by_user_id
      where ${orders.orderNo} = ${orderNo} and ${orders.status} = ${status}
        and ${orders.channel} = 'web' and coalesce(${orders.agentId}, 0) = ${siteId}
        and buyer.site_agent_id = ${siteId} and ${referrerScope}
        and buyer.role = 'user' and buyer.id <> referrer.id
        and ${paid} + 0.001 >= ${config.minOrderAmount} and ${reward} >= 0.01
    `)
      .onConflictDoNothing({ target: affiliateLedgers.orderNo }),
  ];
}

type AffiliateReward = Pick<
  typeof affiliateLedgers.$inferSelect,
  'referrerUserId' | 'buyerUserId' | 'orderNo' | 'orderAmount' | 'commissionRate' | 'rewardAmount'
>;

export async function reserveOrderPromoAtomically(
  db: AppDatabase,
  input: { userId: number; maxAmount: number; orderNo: string; note: string }
) {
  const available = db
    .select({ amount: sql<number>`max(0, min(${input.maxAmount}, round(${users.promoBalance}, 2)))` })
    .from(users)
    .where(eq(users.id, input.userId));
  const amount = sql<number>`(${available})`;
  const reserveOrder = and(
    eq(orders.orderNo, input.orderNo),
    eq(orders.userId, input.userId),
    eq(orders.status, 'processing')
  );
  const ref = walletEventKey('promo-spend', input.orderNo, input.userId);
  const event = await commitWalletEvent(
    db,
    {
      eventKey: ref,
      amount,
      when: and(
        sql`${amount} >= 0.01`,
        exists(db.select({ id: orders.id }).from(orders).where(reserveOrder))
      ),
    },
    (owned) => {
      const postedAmount = db
        .select({ amount: walletEvents.amount })
        .from(walletEvents)
        .where(eq(walletEvents.eventKey, ref));
      return [
        ...promoPosting(db, owned, {
          ...input,
          amount: sql`-(${postedAmount})`,
          type: 'spend',
          refNo: input.orderNo,
        }),
        db
          .update(orders)
          .set({
            promoUsedAmount: sql`(${postedAmount})`,
            totalAmount: sql`round(${input.maxAmount} - (${postedAmount}), 2)`,
          })
          .where(and(reserveOrder, owned)),
      ];
    }
  );
  return event.amount ?? 0;
}

export async function postAffiliateRewardAtomically(db: AppDatabase, input: AffiliateReward) {
  const eligibleOrder = exists(
    db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.orderNo, input.orderNo), inArray(orders.status, ['paid', 'delivered'])))
  );
  const pending = and(
    eq(affiliateLedgers.orderNo, input.orderNo),
    eq(affiliateLedgers.status, 'pending'),
    eq(affiliateLedgers.referrerUserId, input.referrerUserId),
    eq(affiliateLedgers.rewardAmount, input.rewardAmount)
  );
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('affiliate-reward', input.orderNo),
      amount: input.rewardAmount,
      when: and(
        eligibleOrder,
        accountCanPost(db, input.referrerUserId, input.rewardAmount, true),
        exists(db.select({ id: affiliateLedgers.id }).from(affiliateLedgers).where(pending))
      ),
    },
    (owned) => [
      ...promoPosting(db, owned, {
        userId: input.referrerUserId,
        type: 'reward',
        amount: input.rewardAmount,
        refNo: input.orderNo,
        note: `受邀好友消费实付 ¥${input.orderAmount.toFixed(2)} 推广返佣 (${(input.commissionRate * 100).toFixed(1)}%)`,
      }),
      db.update(affiliateLedgers).set({ status: 'settled' }).where(and(pending, owned)),
    ]
  );
  return event.applied;
}
