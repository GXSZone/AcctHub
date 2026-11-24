import { eq, sql } from 'drizzle-orm';
import { type OrderRefund, type OrderRow, orderRefunds, refundPolicies } from '../../db/schema/index';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';

const refundPollBatchSize = 6;
const refundPollLeaseSeconds = 120;

function refundPollLeaseGuard(token: string) {
  return sql`completion_token = ${token} AND updated_at > datetime('now', ${`-${refundPollLeaseSeconds} seconds`})`;
}

/** 最久未查询的事件先认领。进程中断后，后续任务可接管过期租约。 */
export async function claimRefundPollBatch(d1: D1Database, token: string) {
  return createDb(d1)
    .update(orderRefunds)
    .set({ completionToken: token, updatedAt: sql`datetime('now')` })
    .where(sql`order_no IN (
      SELECT order_no FROM order_refunds
      WHERE mode = 'automatic' AND route = 'original_payment' AND provider = 'stripe'
        AND status IN ('submitting', 'pending', 'unknown')
        AND updated_at <= datetime('now', ${`-${refundPollLeaseSeconds} seconds`})
      ORDER BY updated_at, order_no
      LIMIT ${refundPollBatchSize}
    )`)
    .returning();
}

export async function releaseRefundPollLease(d1: D1Database, orderNo: string, token: string) {
  await createDb(d1)
    .update(orderRefunds)
    .set({ completionToken: null })
    .where(sql`${orderRefunds.orderNo} = ${orderNo} AND ${orderRefunds.completionToken} = ${token}`);
}

export async function readOrderRefund(d1: D1Database, orderNo: string) {
  const [row] = await createDb(d1).select().from(orderRefunds).where(eq(orderRefunds.orderNo, orderNo));
  return row;
}

export async function readRefundMode(d1: D1Database) {
  const [row] = await createDb(d1).select().from(refundPolicies).where(eq(refundPolicies.siteAgentId, 0));
  return row?.mode ?? 'manual';
}

export async function insertOrderRefund(
  d1: D1Database,
  order: OrderRow,
  input: Omit<typeof orderRefunds.$inferInsert, 'orderNo' | 'mode'>
) {
  return d1
    .prepare(`
    INSERT INTO order_refunds (order_no, operation_id, site_agent_id, mode, route, status,
      provider, payment_intent_no, original_payment, currency, amount, amount_cny)
    SELECT o.order_no, ?, ?, COALESCE((SELECT mode FROM refund_policies WHERE site_agent_id = 0), 'manual'),
      ?, ?, ?, ?, ?, ?, ?, ? FROM orders o
    WHERE o.order_no = ? AND o.status = ?
      AND (
        o.status != 'fulfillment_failed' OR NOT EXISTS (
          SELECT 1 FROM upstream_orders u WHERE u.local_order_no = o.order_no
            AND u.purpose IN ('order_fulfill', 'manual_retry')
            AND u.status IN ('pending', 'timeout_unknown', 'orphan', 'succeeded')
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM wallet_transactions w WHERE w.ref_no = o.order_no AND w.user_id = o.user_id
          AND w.type IN ('refund', 'refund_compensation') AND w.amount > 0
      )
    ON CONFLICT(order_no) DO NOTHING
  `)
    .bind(
      input.operationId,
      input.siteAgentId,
      input.route,
      input.status,
      input.provider,
      input.paymentIntentNo ?? null,
      input.originalPayment,
      input.currency,
      input.amount,
      input.amountCny,
      order.orderNo,
      order.status
    )
    .run();
}

export async function updateProviderRefund(
  d1: D1Database,
  event: OrderRefund,
  status: 'submitting' | 'manual_required' | 'pending' | 'unknown' | 'failed',
  providerRefundId?: string,
  pollLease?: string
) {
  const [row] = await createDb(d1)
    .update(orderRefunds)
    .set({
      status,
      providerRefundId: providerRefundId ?? event.providerRefundId,
      updatedAt: sql`datetime('now')`,
      completionToken: null,
    })
    .where(sql`${orderRefunds.orderNo} = ${event.orderNo} AND ${orderRefunds.status} = ${event.status}
    AND ${orderRefunds.providerRefundId} IS ${event.providerRefundId}
    ${pollLease ? sql`AND ${refundPollLeaseGuard(pollLease)}` : sql.empty()}`)
    .returning();
  return row;
}

