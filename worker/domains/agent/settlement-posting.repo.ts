import { and, eq, exists, inArray, type SQL, sql } from 'drizzle-orm';
import { agents, commissionLedger, orders } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import {
  accountCanPost,
  commitWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';

export type CommissionPosting = Omit<typeof commissionLedger.$inferInsert, 'id' | 'createdAt'> & {
  userId: number;
  revenue: number;
  walletNote: string;
  amount: number;
};

export async function listPostedCommissions(db: AppDatabase, orderNo: string) {
  return db
    .select()
    .from(commissionLedger)
    .where(
      and(
        eq(commissionLedger.orderNo, orderNo),
        inArray(commissionLedger.rewardType, [
          'direct_sale',
          'b2b_wholesale_spread',
          'differential_override',
          'tier_upgrade_fee',
        ])
      )
    );
}

/** 单一订单分润计划整体提交，恢复时复用已提交金额。 */
export async function postAgentCommissions(
  db: AppDatabase,
  input: { orderNo: string; postings: CommissionPosting[]; amount: number; guard?: SQL; upgrade?: boolean }
) {
  const { orderNo, amount, upgrade, guard, postings } = input;
  const eligibleOrder = and(
    eq(orders.orderNo, orderNo),
    inArray(orders.status, ['processing', 'upstream_pending', 'paid', 'delivered'])
  );
  return commitWalletEvent(
    db,
    {
      eventKey: walletEventKey(upgrade ? 'agent-upgrade-commission' : 'order-commissions', orderNo),
      amount,
      when: and(
        guard,
        upgrade ? undefined : exists(db.select({ id: orders.id }).from(orders).where(eligibleOrder)),
        ...postings.map((entry) => accountCanPost(db, entry.userId, entry.amount))
      ),
    },
    (owned) => [
      ...postings.flatMap((entry) => [
        db
          .update(agents)
          .set({
            totalRevenue: sql`round(${agents.totalRevenue} + ${entry.revenue}, 2)`,
            totalCommission: sql`round(${agents.totalCommission} + ${entry.amount}, 2)`,
          })
          .where(and(eq(agents.id, entry.beneficiaryAgentId), eq(agents.userId, entry.userId), owned)),
        ...(!entry.amount
          ? []
          : walletPosting(db, owned, {
              userId: entry.userId,
              type: 'commission',
              amount: entry.amount,
              refNo: orderNo,
              note: entry.walletNote,
            })),
        db.insert(commissionLedger).select(sql`
        select null, ${orderNo}, ${entry.beneficiaryAgentId}, ${entry.sourceAgentId},
        ${entry.hopDistance ?? 0}, ${entry.rewardType ?? 'direct_sale'}, ${entry.amount},
        ${entry.note ?? ''}, datetime('now') where ${owned}
      `),
      ]),
      ...(upgrade
        ? []
        : [db.update(orders).set({ commissionAmount: amount }).where(and(eligibleOrder, owned))]),
    ]
  );
}
