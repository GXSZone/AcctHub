import { roundCurrency } from '@shared/domain/money';
import { and, eq, exists, gte, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { promoTransactions, users, walletEvents, walletTransactions } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import type { WalletTxType } from './wallet.repo';

type Statement = BatchItem<'sqlite'>;

/** 资金事件唯一键以业务事实和用途组合，同一笔业务的不同用途使用不同键。 */
export function walletEventKey(kind: string, ...parts: (string | number)[]): string {
  return JSON.stringify([kind, ...parts]);
}

export async function readWalletEvent(db: AppDatabase, eventKey: string) {
  return db
    .select({ amount: walletEvents.amount })
    .from(walletEvents)
    .where(eq(walletEvents.eventKey, eventKey))
    .get();
}

/**
 * 将唯一事件、余额、台账和业务状态提交到同一个 D1 batch。
 * 每条业务写入都须加 owned 条件；命中本次事件时，所有必需写入都必须恰好影响一行。
 */
export async function commitWalletEvent(
  db: AppDatabase,
  input: { eventKey: string; amount?: number | SQL; when?: SQL },
  steps: (owned: SQL) => (Statement | { statement: Statement; optional: true })[]
): Promise<{ applied: boolean; amount: number | null }> {
  const attemptId = crypto.randomUUID();
  const match = and(eq(walletEvents.eventKey, input.eventKey), eq(walletEvents.attemptId, attemptId));
  const owned = exists(db.select({ value: sql`1` }).from(walletEvents).where(match));
  const claim = db
    .insert(walletEvents)
    .select(sql`
    select ${input.eventKey}, ${attemptId}, ${input.amount ?? 0}, datetime('now')
    where ${input.when ?? sql`1`}
  `)
    .onConflictDoNothing({ target: walletEvents.eventKey });
  const statements: Statement[] = [];
  for (const step of steps(owned)) {
    if ('optional' in step) {
      statements.push(step.statement);
    } else {
      statements.push(step);
      // SQLite changes() 读取同一批次中紧邻的写入结果。违反 NOT NULL 会回滚整批。
      statements.push(
        db
          .update(walletEvents)
          .set({ attemptId: sql`case when changes() = 1 then ${attemptId} else null end` })
          .where(match)
      );
    }
  }
  const resultQuery = db
    .select({ attemptId: walletEvents.attemptId, amount: walletEvents.amount })
    .from(walletEvents)
    .where(eq(walletEvents.eventKey, input.eventKey));
  // 各条写入失败时 D1 会回滚，尾部读取同时区分首次提交、已提交重放和前置条件未满足。
  const results = await db.batch([claim, ...statements, resultQuery]);
  const result = results.at(-1) as Awaited<typeof resultQuery>;
  const receipt = result[0];
  return { applied: receipt?.attemptId === attemptId, amount: receipt?.amount ?? null };
}

type LedgerPosting = {
  userId: number;
  amount: number | SQL;
  type: WalletTxType;
  refNo: string | SQL;
  note: string;
};

type PromoPosting = Omit<LedgerPosting, 'type'> & { type: 'reward' | 'spend' | 'refund' | 'clawback' };

export function accountCanPost(db: AppDatabase, userId: number, amount: number, promo = false): SQL {
  return exists(
    db
      .select({ value: sql`1` })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          amount < 0 ? gte(promo ? users.promoBalance : users.balance, -roundCurrency(amount)) : undefined
        )
      )
  );
}

function postingSteps(
  db: AppDatabase,
  owned: SQL,
  input: LedgerPosting | PromoPosting,
  promo: boolean
): Statement[] {
  const balance = promo ? users.promoBalance : users.balance;
  const amount = typeof input.amount === 'number' ? roundCurrency(input.amount) : input.amount;
  if (typeof amount === 'number' && (!Number.isFinite(input.amount) || !amount)) {
    throw new Error('资金事件金额必须为非零有限值');
  }
  const update = db
    .update(users)
    .set(
      promo
        ? { promoBalance: sql`round(${balance} + ${amount}, 2)` }
        : { balance: sql`round(${balance} + ${amount}, 2)` }
    )
    .where(and(eq(users.id, input.userId), owned, gte(balance, sql`max(0, -(${amount}))`)));
  const row = db
    .select({
      id: sql`null`.as('id'),
      userId: users.id,
      type: sql`${input.type}`.as('type'),
      amount: sql`${amount}`.as('amount'),
      balanceAfter: balance,
      refNo: sql`${typeof input.refNo === 'string' ? input.refNo.slice(0, 64) : input.refNo}`.as('ref_no'),
      note: sql`${input.note.slice(0, promo ? 200 : 240)}`.as('note'),
      createdAt: sql`datetime('now')`.as('created_at'),
    })
    .from(users)
    .where(and(eq(users.id, input.userId), owned));
  return [update, (promo ? db.insert(promoTransactions) : db.insert(walletTransactions)).select(row)];
}

export function walletPosting(db: AppDatabase, owned: SQL, input: LedgerPosting): Statement[] {
  return postingSteps(db, owned, input, false);
}

export function promoPosting(db: AppDatabase, owned: SQL, input: PromoPosting): Statement[] {
  return postingSteps(db, owned, input, true);
}
