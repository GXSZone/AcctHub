import { sql } from 'drizzle-orm';
import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** 每个资金业务事件只可提交一次，且事件与资金写入同时提交。 */
export const walletEvents = sqliteTable('wallet_events', {
  eventKey: text('event_key').primaryKey().notNull(),
  attemptId: text('attempt_id').notNull(),
  amount: real('amount').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
