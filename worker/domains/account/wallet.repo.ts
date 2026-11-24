import type { WalletTxType } from '@shared/constants/enums';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { users, walletTransactions } from '../../db/schema/index';
import type { Env } from '../../env';
import { type AppDatabase, createDb } from '../../infra/db';

export type { WalletTxType };

/** 查询用户当前账户余额 */
export async function getUserBalance(db: AppDatabase, userId: number): Promise<number> {
  const rows = await db.select({ balance: users.balance }).from(users).where(eq(users.id, userId)).limit(1);
  return Number(rows[0]?.balance ?? 0);
}

/** 原子增加用户余额并返回入账后余额 */
export async function creditUserBalance(db: AppDatabase, userId: number, amount: number): Promise<number> {
  const safeAmt = Number(amount.toFixed(2));
  await db
    .update(users)
    .set({ balance: sql`round(${users.balance} + ${safeAmt}, 2)` })
    .where(eq(users.id, userId));
  return getUserBalance(db, userId);
}

/**
 * CAS 原子扣减用户余额（强制 WHERE balance >= amount 防并发双花与负余额）
 */
export async function debitUserBalanceAtomic(
  db: AppDatabase,
  userId: number,
  amount: number
): Promise<{ deducted: boolean; balanceAfter: number }> {
  const safeAmt = Number(amount.toFixed(2));
  const updated = await db
    .update(users)
    .set({ balance: sql`round(${users.balance} - ${safeAmt}, 2)` })
    .where(and(eq(users.id, userId), gte(users.balance, safeAmt)))
    .returning({ balance: users.balance });
  if (updated.length !== 1) {
    return { deducted: false, balanceAfter: await getUserBalance(db, userId) };
  }
  return { deducted: true, balanceAfter: Number(updated[0].balance) };
}

/** 查询会员最近资金账单流水（映射为既有蛇形字段） */
export async function listUserWalletTransactions(
  db: AppDatabase,
  userId: number,
  options?: { type?: string; limit?: number }
) {
  const limit = options?.limit ?? 100;
  const cond = options?.type
    ? and(eq(walletTransactions.userId, userId), eq(walletTransactions.type, options.type))
    : eq(walletTransactions.userId, userId);

  const rows = await db
    .select()
    .from(walletTransactions)
    .where(cond)
    .orderBy(desc(walletTransactions.id))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    type: r.type,
    amount: r.amount,
    balance_after: r.balanceAfter,
    ref_no: r.refNo,
    note: r.note,
    created_at: r.createdAt,
  }));
}

/** 校验指定引用流水是否已存在（用于异步充值补偿严格幂等防双倍入账） */
export async function hasWalletTxByRefRepo(
  db: AppDatabase,
  userId: number,
  type: WalletTxType,
  refNo: string
): Promise<boolean> {
  if (!refNo) return false;
  const rows = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.type, type),
        eq(walletTransactions.refNo, refNo)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * 写入不可变钱包账本流水（正数入账、负数扣款），失败时显式告警并抛错以防账实悄悄脱节
 */
export async function recordWalletTx(
  env: Env,
  params: {
    userId: number;
    type: WalletTxType;
    amount: number;
    refNo?: string;
    note: string;
    balanceAfter?: number;
  }
): Promise<void> {
  const db = createDb(env.DB);
  let bal = params.balanceAfter;
  if (typeof bal !== 'number' || Number.isNaN(bal)) {
    bal = await getUserBalance(db, params.userId);
  }
  try {
    await db.insert(walletTransactions).values({
      userId: params.userId,
      type: params.type,
      amount: Number(params.amount.toFixed(2)),
      balanceAfter: Number(bal.toFixed(2)),
      refNo: (params.refNo || '').slice(0, 64),
      note: params.note.slice(0, 240),
    });
  } catch (err) {
    console.error('[WALLET_TX_RECORD_FAILED]', {
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      refNo: params.refNo || '',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
