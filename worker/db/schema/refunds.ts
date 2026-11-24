import { sql } from 'drizzle-orm';
import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export type RefundMode = 'manual' | 'automatic';
export type RefundRoute = 'wallet' | 'wallet_compensation' | 'original_payment';
export type RefundStatus =
  | 'ready'
  | 'manual_required'
  | 'submitting'
  | 'pending'
  | 'unknown'
  | 'failed'
  | 'succeeded';

export const refundPolicies = sqliteTable('refund_policies', {
  siteAgentId: integer('site_agent_id').primaryKey(),
  mode: text('mode').$type<RefundMode>().notNull(),
});

export const orderRefunds = sqliteTable(
  'order_refunds',
  {
    orderNo: text('order_no').primaryKey(),
    operationId: text('operation_id').notNull().unique(),
    siteAgentId: integer('site_agent_id').notNull(),
    mode: text('mode').$type<RefundMode>().notNull(),
    route: text('route').$type<RefundRoute>().notNull(),
    status: text('status').$type<RefundStatus>().notNull(),
    provider: text('provider').notNull(),
    paymentIntentNo: text('payment_intent_no'),
    originalPayment: text('original_payment').notNull(),
    currency: text('currency').notNull(),
    amount: real('amount').notNull(),
    amountCny: real('amount_cny').notNull(),
    providerRefundId: text('provider_refund_id'),
    proofReference: text('proof_reference'),
    completionToken: text('completion_token'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex('uq_order_refund_proof')
      .on(t.provider, t.proofReference)
      .where(sql`${t.proofReference} IS NOT NULL`),
    uniqueIndex('uq_order_refund_provider_id')
      .on(t.provider, t.providerRefundId)
      .where(sql`${t.providerRefundId} IS NOT NULL`),
    uniqueIndex('uq_order_refund_original')
      .on(t.provider, t.originalPayment)
      .where(sql`${t.route} IN ('original_payment', 'wallet_compensation')`),
  ]
);

export const refundCommissionRecoveries = sqliteTable(
  'refund_commission_recoveries',
  {
    orderNo: text('order_no').notNull(),
    beneficiaryAgentId: integer('beneficiary_agent_id').notNull(),
    userId: integer('user_id').notNull(),
    assessedAmount: real('assessed_amount').notNull(),
    recoveredAmount: real('recovered_amount').notNull(),
    receivableAmount: real('receivable_amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderNo, t.beneficiaryAgentId] })]
);

export type OrderRefund = typeof orderRefunds.$inferSelect;
