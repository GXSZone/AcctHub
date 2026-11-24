import type { AsyncPaymentProvider, PaymentBizType } from '@shared/constants/enums';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { type PaymentIntentDbRow, paymentIntents } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { livePaymentIntentCondition } from './payment.provenance';

export {
  claimCouponUsageByCodeAtomic,
  ensureExtendedPaymentPluginsRepo,
  findClaimedCardsByOrderNoRepo,
  findExistingUpstreamOrderForLocalNoRepo,
  hasAgentUpgradeRechargeRecordRepo,
  hasCommissionLedgerByRefRepo,
  rollbackPaymentCouponUsage,
} from './payment.fulfill.repo';
export { findOrderByNo, findProductById } from './payment.order.repo';

export type PaymentFulfillStatus = 'pending' | 'processing' | 'done' | 'failed' | 'none';

export interface PaymentIntentRow {
  id: number;
  intent_no: string;
  biz_type: PaymentBizType;
  biz_ref: string;
  user_id: number | null;
  site_agent_id: number;
  payment_owner_agent_id: number;
  settlement_mode: string;
  provider: AsyncPaymentProvider;
  currency: string;
  amount_cny: number;
  pay_amount: number;
  pay_url: string;
  qr_content: string;
  provider_trade_no: string;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  fulfill_status: PaymentFulfillStatus;
  fulfill_error: string;
  fulfill_lease_token: string | null;
  fulfill_lease_until: string | null;
  payload_json: string;
  expires_at: string;
  paid_at: string | null;
  created_at: string;
  /** 仅在创建支付单时一次性下发给发起会话，绝不在 GET 轮询中透出 */
  view_token?: string;
}

/** 将 Drizzle PaymentIntentDbRow 映射为既有蛇形结构 */
export function mapPaymentIntentRow(row: PaymentIntentDbRow): PaymentIntentRow {
  return {
    id: row.id,
    intent_no: row.intentNo,
    biz_type: row.bizType as PaymentBizType,
    biz_ref: row.bizRef,
    user_id: row.userId,
    site_agent_id: row.siteAgentId,
    payment_owner_agent_id: row.paymentOwnerAgentId,
    settlement_mode: row.settlementMode,
    provider: row.provider as AsyncPaymentProvider,
    currency: row.currency,
    amount_cny: row.amountCny,
    pay_amount: row.payAmount,
    pay_url: row.payUrl,
    qr_content: row.qrContent,
    provider_trade_no: row.providerTradeNo,
    status: row.status as PaymentIntentRow['status'],
    fulfill_status: (row.fulfillStatus || 'pending') as PaymentFulfillStatus,
    fulfill_error: row.fulfillError || '',
    fulfill_lease_token: row.fulfillLeaseToken,
    fulfill_lease_until: row.fulfillLeaseUntil,
    payload_json: row.payloadJson,
    expires_at: row.expiresAt,
    paid_at: row.paidAt,
    created_at: row.createdAt,
  };
}

export async function insertPaymentIntentRecord(
  db: AppDatabase,
  input: {
    intentNo: string;
    bizType: PaymentBizType;
    bizRef: string;
    userId: number | null;
    siteAgentId: number;
    paymentOwnerAgentId?: number;
    settlementMode?: string;
    provider: AsyncPaymentProvider;
    currency: string;
    amountCny: number;
    payAmount: number;
    payUrl: string;
    qrContent: string;
    providerTradeNo: string;
    payloadJson: string;
    expiresAt: string;
  }
): Promise<PaymentIntentRow | null> {
  const inserted = await db
    .insert(paymentIntents)
    .values({
      intentNo: input.intentNo,
      bizType: input.bizType,
      bizRef: input.bizRef,
      userId: input.userId,
      siteAgentId: input.siteAgentId,
      paymentOwnerAgentId: input.paymentOwnerAgentId ?? 0,
      settlementMode: input.settlementMode ?? 'platform_collect',
      provider: input.provider,
      currency: input.currency,
      amountCny: input.amountCny,
      payAmount: input.payAmount,
      payUrl: input.payUrl,
      qrContent: input.qrContent,
      providerTradeNo: input.providerTradeNo,
      status: 'pending',
      fulfillStatus: 'pending',
      fulfillError: '',
      payloadJson: input.payloadJson,
      expiresAt: input.expiresAt,
    })
    .returning();
  return inserted[0] ? mapPaymentIntentRow(inserted[0]) : null;
}

export async function findPaymentIntentByNo(
  db: AppDatabase,
  intentNo: string
): Promise<PaymentIntentRow | null> {
  const rows = await db.select().from(paymentIntents).where(eq(paymentIntents.intentNo, intentNo)).limit(1);
  return rows[0] ? mapPaymentIntentRow(rows[0]) : null;
}

/** CAS 原子锁将支付单从 pending/expired 推进为 paid + fulfill_status='processing'（严格幂等与交易流水唯一防双花） */
export async function lockPaymentIntentPaidAtomic(
  db: AppDatabase,
  intent: PaymentIntentRow,
  providerTradeNo: string
): Promise<
  { locked: true; intent: PaymentIntentRow } | { locked: false; reason: 'changed' | 'trade_conflict' }
