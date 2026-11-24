import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import {
  agents,
  agentWithdrawals,
  orders,
  paymentIntents,
  productCards,
  promoTransactions,
  users,
  walletTransactions,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

const recognized = inArray(orders.status, RECOGNIZED_ORDER_STATUSES);

/** 财务对账聚合与七重资金守恒巡检查询（100% Drizzle ORM） */
export async function queryFinanceReconciliationRepo(db: AppDatabase, sinceDate: string) {
  // 仅统计主站商品资金流水（分站自营私有商品强制分站自有收款直收，绝不计入主站资金账本）
  const platformOrderFilter = eq(orders.productOwnerAgentId, 0);
  const dateFilter = sinceDate
    ? and(platformOrderFilter, sql`substr(${orders.createdAt}, 1, 10) >= ${sinceDate}`)
    : platformOrderFilter;
  const dayExpr = sql<string>`substr(${orders.createdAt}, 1, 10)`;
  const tenantSlugExpr = sql<string>`COALESCE(${orders.tenantSlug}, 'main')`;
  const brandNameExpr = sql<string>`COALESCE(${agents.brandName}, '主站直营')`;
  const gmvExpr = sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.totalAmount} ELSE 0 END), 0)`;
  // 按实际退款凭据统计现金额。钱包流水也覆盖上线前已到账的退款和履约补偿。
  const actualRefund = sql<number | null>`CASE WHEN ${orders.status} = 'refunded' THEN COALESCE(
    (
      SELECT r.amount_cny FROM order_refunds r WHERE r.order_no = ${orders.orderNo}
      AND r.status = 'succeeded' AND (
        (r.route = 'original_payment' AND r.proof_reference IS NOT NULL)
        OR (r.route = 'wallet' AND r.amount_cny = 0)
      )
    ),
    (
      SELECT SUM(w.amount) FROM wallet_transactions w
      WHERE w.user_id = ${orders.userId} AND w.ref_no = ${orders.orderNo}
      AND w.type IN ('refund', 'refund_compensation') AND w.amount > 0
    )
  ) END`;
  const refundedAmount = sql<number>`COALESCE(SUM(${actualRefund}), 0)`;

  const summaryQ = db
    .select({
      paidOrders: sql<number>`COUNT(CASE WHEN ${recognized} THEN 1 END)`,
      pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.status} = 'pending_payment' THEN 1 END)`,
      refundedOrders: sql<number>`COUNT(${actualRefund})`,
      grossGmv: gmvExpr,
      refundedAmount,
      couponDiscountTotal: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.couponDiscount} ELSE 0 END), 0)`,
      promoDiscountTotal: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.promoUsedAmount} ELSE 0 END), 0)`,
      upstreamCostTotal: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.upstreamCostTotal} ELSE 0 END), 0)`,
      agentCommissionTotal: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.commissionAmount} ELSE 0 END), 0)`,
    })
    .from(orders);

  const dailyQ = db
    .select({
      day: dayExpr,
      orderCount: sql<number>`COUNT(CASE WHEN ${recognized} THEN 1 END)`,
      gmv: gmvExpr,
      upstreamCost: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.upstreamCostTotal} ELSE 0 END), 0)`,
      commission: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.commissionAmount} ELSE 0 END), 0)`,
      refunded: refundedAmount,
    })
    .from(orders);

  const tenantQ = db
    .select({
      tenantSlug: tenantSlugExpr,
      brandName: brandNameExpr,
      orderCount: sql<number>`COUNT(CASE WHEN ${recognized} THEN 1 END)`,
      gmv: gmvExpr,
      commission: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.commissionAmount} ELSE 0 END), 0)`,
      upstreamCost: sql<number>`COALESCE(SUM(CASE WHEN ${recognized} THEN ${orders.upstreamCostTotal} ELSE 0 END), 0)`,
    })
    .from(orders)
    .leftJoin(agents, eq(agents.id, orders.agentId));

  const [
    summaryRows,
    dailyRows,
    tenantRows,
    wdRows,
    overflowRows,
    unreversedRows,
    negBalRows,
    orphanOrderIntentRows,
    orphanRechargeIntentRows,
    orphanUpgradeIntentRows,
    promoUserSumRows,
    promoTxSumRows,
    walletUserSumRows,
    walletTxSumRows,
    soldCardNoOrderRows,
    stuckProcessingOrderRows,
    orphanWalletPayRows,
  ] = await Promise.all([
    dateFilter ? summaryQ.where(dateFilter) : summaryQ,
    (dateFilter ? dailyQ.where(dateFilter) : dailyQ).groupBy(dayExpr).orderBy(desc(dayExpr)).limit(90),
    (dateFilter ? tenantQ.where(dateFilter) : tenantQ)
      .groupBy(tenantSlugExpr, brandNameExpr)
      .orderBy(desc(gmvExpr))
      .limit(50),
    db
      .select({
        pendingWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${agentWithdrawals.status} = 'pending' THEN ${agentWithdrawals.amount} ELSE 0 END), 0)`,
        paidWithdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${agentWithdrawals.status} = 'paid' THEN ${agentWithdrawals.amount} ELSE 0 END), 0)`,
      })
      .from(agentWithdrawals),
    // 资金守恒巡检 1：分润总额是否超过实付金额
    db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(
        and(ne(orders.status, 'refunded'), sql`${orders.commissionAmount} > ${orders.totalAmount} + 0.02`)
      ),
    // 退款后佣金账本净额应与逐受益方已登记的应收差额一致。
    db
      .select({
        orderNo: orders.orderNo,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'refunded'),
          sql`EXISTS (
        SELECT 1 FROM commission_ledger l
        LEFT JOIN refund_commission_recoveries r
          ON r.order_no = l.order_no AND r.beneficiary_agent_id = l.beneficiary_agent_id
        WHERE l.order_no = ${orders.orderNo}
        GROUP BY l.beneficiary_agent_id
        HAVING ABS(SUM(l.amount) - COALESCE(MAX(r.receivable_amount), 0)) > 0.02
      )`
        )
      ),
    // 资金守恒巡检 3：负余额异常账号
    db.select({ c: sql<number>`count(*)` }).from(users).where(lt(users.balance, -0.001)),
    // 资金守恒巡检 4A（L2）：订单类异步支付单已付，但订单缺失/停在未支付/过期/占位/或履约失败
    db
      .select({ c: sql<number>`count(*)` })
      .from(paymentIntents)
      .leftJoin(orders, eq(orders.orderNo, paymentIntents.bizRef))
      .where(
        and(
          eq(paymentIntents.bizType, 'order'),
          eq(paymentIntents.status, 'paid'),
          or(
            sql`${orders.id} IS NULL`,
            sql`${orders.status} IN ('pending_payment', 'expired', 'processing')`,
            eq(paymentIntents.fulfillStatus, 'failed'),
            and(
              eq(paymentIntents.fulfillStatus, 'processing'),
              or(
                sql`${paymentIntents.paidAt} IS NULL`,
                sql`${paymentIntents.paidAt} <= datetime('now', '-2 minutes')`
              )
            )
          )
        )
      ),
    // 资金守恒巡检 4B（L2）：钱包充值已付支付单缺失充值流水或履约失败
    db
      .select({ c: sql<number>`count(*)` })
      .from(paymentIntents)
      .leftJoin(
        walletTransactions,
        and(eq(walletTransactions.refNo, paymentIntents.intentNo), eq(walletTransactions.type, 'recharge'))
      )
      .where(
        and(
          eq(paymentIntents.bizType, 'wallet_recharge'),
          eq(paymentIntents.status, 'paid'),
          or(sql`${walletTransactions.id} IS NULL`, eq(paymentIntents.fulfillStatus, 'failed'))
        )
      ),
    // 资金守恒巡检 4C（L2）：代理开户/升级在线已付单履约失败或超期卡死
    db
      .select({ c: sql<number>`count(*)` })
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.bizType, 'agent_upgrade'),
          eq(paymentIntents.status, 'paid'),
          or(
            eq(paymentIntents.fulfillStatus, 'failed'),
            and(
              inArray(paymentIntents.fulfillStatus, ['pending', 'processing']),
              or(
                sql`${paymentIntents.paidAt} IS NULL`,
                sql`${paymentIntents.paidAt} <= datetime('now', '-2 minutes')`
              )
            )
          )
        )
      ),
    // 资金守恒巡检 5A：会员不可提现推广金余额总和与负推广金数量
    db
      .select({
        totalPromoBalance: sql<number>`COALESCE(ROUND(SUM(${users.promoBalance}), 2), 0)`,
        negativePromoCount: sql<number>`COUNT(CASE WHEN ${users.promoBalance} < -0.001 THEN 1 END)`,
      })
      .from(users),
    // 资金守恒巡检 5B：推广金流水账本净额总和
    db
      .select({
        totalPromoTx: sql<number>`COALESCE(ROUND(SUM(${promoTransactions.amount}), 2), 0)`,
      })
      .from(promoTransactions),
    // 资金守恒巡检 6A（L6）：主余额账户总和
    db
      .select({
        totalWalletBalance: sql<number>`COALESCE(ROUND(SUM(${users.balance}), 2), 0)`,
      })
      .from(users),
    // 资金守恒巡检 6B（L6）：钱包流水账本净额总和
    db
      .select({
        totalWalletTx: sql<number>`COALESCE(ROUND(SUM(${walletTransactions.amount}), 2), 0)`,
      })
      .from(walletTransactions),
    // 资金守恒巡检 7A（L1）：本地卡密已售出但找不到对应订单记录
    db
      .select({ c: sql<number>`count(*)` })
      .from(productCards)
      .leftJoin(orders, eq(orders.orderNo, productCards.orderNo))
      .where(and(eq(productCards.status, 'sold'), sql`${orders.id} IS NULL`)),
    // 资金守恒巡检 7B（L1）：订单停留在 processing 占位超过 5 分钟未终结
    db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(and(eq(orders.status, 'processing'), sql`${orders.createdAt} <= datetime('now', '-5 minutes')`)),
    // 资金守恒巡检 7C（L1）：存在 order_pay 扣款流水但没有对应订单
    db
      .select({ c: sql<number>`count(*)` })
      .from(walletTransactions)
      .leftJoin(orders, eq(orders.orderNo, walletTransactions.refNo))
      .where(
        and(
          eq(walletTransactions.type, 'order_pay'),
          sql`${walletTransactions.refNo} <> ''`,
          sql`${orders.id} IS NULL`
        )
      ),
  ]);

  const promoBalanceSum = Number(promoUserSumRows[0]?.totalPromoBalance || 0);
  const negativePromoCount = Number(promoUserSumRows[0]?.negativePromoCount || 0);
  const promoTxSum = Number(promoTxSumRows[0]?.totalPromoTx || 0);
  const promoDriftAmount = Number(Math.abs(promoBalanceSum - promoTxSum).toFixed(2));
  const promoConservationIssues = negativePromoCount + (promoDriftAmount > 0.01 ? 1 : 0);

  const walletBalanceSum = Number(walletUserSumRows[0]?.totalWalletBalance || 0);
  const walletTxSum = Number(walletTxSumRows[0]?.totalWalletTx || 0);
  const walletDriftAmount = Number(Math.abs(walletBalanceSum - walletTxSum).toFixed(2));
  const walletConservationIssues = walletDriftAmount > 0.01 ? 1 : 0;

  const orphanIntents =
    Number(orphanOrderIntentRows[0]?.c || 0) +
    Number(orphanRechargeIntentRows[0]?.c || 0) +
    Number(orphanUpgradeIntentRows[0]?.c || 0);
  const l1OrphanDeductions =
    Number(soldCardNoOrderRows[0]?.c || 0) +
    Number(stuckProcessingOrderRows[0]?.c || 0) +
    Number(orphanWalletPayRows[0]?.c || 0);

  return {
    summary: summaryRows[0],
    daily: dailyRows,
    byTenant: tenantRows,
    withdrawals: wdRows[0],
    checks: {
      commissionOverflow: Number(overflowRows[0]?.c || 0),
      unreversedRefunds: unreversedRows.length,
      negativeBalances: Number(negBalRows[0]?.c || 0),
      orphanIntents,
      promoConservationIssues,
      promoBalanceSum,
      promoTxSum,
      promoDriftAmount,
      walletConservationIssues,
      walletBalanceSum,
      walletTxSum,
      walletDriftAmount,
      l1OrphanDeductions,
    },
  };
}

/** 按订单 ID 游标读取同期对账明细，每次只加载一批。 */
export async function queryFinanceCsvOrdersRepo(
  db: AppDatabase,
  sinceDate: string,
  pageSize: number,
  beforeId?: number
) {
  return db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      createdAt: orders.createdAt,
      tenantSlug: sql<string>`COALESCE(${orders.tenantSlug}, 'main')`,
      productTitle: orders.productTitle,
      specName: orders.specName,
      quantity: orders.quantity,
      paymentMethod: orders.paymentMethod,
      status: orders.status,
      totalAmount: orders.totalAmount,
      couponDiscount: orders.couponDiscount,
      upstreamCostTotal: orders.upstreamCostTotal,
      commissionAmount: orders.commissionAmount,
    })
    .from(orders)
    .where(
      and(
        eq(orders.productOwnerAgentId, 0),
        sinceDate ? sql`substr(${orders.createdAt}, 1, 10) >= ${sinceDate}` : undefined,
        beforeId === undefined ? undefined : lt(orders.id, beforeId)
      )
    )
    .orderBy(desc(orders.id))
    .limit(pageSize);
}
