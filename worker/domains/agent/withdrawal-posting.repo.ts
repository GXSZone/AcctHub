import { and, eq, exists, sql } from 'drizzle-orm';
import { agents, agentWithdrawals, walletEvents } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { getUserBalance } from '../account/wallet.repo';
import {
  accountCanPost,
  commitWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';

export async function createWithdrawalWithWalletPosting(
  db: AppDatabase,
  input: {
    agentId: number;
    userId: number;
    amount: number;
    feeRate: number;
    feeAmount: number;
    netAmount: number;
    channel: string;
    accountInfo: string;
    accountName: string;
  }
) {
  const { agentId, userId, amount, feeRate, feeAmount, netAmount, channel, accountInfo, accountName } = input;
  const eventKey = walletEventKey('withdrawal-create', crypto.randomUUID());
  const createdId = db
    .select({ id: walletEvents.amount })
    .from(walletEvents)
    .where(eq(walletEvents.eventKey, eventKey));
  const activeAgent = db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId), eq(agents.status, 'active')));
  const feeNote =
    feeAmount > 0 ? `（手续费 ${feeRate}% = ¥${feeAmount.toFixed(2)}，实付 ¥${netAmount.toFixed(2)}）` : '';
  const event = await commitWalletEvent(
    db,
    {
      eventKey,
      when: and(exists(activeAgent), accountCanPost(db, userId, -amount)),
    },
    (owned) => [
      db.insert(agentWithdrawals).select(sql`
      select null, ${agentId}, ${userId}, ${amount}, ${channel}, ${accountInfo}, ${accountName},
      'pending', '', datetime('now'), null, ${feeRate}, ${feeAmount}, ${netAmount} where ${owned}
    `),
      // 保存刚生成的业务编号，使流水仍使用既有的 WD-编号关联。
      db
        .update(walletEvents)
        .set({ amount: sql`last_insert_rowid()` })
        .where(and(eq(walletEvents.eventKey, eventKey), owned)),
      ...walletPosting(db, owned, {
        userId,
        amount: -amount,
        type: 'withdraw',
        refNo: sql`'WD-' || cast((${createdId}) as integer)`,
        note: `申请收益提现（${channel}）${feeNote}`,
      }),
    ]
  );
  return event.applied && event.amount
    ? { id: event.amount, balance: await getUserBalance(db, userId) }
    : null;
}

export async function rejectWithdrawalWithWalletPosting(
  db: AppDatabase,
  withdrawal: typeof agentWithdrawals.$inferSelect,
  adminNote: string
) {
  const { id, userId, amount } = withdrawal;
  const pending = and(eq(agentWithdrawals.id, id), eq(agentWithdrawals.status, 'pending'));
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('withdrawal-reject', id),
      amount,
      when: and(
        accountCanPost(db, userId, amount),
        exists(db.select({ id: agentWithdrawals.id }).from(agentWithdrawals).where(pending))
      ),
    },
    (owned) => [
      ...walletPosting(db, owned, {
        userId,
        amount,
        type: 'withdraw_refund',
        refNo: `WD-${id}`,
        note: `提现申请被驳回，自动退回余额（${adminNote || '审核未通过'}）`,
      }),
      db
        .update(agentWithdrawals)
        .set({ status: 'rejected', adminNote, processedAt: sql`datetime('now')` })
        .where(and(pending, owned)),
    ]
  );
  return event.applied;
}
