/**
 * 沙盒演示种子专用平账助手（仅限本地开发演示环境调用）
 * 严格保证每笔余额/推广金变动同时维护 users 余额与不可变账本流水，确保 7 项资金守恒巡检零漂移。
 */

import { roundCurrency } from '@shared/domain/money';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../../infra/db';
import { promoTransactions, users, walletTransactions } from '../schema';

export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** 生成距离当前偏移指定小时数的 SQLite UTC 时间字符串（YYYY-MM-DD HH:MM:SS） */
export function offsetSqlTime(hoursOffset: number): string {
  const ms = Date.now() + hoursOffset * 3600 * 1000;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** 幂等写入一笔钱包流水并同步刷新 users.balance（按 refNo + type 去重） */
export async function applySeedWalletTx(
  db: AppDatabase,
  params: {
    userId: number;
    type: string;
    amount: number;
    refNo: string;
    note: string;
    createdAt?: string;
  }
): Promise<boolean> {
  const existing = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, params.userId),
        eq(walletTransactions.type, params.type),
        eq(walletTransactions.refNo, params.refNo)
      )
    )
    .limit(1);
  if (existing.length > 0) return false;

  const [u] = await db
    .select({ balance: users.balance, totalRecharged: users.totalRecharged })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  if (!u) return false;

  const delta = roundCurrency(params.amount);
  const nextBalance = roundCurrency(Number(u.balance || 0) + delta);
  if (nextBalance < 0) {
    throw new Error(`种子记账出现负余额：userId=${params.userId} refNo=${params.refNo} next=${nextBalance}`);
  }

  await db.update(users).set({ balance: nextBalance }).where(eq(users.id, params.userId));
  await db.insert(walletTransactions).values({
    userId: params.userId,
    type: params.type,
    amount: delta,
    balanceAfter: nextBalance,
    refNo: params.refNo,
    note: params.note,
    createdAt: params.createdAt ?? offsetSqlTime(0),
  });
  return true;
}

/** 幂等写入一笔推广消费金流水并同步刷新 users.promoBalance（按 refNo + type 去重） */
export async function applySeedPromoTx(
  db: AppDatabase,
  params: {
    userId: number;
    type: string;
    amount: number;
    refNo: string;
    note: string;
    createdAt?: string;
  }
): Promise<boolean> {
  const existing = await db
    .select({ id: promoTransactions.id })
    .from(promoTransactions)
    .where(
      and(
        eq(promoTransactions.userId, params.userId),
        eq(promoTransactions.type, params.type),
        eq(promoTransactions.refNo, params.refNo)
      )
    )
    .limit(1);
  if (existing.length > 0) return false;

  const [u] = await db
    .select({ promoBalance: users.promoBalance })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);
  if (!u) return false;

  const delta = roundCurrency(params.amount);
  const nextPromo = roundCurrency(Number(u.promoBalance || 0) + delta);
  if (nextPromo < 0) {
    throw new Error(`种子推广金出现负余额：userId=${params.userId} refNo=${params.refNo} next=${nextPromo}`);
  }

  await db.update(users).set({ promoBalance: nextPromo }).where(eq(users.id, params.userId));
  await db.insert(promoTransactions).values({
    userId: params.userId,
    type: params.type,
    amount: delta,
    balanceAfter: nextPromo,
    refNo: params.refNo,
    note: params.note,
    createdAt: params.createdAt ?? offsetSqlTime(0),
  });
  return true;
}