> {
  try {
    const updated = await db
      .update(paymentIntents)
      .set({
        status: 'paid',
        fulfillStatus: 'processing',
        fulfillError: '',
        fulfillLeaseToken: crypto.randomUUID(),
        fulfillLeaseUntil: leaseDeadline(),
        providerTradeNo,
        paidAt: sql`datetime('now')`,
      })
      .where(
        and(
          eq(paymentIntents.id, intent.id),
          eq(paymentIntents.provider, intent.provider),
          eq(paymentIntents.currency, intent.currency),
          eq(paymentIntents.payAmount, intent.pay_amount),
          eq(paymentIntents.providerTradeNo, intent.provider_trade_no),
          eq(paymentIntents.payloadJson, intent.payload_json),
          inArray(paymentIntents.status, ['pending', 'expired'])
        )
      )
      .returning();
    return updated[0]
      ? { locked: true, intent: mapPaymentIntentRow(updated[0]) }
      : { locked: false, reason: 'changed' };
  } catch (err) {
    if (isPaymentUniqueConflict(err, 'uq_payment_intents_provider_trade', 'provider_trade_no')) {
      return { locked: false, reason: 'trade_conflict' };
    }
    throw err;
  }
}

export function isPaymentUniqueConflict(error: unknown, indexName: string, columnName: string): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause) {
    if (
      cause.message.includes(indexName) ||
      cause.message.includes(
        `UNIQUE constraint failed: payment_intents.provider, payment_intents.${columnName}`
      )
    ) {
      return true;
    }
  }
  return false;
}

const leaseDeadline = () => sql`datetime('now', '+2 minutes')`;

function recoverableFulfillment() {
  return or(
    inArray(paymentIntents.fulfillStatus, ['pending', 'failed']),
    and(
      eq(paymentIntents.fulfillStatus, 'processing'),
      sql`(${paymentIntents.fulfillLeaseUntil} IS NULL OR ${paymentIntents.fulfillLeaseUntil} <= datetime('now'))`
    )
  );
}

/** 补偿任务/重试回调抢占未履约完成的已付款支付单（failed/pending 或 processing 超 2 分钟） */
export async function claimPaidIntentForFulfillRetryAtomic(
  db: AppDatabase,
  intentNo: string,
  allowSandbox = false
): Promise<PaymentIntentRow | null> {
  const updated = await db
    .update(paymentIntents)
    .set({
      fulfillStatus: 'processing',
      fulfillError: '',
      fulfillLeaseToken: crypto.randomUUID(),
      fulfillLeaseUntil: leaseDeadline(),
    })
    .where(
      and(
        eq(paymentIntents.intentNo, intentNo),
        eq(paymentIntents.status, 'paid'),
        recoverableFulfillment(),
        allowSandbox ? undefined : livePaymentIntentCondition()
      )
    )
    .returning();
  return updated[0] ? mapPaymentIntentRow(updated[0]) : null;
}

export interface PaymentFulfillLease {
  intentNo: string;
  token: string;
}

function ownsFulfillLease(intentNo: string, token: string | null) {
  return and(
    eq(paymentIntents.intentNo, intentNo),
    eq(paymentIntents.status, 'paid'),
    eq(paymentIntents.fulfillStatus, 'processing'),
    eq(paymentIntents.fulfillLeaseToken, token ?? ''),
    sql`${paymentIntents.fulfillLeaseUntil} > datetime('now')`
  );
}

/** 将租约条件写入同一条业务变更语句，避免租约检查与写入之间出现接管窗口。 */
export function paymentFulfillLeaseGuard(lease: PaymentFulfillLease | undefined) {
  return lease
    ? sql`EXISTS (SELECT 1 FROM payment_intents WHERE ${ownsFulfillLease(lease.intentNo, lease.token)})`
    : undefined;
}

export async function renewPaymentFulfillLease(
  db: AppDatabase,
  lease: PaymentFulfillLease
): Promise<boolean> {
  const updated = await db
    .update(paymentIntents)
    .set({ fulfillLeaseUntil: leaseDeadline() })
    .where(ownsFulfillLease(lease.intentNo, lease.token))
    .returning({ id: paymentIntents.id });
  return updated.length === 1;
}

export async function markIntentFulfillDoneRepo(
  db: AppDatabase,
  intentNo: string,
  token: string | null
): Promise<boolean> {
  const updated = await db
    .update(paymentIntents)
    .set({ fulfillStatus: 'done', fulfillError: '', fulfillLeaseToken: null, fulfillLeaseUntil: null })
    .where(ownsFulfillLease(intentNo, token))
    .returning({ id: paymentIntents.id });
  return updated.length === 1;
}

export async function markIntentFulfillFailedRepo(
  db: AppDatabase,
  intentNo: string,
  token: string | null,
  errorMsg: string
): Promise<boolean> {
  const updated = await db
    .update(paymentIntents)
    .set({
      fulfillStatus: 'failed',
      fulfillError: errorMsg.slice(0, 300),
      fulfillLeaseToken: null,
      fulfillLeaseUntil: null,
    })
    .where(ownsFulfillLease(intentNo, token))
    .returning({ id: paymentIntents.id });
  return updated.length === 1;
}

/** 扫描需要补偿履约的已支付支付单（解决 L2 异步支付已付但未履约漏单） */
export async function listRecoverablePaidIntentsRepo(
  db: AppDatabase,
  limit = 30,
  allowSandbox = false
): Promise<PaymentIntentRow[]> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.status, 'paid'),
        recoverableFulfillment(),
        allowSandbox ? undefined : livePaymentIntentCondition()
      )
    )
    .orderBy(asc(paymentIntents.id))
    .limit(limit);
  return rows.map(mapPaymentIntentRow);
}
