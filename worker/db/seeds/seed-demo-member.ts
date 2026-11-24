/**
 * 本地开发普通演示会员幂等补种（member@accthub.dev / member123456）
 */

import { and, eq } from 'drizzle-orm';
import { hashPassword } from '../../infra/auth-crypto';
import type { AppDatabase } from '../../infra/db';
import { users, walletTransactions } from '../schema';

export async function ensureDemoMemberAccount(db: AppDatabase): Promise<void> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'member@accthub.dev')))
    .limit(1);
  if (existing.length > 0) return;

  const memberHash = await hashPassword('member123456');
  await db
    .insert(users)
    .values({
      siteAgentId: 0,
      email: 'member@accthub.dev',
      displayName: '苏清和 · 会员',
      passwordHash: memberHash,
      role: 'user',
      balance: 200,
      totalRecharged: 0,
    })
    .onConflictDoNothing();

  const [memberUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'member@accthub.dev')))
    .limit(1);
  if (!memberUser) return;

  const existsTx = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(
      and(eq(walletTransactions.userId, memberUser.id), eq(walletTransactions.refNo, 'SEED-MEMBER-INIT'))
    )
    .limit(1);
  if (existsTx.length === 0) {
    await db.insert(walletTransactions).values({
      userId: memberUser.id,
      type: 'recharge',
      amount: 200,
      balanceAfter: 200,
      refNo: 'SEED-MEMBER-INIT',
      note: '普通演示会员初始化余额',
    });
  }
}
