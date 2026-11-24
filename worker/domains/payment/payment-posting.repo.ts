import { roundCurrency } from '@shared/domain/money';
import { and, eq, exists, inArray, type SQL, sql } from 'drizzle-orm';
import { orders, paymentIntents, promoTransactions, walletTransactions } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import {
  accountCanPost,
  commitWalletEvent,
  promoPosting,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';
import { type PaymentFulfillLease, type PaymentIntentRow, paymentFulfillLeaseGuard } from './payment.repo';

export function paymentPostingState(intent: PaymentIntentRow, lease: PaymentFulfillLease | undefined) {
  return and(
    eq(paymentIntents.intentNo, intent.intent_no),
    eq(paymentIntents.status, 'paid'),
    eq(paymentIntents.fulfillStatus, 'processing'),
    eq(paymentIntents.bizType, intent.biz_type),
    eq(paymentIntents.amountCny, roundCurrency(intent.amount_cny)),
    intent.user_id === null ? sql`0` : eq(paymentIntents.userId, intent.user_id),
    paymentFulfillLeaseGuard(lease)
  );
}

export function completePaymentPosting(db: AppDatabase, processing: SQL | undefined, owned: SQL) {
  return db
    .update(paymentIntents)
    .set({
      fulfillStatus: 'done',
      fulfillError: '',
      fulfillLeaseToken: null,
      fulfillLeaseUntil: null,
    })
    .where(and(processing, owned));
}

export async function postPaidWalletRecharge(
  db: AppDatabase,
  intent: PaymentIntentRow,
  lease: PaymentFulfillLease | undefined
) {
  if (intent.user_id === null) return false;
  const { user_id: userId, intent_no: refNo } = intent;
  const amount = roundCurrency(intent.amount_cny);
  if (amount <= 0) return false;
  const processing = paymentPostingState(intent, lease);
  // 历史恢复可能已有充值流水。保留原记录，只补推进支付单状态。
  const legacy = await db
    .select({ id: walletTransactions.id })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.type, 'recharge'),
        eq(walletTransactions.refNo, refNo)
      )
    )
    .get();
  const result = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('wallet-recharge', refNo),
      amount,
      when: and(
        accountCanPost(db, userId, amount),
        exists(db.select({ id: paymentIntents.id }).from(paymentIntents).where(processing))
      ),
    },
    (owned) => [
      ...(legacy
        ? []
        : walletPosting(db, owned, {
            userId,
            type: 'recharge',
            amount,
            refNo,
            note: `在线收银台充值入账（${intent.provider} / ${intent.provider_trade_no}）`,
          })),
      completePaymentPosting(db, processing, owned),
    ]
  );
  return result.amount !== null;
}

/** 从消费、退还和迟到重扣流水计算尚未退回的实际推广金。 */
export async function getOutstandingPromoForOrder(
  db: AppDatabase,
  orderNo: string,
  userId: number
): Promise<number> {
  const row = await db
    .select({ amount: sql<number>`max(0, round(-coalesce(sum(${promoTransactions.amount}), 0), 2))` })
    .from(promoTransactions)
    .where(
      and(
        eq(promoTransactions.refNo, orderNo),
        eq(promoTransactions.userId, userId),
        inArray(promoTransactions.type, ['spend', 'refund'])
      )
    )
    .get();
  return Number(row?.amount ?? 0);
}

export async function reclaimLateOrderPromo(
  db: AppDatabase,
  input: { orderNo: string; userId: number; amount: number; lease?: PaymentFulfillLease }
) {
  const { orderNo, userId, amount, lease } = input;
  const processing = and(
    eq(orders.orderNo, orderNo),
    eq(orders.userId, userId),
    eq(orders.status, 'processing')
  );
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('late-order-promo', orderNo),
      amount,
      when: and(
        paymentFulfillLeaseGuard(lease),
        accountCanPost(db, userId, -amount, true),
        exists(db.select({ id: orders.id }).from(orders).where(processing))
      ),
    },
    (owned) =>
      promoPosting(db, owned, {
        userId,
        amount: -amount,
        type: 'spend',
        refNo: orderNo,
        note: `超时关闭订单收到迟到付款，重新核销推广消费金（${orderNo}）`,
      })
  );
  return event.amount !== null;
}

export async function postOrderFulfillmentFailure(
  db: AppDatabase,
  input: {
    orderNo: string;
    userId: number | null;
    cash: number;
    promo: number;
    status: 'refunded' | 'fulfillment_failed';
    reason: string;
    lease?: PaymentFulfillLease;
  }
) {
  const { orderNo, userId, cash, promo, status, reason, lease } = input;
  const processing = and(eq(orders.orderNo, orderNo), eq(orders.status, 'processing'));
  const legacyCash =
    cash > 0 && userId
      ? await db
          .select({ id: walletTransactions.id })
          .from(walletTransactions)
          .where(
            and(
              eq(walletTransactions.refNo, orderNo),
              eq(walletTransactions.userId, userId),
              eq(walletTransactions.type, 'refund')
            )
          )
          .get()
      : null;
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('order-fulfillment-compensation', orderNo),
      amount: cash,
      when: and(
        paymentFulfillLeaseGuard(lease),
        exists(db.select({ id: orders.id }).from(orders).where(processing)),
        userId ? accountCanPost(db, userId, 0) : undefined
      ),
    },
    (owned) => [
      ...(userId && cash > 0 && !legacyCash
        ? walletPosting(db, owned, {
            userId,
            type: 'refund',
            amount: cash,
            refNo: orderNo,
            note: `支付后无法履约，实付款已全额退回站内余额（${orderNo}）`,
          })
        : []),
      ...(userId && promo > 0
        ? promoPosting(db, owned, {
            userId,
            amount: promo,
            type: 'refund',
            refNo: orderNo,
            note: `异步付款后异常退款，原路退回推广消费金（${orderNo}）`,
          })
        : []),
      db.update(orders).set({ status, upstreamError: reason }).where(and(processing, owned)),
    ]
  );
  return event.amount !== null;
}
