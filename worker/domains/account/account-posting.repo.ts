import { and, eq, exists, sql } from 'drizzle-orm';
import { rechargeCdks } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { getUserBalance } from './wallet.repo';
import { accountCanPost, commitWalletEvent, walletEventKey, walletPosting } from './wallet-event.repo';

export async function redeemCdkWithWalletPosting(
  db: AppDatabase,
  input: { cdk: typeof rechargeCdks.$inferSelect; userId: number; email: string }
) {
  const { cdk, userId, email } = input;
  const redeemable = and(
    eq(rechargeCdks.id, cdk.id),
    eq(rechargeCdks.amount, cdk.amount),
    eq(rechargeCdks.status, 'available')
  );
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('cdk-redeem', cdk.id),
      amount: cdk.amount,
      when: and(
        accountCanPost(db, userId, cdk.amount),
        exists(db.select({ id: rechargeCdks.id }).from(rechargeCdks).where(redeemable))
      ),
    },
    (owned) => [
      ...walletPosting(db, owned, {
        userId,
        type: 'cdk',
        amount: cdk.amount,
        refNo: cdk.code,
        note: '充值卡密兑换成功',
      }),
      db
        .update(rechargeCdks)
        .set({
          status: 'used',
          usedByUserId: userId,
          usedByEmail: email,
          usedAt: sql`datetime('now')`,
        })
        .where(and(redeemable, owned)),
    ]
  );
  return event.applied ? getUserBalance(db, userId) : null;
}