/** 一个 D1 批次提交退款终态以及所有联动，单次随机凭据限制只有本批次可以记账。 */
export async function finishOrderRefund(
  d1: D1Database,
  order: OrderRow,
  event: OrderRefund,
  proof?: { reference: string; providerRefundId?: string },
  pollLease?: string
) {
  const token = crypto.randomUUID();
  const guard = 'EXISTS (SELECT 1 FROM order_refunds WHERE order_no = ? AND completion_token = ?)';
  const blocked =
    event.route === 'original_payment'
      ? ''
      : `
    AND EXISTS (SELECT 1 FROM users WHERE id = ?)
  `;
  const claim = d1
    .prepare(`
    UPDATE order_refunds
    SET status = 'succeeded', completion_token = ?, proof_reference = ?, provider_refund_id = ?,
      updated_at = datetime('now')
    WHERE order_no = ? AND status = ? AND provider_refund_id IS ?
      AND EXISTS (SELECT 1 FROM orders WHERE order_no = ? AND status = ?)
      ${blocked}
      ${pollLease ? "AND completion_token = ? AND updated_at > datetime('now', ?)" : ''}
  `)
    .bind(
      token,
      proof?.reference ?? null,
      proof?.providerRefundId ?? event.providerRefundId,
      order.orderNo,
      event.status,
      event.providerRefundId,
      order.orderNo,
      order.status,
      ...(event.route === 'original_payment' ? [] : [order.userId]),
      ...(pollLease ? [pollLease, `-${refundPollLeaseSeconds} seconds`] : [])
    );
  const statements = [claim];
  const add = (query: string, ...params: (string | number | null)[]) =>
    statements.push(d1.prepare(query).bind(...params, order.orderNo, token));

  if (event.route !== 'original_payment' && event.amountCny > 0) {
    const type = event.route === 'wallet' ? 'refund' : 'refund_compensation';
    add(
      `UPDATE users SET balance = round(balance + ?, 2) WHERE id = ? AND ${guard}`,
      event.amountCny,
      order.userId
    );
    add(
      `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_no, note)
      SELECT id, ?, ?, balance, ?, ? FROM users WHERE id = ? AND ${guard}`,
      type,
      event.amountCny,
      order.orderNo,
      type === 'refund' ? '订单钱包退款' : '在线付款异常钱包补偿',
      order.userId
    );
  }

  // 推广金仅退尚未返还的历史扣款，兼容过期退款与迟到支付后的再次扣减。
  add(
    `INSERT INTO promo_transactions (user_id, type, amount, balance_after, ref_no, note)
    SELECT u.id, 'refund', p.net, round(u.promo_balance + p.net, 2), ?, '订单退款退回推广消费金'
    FROM users u JOIN (
      SELECT user_id, round(-SUM(amount), 2) AS net FROM promo_transactions
      WHERE ref_no = ? AND type IN ('spend', 'refund') GROUP BY user_id
    ) p ON p.user_id = u.id
    WHERE u.id = ? AND p.net > 0 AND ${guard}`,
    order.orderNo,
    order.orderNo,
    order.userId
  );
  add(
    `UPDATE users SET promo_balance = (
      SELECT balance_after FROM promo_transactions WHERE user_id = ? AND ref_no = ? AND type = 'refund'
      ORDER BY id DESC LIMIT 1
    ) WHERE id = ? AND changes() = 1 AND ${guard}`,
    order.userId,
    order.orderNo,
    order.userId
  );

  add(
    `UPDATE affiliate_ledgers
    SET status = 'clawed_back', clawed_back_amount = round(MIN(reward_amount, COALESCE(
      (SELECT promo_balance FROM users WHERE id = referrer_user_id), 0)), 2)
    WHERE order_no = ? AND status = 'settled' AND ${guard}`,
    order.orderNo
  );
  add(
    `INSERT INTO promo_transactions (user_id, type, amount, balance_after, ref_no, note)
    SELECT u.id, 'clawback', -l.clawed_back_amount, round(u.promo_balance - l.clawed_back_amount, 2),
      l.order_no, '关联订单退款追缴退佣'
    FROM affiliate_ledgers l JOIN users u ON u.id = l.referrer_user_id
    WHERE l.order_no = ? AND l.clawed_back_amount > 0 AND changes() = 1 AND ${guard}`,
    order.orderNo
  );
  add(
    `UPDATE users SET promo_balance = (
      SELECT balance_after FROM promo_transactions WHERE ref_no = ? AND type = 'clawback' ORDER BY id DESC LIMIT 1
    ) WHERE id = (SELECT referrer_user_id FROM affiliate_ledgers WHERE order_no = ?)
    AND changes() = 1 AND ${guard}`,
    order.orderNo,
    order.orderNo
  );

  add(
    `INSERT INTO refund_commission_recoveries
      (order_no, beneficiary_agent_id, user_id, assessed_amount, recovered_amount, receivable_amount)
    SELECT l.order_no, l.beneficiary_agent_id, a.user_id, round(SUM(l.amount), 2),
      round(MIN(SUM(l.amount), MAX(0, COALESCE(u.balance, 0))), 2),
      round(SUM(l.amount) - MIN(SUM(l.amount), MAX(0, COALESCE(u.balance, 0))), 2)
    FROM commission_ledger l JOIN agents a ON a.id = l.beneficiary_agent_id
    LEFT JOIN users u ON u.id = a.user_id
    WHERE l.order_no = ? AND l.amount > 0 AND ${guard}
    GROUP BY l.order_no, l.beneficiary_agent_id, a.user_id, u.balance`,
    order.orderNo
  );
  add(
    `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_no, note)
    SELECT u.id, 'refund', -r.recovered_amount, round(u.balance - r.recovered_amount, 2),
      r.order_no, '订单退款实际追回代理分润'
    FROM refund_commission_recoveries r JOIN users u ON u.id = r.user_id
    WHERE r.order_no = ? AND r.recovered_amount > 0 AND ${guard}`,
    order.orderNo
  );
  add(
    `UPDATE users SET balance = round(balance - (
      SELECT recovered_amount FROM refund_commission_recoveries WHERE order_no = ? AND user_id = users.id
    ), 2) WHERE id IN (
      SELECT user_id FROM refund_commission_recoveries WHERE order_no = ? AND recovered_amount > 0
    ) AND ${guard}`,
    order.orderNo,
    order.orderNo
  );
  add(
    `UPDATE agents SET total_commission = MAX(0, round(total_commission - (
      SELECT assessed_amount FROM refund_commission_recoveries WHERE order_no = ? AND beneficiary_agent_id = agents.id
    ), 2)) WHERE id IN (
      SELECT beneficiary_agent_id FROM refund_commission_recoveries WHERE order_no = ?
    ) AND ${guard}`,
    order.orderNo,
    order.orderNo
  );
  add(
    `INSERT INTO commission_ledger (order_no, beneficiary_agent_id, source_agent_id, reward_type, amount, note)
    SELECT order_no, beneficiary_agent_id, COALESCE(?, beneficiary_agent_id), 'refund_reversal',
      -recovered_amount, '订单退款实际追回代理分润'
    FROM refund_commission_recoveries WHERE order_no = ? AND recovered_amount > 0 AND ${guard}`,
    order.agentId,
    order.orderNo
  );

  if (order.status === 'delivered' || order.status === 'paid') {
    add(
      `UPDATE products SET sales_count = MAX(0, sales_count - ?) WHERE id = ? AND ${guard}`,
      order.quantity,
      order.productId
    );
  }
  if (order.agentId) {
    add(
      `UPDATE agents SET total_revenue = MAX(0, round(total_revenue - ?, 2))
      WHERE id = ? AND (? IN ('delivered', 'paid') OR EXISTS (
        SELECT 1 FROM commission_ledger WHERE order_no = ? AND amount > 0
      )) AND ${guard}`,
      event.amountCny,
      order.agentId,
      order.status,
      order.orderNo
    );
  }
  add(
    `UPDATE product_cards SET status = 'quarantined' WHERE order_no = ? AND status != 'quarantined' AND ${guard}`,
    order.orderNo
  );
  add(
    `UPDATE upstream_orders SET status = 'refunded' WHERE local_order_no = ?
    AND purpose IN ('order_fulfill', 'manual_retry') AND ${guard}`,
    order.orderNo
  );
  add(
    `UPDATE orders SET status = 'refunded', upstream_status = CASE WHEN upstream_status = 'none'
    THEN 'none' ELSE 'refunded' END WHERE order_no = ? AND ${guard}`,
    order.orderNo
  );
  add(`UPDATE order_refunds SET completion_token = NULL WHERE order_no = ? AND ${guard}`, order.orderNo);

  try {
    const [result] = await d1.batch(statements);
    if (result.meta.changes !== 1) throw Errors.conflict('退款进度已变化，或账户无法记账，请刷新后核对');
  } catch (error) {
    if (
      /uq_order_refund_(proof|provider_id)|order_refunds\.provider, order_refunds\.(proof_reference|provider_refund_id)/.test(
        String(error)
      )
    ) {
      throw Errors.conflict('退款证明编号已用于其他订单');
    }
    throw error;
  }
}
