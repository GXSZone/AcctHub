import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { queryAdminCashflowsRepo, queryFinanceExtraMetricsRepo } from './finance.cashflows.repo';
import { queryFinanceCsvOrdersRepo, queryFinanceReconciliationRepo } from './finance.repo';

/** CSV 单元格安全转义：防 Excel 公式注入（对 = + - @ 等前缀自动补单引号） */
export function escapeCsvCell(raw: unknown): string {
  const str = String(raw ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

function normalizeReconciliationRange(rawDays?: string) {
  const daysRaw = Number(rawDays || 30);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(365, Math.floor(daysRaw)) : 0;
  const sinceDate = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : '';
  return { days, sinceDate };
}

function round2(v: unknown): number {
  return Number(Number(v || 0).toFixed(2));
}

/** 财务对账总览（营收利润账 + 外部现金实收账 + 站内余额负债账）、按日趋势、按分站核算与 7 项资金守恒实时巡检 */
export async function getFinanceReconciliation(env: Env, rawDays?: string) {
  const { days, sinceDate } = normalizeReconciliationRange(rawDays);
  const db = createDb(env.DB);
  const [data, extra] = await Promise.all([
    queryFinanceReconciliationRepo(db, sinceDate),
    queryFinanceExtraMetricsRepo(db, sinceDate),
  ]);

  const grossGmv = round2(data.summary?.grossGmv);
  const upstreamCost = round2(data.summary?.upstreamCostTotal);
  const agentCommission = round2(data.summary?.agentCommissionTotal);
  const orderNetProfit = round2(grossGmv - upstreamCost - agentCommission);

  const agentUpgradeTotal = round2(extra.agentUpgradeTotal);
  const agentUpgradeParentShare = round2(extra.agentUpgradeParentShare);
  const agentUpgradePlatformNet = round2(Math.max(0, agentUpgradeTotal - agentUpgradeParentShare));
  const withdrawalFeeIncome = round2(extra.withdrawalFeeIncome);
  const localProductCostTotal = round2(extra.localProductCostTotal);
  const refundSunkUpstreamCost = round2(extra.refundSunkUpstreamCost);

  const totalRecognizedRevenue = round2(grossGmv + agentUpgradeTotal + withdrawalFeeIncome);
  const comprehensiveNetProfit = round2(
    orderNetProfit +
      agentUpgradePlatformNet +
      withdrawalFeeIncome -
      refundSunkUpstreamCost -
      localProductCostTotal
  );
  const cashInflowOrder = round2(extra.cashInflowOrder);
  const cashInflowUpgrade = round2(extra.cashInflowUpgrade);
  const cashInflowRecharge = round2(extra.cashInflowRecharge);
  const cashInflowTotal = round2(cashInflowOrder + cashInflowUpgrade + cashInflowRecharge);

  const {
    commissionOverflow,
    unreversedRefunds,
    negativeBalances,
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
  } = data.checks;
  const integrityChecks = [
    {
      key: 'commission_overflow',
      label: '订单实付与代理链分润守恒校验',
      passed: commissionOverflow === 0,
      count: commissionOverflow,
      detail:
        commissionOverflow === 0
          ? '所有有效订单代理分润均未超过实付金额'
          : `检出 ${commissionOverflow} 笔订单分润高于实付，请排查`,
    },
    {
      key: 'refund_reversal',
      label: '已退款订单佣金冲正完整性校验',
      passed: unreversedRefunds === 0,
      count: unreversedRefunds,
      detail:
        unreversedRefunds === 0
          ? '已退款订单的佣金账本与追回金额及应收差额一致'
          : `检出 ${unreversedRefunds} 笔已退款订单的佣金账与应收不一致`,
    },
    {
      key: 'negative_balance',
      label: '全站账户钱包非负余额守恒校验',
      passed: negativeBalances === 0,
      count: negativeBalances,
      detail:
        negativeBalances === 0
          ? '全站所有会员与代理钱包余额均 >= ¥0.00'
          : `检出 ${negativeBalances} 个负余额异常账号`,
    },
    {
      key: 'async_payment_sync',
      label: '异步收银台已付单（订单、钱包充值与代理开户）履约完整性校验',
      passed: orphanIntents === 0,
      count: orphanIntents,
      detail:
        orphanIntents === 0
          ? '所有已付款异步支付单均已推进履约与入账，零掉单'
          : `检出 ${orphanIntents} 笔已支付但未完成交付、充值或开户未入账的异常支付单`,
    },
    {
      key: 'promo_ledger_conservation',
      label: '推广消费金账户余额与流水账本守恒校验',
      passed: promoConservationIssues === 0,
      count: promoConservationIssues,
      detail:
        promoConservationIssues === 0
          ? `不可提现推广金余额总和 ¥${promoBalanceSum.toFixed(2)} 与账本净流 ¥${promoTxSum.toFixed(2)} 严格守恒`
          : `发现推广金账实不一致（余额 ¥${promoBalanceSum.toFixed(2)} / 流水 ¥${promoTxSum.toFixed(2)} / 偏差 ¥${promoDriftAmount.toFixed(2)}），请核查`,
    },
    {
      key: 'wallet_ledger_conservation',
      label: '站内主余额账户总和与钱包流水账本守恒校验',
      passed: walletConservationIssues === 0,
      count: walletConservationIssues,
      detail:
        walletConservationIssues === 0
          ? `主余额账户总和 ¥${walletBalanceSum.toFixed(2)} 与钱包流水净额 ¥${walletTxSum.toFixed(2)} 严格守恒`
          : `发现主余额账实不一致（余额 ¥${walletBalanceSum.toFixed(2)} / 流水 ¥${walletTxSum.toFixed(2)} / 偏差 ¥${walletDriftAmount.toFixed(2)}），请排查`,
    },
    {
      key: 'l1_orphan_deductions',
      label: '已扣款/已售卡密与订单实体闭环校验',
      passed: l1OrphanDeductions === 0,
      count: l1OrphanDeductions,
      detail:
        l1OrphanDeductions === 0
          ? '已售卡密、扣款流水与订单记录 100% 闭环一致，无僵尸占位单'
          : `检出 ${l1OrphanDeductions} 条已售卡密或扣款流水缺少对应订单或占位单超时卡死`,
    },
  ];

  // 按日合并订单趋势与代理开户/升级费趋势
  const upgradeByDay = new Map(
    extra.dailyUpgrades.map((u) => [
      String(u.day || ''),
      { count: Number(u.upgradeCount || 0), total: round2(u.upgradeTotal) },
    ])
  );
  const shareByDay = new Map(
    extra.dailyUpgradeShares.map((s) => [String(s.day || ''), round2(s.parentShare)])
  );
  const orderByDay = new Map(data.daily.map((r) => [String(r.day || ''), r]));
  const allDays = [...new Set([...orderByDay.keys(), ...upgradeByDay.keys()])]
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 90);

  const mergedDaily = allDays.map((day) => {
    const o = orderByDay.get(day);
    const upg = upgradeByDay.get(day);
    const gmv = round2(o?.gmv);
    const up = round2(o?.upstreamCost);
    const comm = round2(o?.commission);
    const upgradeTotal = upg?.total ?? 0;
    const upgradeShare = shareByDay.get(day) ?? 0;
    const upgradePlatformNet = round2(Math.max(0, upgradeTotal - upgradeShare));
    return {
      day,
      order_count: Number(o?.orderCount || 0),
      upgrade_count: upg?.count ?? 0,
      gmv,
      upgrade_total: upgradeTotal,
      upgrade_platform_net: upgradePlatformNet,
      total_revenue: round2(gmv + upgradeTotal),
      upstream_cost: up,
      commission: comm,
      refunded: round2(o?.refunded),
      net_profit: round2(gmv - up - comm + upgradePlatformNet),
    };
  });

  return {
    days,
    summary: {
      paid_orders: Number(data.summary?.paidOrders ?? 0),
      pending_orders: Number(data.summary?.pendingOrders ?? 0),
      refunded_orders: Number(data.summary?.refundedOrders ?? 0),
      gross_gmv: grossGmv,
      total_recognized_revenue: totalRecognizedRevenue,
      refunded_amount: round2(data.summary?.refundedAmount),
      coupon_discount_total: round2(data.summary?.couponDiscountTotal),
      promo_discount_total: round2(data.summary?.promoDiscountTotal),
      upstream_cost_total: upstreamCost,
      local_product_cost_total: localProductCostTotal,
      refund_sunk_upstream_cost: refundSunkUpstreamCost,
      unrecovered_commission_receivable: round2(extra.unrecoveredCommissionReceivable),
      unrecovered_commission_count: Number(extra.unrecoveredCommissionCount || 0),
      agent_commission_total: agentCommission,
      platform_net_profit: orderNetProfit,
      comprehensive_net_profit: comprehensiveNetProfit,
      agent_upgrade_count: Number(extra.agentUpgradeCount || 0),
      agent_upgrade_total: agentUpgradeTotal,
      agent_upgrade_parent_share: agentUpgradeParentShare,
      agent_upgrade_platform_net: agentUpgradePlatformNet,
      withdrawal_fee_income: withdrawalFeeIncome,
      pending_withdrawals: round2(data.withdrawals?.pendingWithdrawals),
      paid_withdrawals: round2(data.withdrawals?.paidWithdrawals),
      paid_withdrawals_net: round2(extra.paidWithdrawalsNet),
      cash_inflow_order: cashInflowOrder,
      cash_inflow_upgrade: cashInflowUpgrade,
      cash_inflow_recharge: cashInflowRecharge,
      cash_inflow_total: cashInflowTotal,
      cdk_redeemed_total: round2(extra.cdkRedeemedTotal),
      wallet_liability_total: round2(extra.walletLiabilityTotal),
      wallet_liability_agent: round2(extra.walletLiabilityAgent),
      wallet_liability_member: round2(extra.walletLiabilityMember),
      promo_liability_total: round2(extra.promoLiabilityTotal),
    },
    daily: mergedDaily,
    by_tenant: data.byTenant.map((r) => {
      const gmv = round2(r.gmv);
      const up = round2(r.upstreamCost);
      const comm = round2(r.commission);
      return {
        tenant_slug: String(r.tenantSlug || 'main'),
        brand_name: String(r.brandName || '主站直营'),
        order_count: Number(r.orderCount || 0),
        gmv,
        commission: comm,
        upstream_cost: up,
        net_profit: round2(gmv - up - comm),
      };
    }),
    integrity_checks: integrityChecks,
  };
}

/** 获取总控全店非商品资金流水（代理开户升级 + 会员在线充值与 CDK 兑换） */
export async function getAdminCashflows(env: Env) {
  return queryAdminCashflowsRepo(createDb(env.DB));
}

/** 导出带 UTF-8 BOM 与公式注入防护的财务对账 CSV 明细 */
export async function buildFinanceReconciliationCsv(env: Env, rawDays?: string) {
  const { days, sinceDate } = normalizeReconciliationRange(rawDays);
  const db = createDb(env.DB);
  const pageSize = 500;
  let rows = await queryFinanceCsvOrdersRepo(db, sinceDate, pageSize);

  const header = [
    '订单号',
    '创建时间(UTC)',
    '来源分站',
    '商品名称',
    '规格',
    '数量',
    '支付通道',
    '状态',
    '实付金额(CNY)',
    '优惠抵扣(CNY)',
    '上游采购成本(CNY)',
    '代理链分润(CNY)',
    '平台单笔净利(CNY)',
  ];

  const encoder = new TextEncoder();
  let beforeId: number | undefined;

  return {
    filename: `accthub-reconciliation-${days || 'all'}d.csv`,
    csvBody: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`\uFEFF${header.map(escapeCsvCell).join(',')}`));
      },
      async pull(controller) {
        if (beforeId !== undefined) rows = await queryFinanceCsvOrdersRepo(db, sinceDate, pageSize, beforeId);
        if (rows.length) {
          controller.enqueue(encoder.encode(`\r\n${rows.map(financeCsvLine).join('\r\n')}`));
        }
        beforeId = rows.at(-1)?.id;
        if (rows.length < pageSize) controller.close();
      },
    }),
  };
}

function financeCsvLine(r: Awaited<ReturnType<typeof queryFinanceCsvOrdersRepo>>[number]) {
  const recognized = RECOGNIZED_ORDER_STATUSES.includes(r.status);
  const total = recognized ? Number(r.totalAmount || 0) : 0;
  const discount = recognized ? Number(r.couponDiscount || 0) : 0;
  const upCost = recognized ? Number(r.upstreamCostTotal || 0) : 0;
  const comm = recognized ? Number(r.commissionAmount || 0) : 0;
  const net = total - upCost - comm;

  return [
    r.orderNo,
    r.createdAt,
    r.tenantSlug,
    r.productTitle,
    r.specName,
    r.quantity,
    r.paymentMethod,
    r.status,
    total.toFixed(2),
    discount.toFixed(2),
    upCost.toFixed(2),
    comm.toFixed(2),
    net.toFixed(2),
  ]
    .map(escapeCsvCell)
    .join(',');
}
