import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 不可提现推广消费金明细账本（第 5 项资金守恒：SUM(users.promo_balance) === SUM(amount)） */
export const promoTransactions = sqliteTable(
  'promo_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    type: text('type').notNull(),
    amount: real('amount').notNull(),
    balanceAfter: real('balance_after').notNull().default(0),
    refNo: text('ref_no').notNull().default(''),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_promo_tx_user').on(t.userId, t.id), index('idx_promo_tx_ref').on(t.refNo)]
);

/** Affiliate 会员推广返佣台账（仅主站非代理实付订单结算，退款支持自动扣回） */
export const affiliateLedgers = sqliteTable(
  'affiliate_ledgers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    referrerUserId: integer('referrer_user_id').notNull(),
    buyerUserId: integer('buyer_user_id').notNull(),
    orderNo: text('order_no').notNull().unique(),
    orderAmount: real('order_amount').notNull(),
    commissionRate: real('commission_rate').notNull(),
    rewardAmount: real('reward_amount').notNull(),
    clawedBackAmount: real('clawed_back_amount').notNull().default(0),
    status: text('status').notNull().default('settled'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_affiliate_referrer').on(t.referrerUserId, t.id)]
);

export type PromoTransactionRow = typeof promoTransactions.$inferSelect;
export type AffiliateLedgerRow = typeof affiliateLedgers.$inferSelect;
