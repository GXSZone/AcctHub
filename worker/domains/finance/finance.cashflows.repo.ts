import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  agents,
  agentWithdrawals,
  commissionLedger,
  orders,
  paymentIntents,
  products,
  rechargeCdks,
  rechargeRecords,
  refundCommissionRecoveries,
  users,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

const recognized = inArray(orders.status, RECOGNIZED_ORDER_STATUSES);

/** 专业财务扩展指标查询：开户升级费、提现手续费、成本损耗、现金流实收与站内余额负债池（100% Drizzle ORM） */
export async function queryFinanceExtraMetricsRepo(db: AppDatabase, sinceDate: string) {
  const recDateCond = sinceDate
    ? sql`substr(${rechargeRecords.createdAt}, 1, 10) >= ${sinceDate}`
    : undefined;
  const commDateCond = sinceDate
    ? and(
        eq(commissionLedger.rewardType, 'tier_upgrade_fee'),
        sql`substr(${commissionLedger.createdAt}, 1, 10) >= ${sinceDate}`
      )
    : eq(commissionLedger.rewardType, 'tier_upgrade_fee');
  const wdDateCond = sinceDate
    ? sql`substr(COALESCE(${agentWithdrawals.processedAt}, ${agentWithdrawals.createdAt}), 1, 10) >= ${sinceDate}`
    : undefined;
  const ordDateCond = sinceDate
    ? and(eq(orders.productOwnerAgentId, 0), sql`substr(${orders.createdAt}, 1, 10) >= ${sinceDate}`)
    : eq(orders.productOwnerAgentId, 0);
  const piDateCond = sinceDate
    ? and(
        eq(paymentIntents.status, 'paid'),
        eq(paymentIntents.paymentOwnerAgentId, 0),
        sql`substr(COALESCE(${paymentIntents.paidAt}, ${paymentIntents.createdAt}), 1, 10) >= ${sinceDate}`
      )
    : and(eq(paymentIntents.status, 'paid'), eq(paymentIntents.paymentOwnerAgentId, 0));
  const cdkDateCond = sinceDate
    ? and(eq(rechargeCdks.status, 'used'), sql`substr(${rechargeCdks.usedAt}, 1, 10) >= ${sinceDate}`)
    : eq(rechargeCdks.status, 'used');

  const upgradeDayExpr = sql<string>`substr(${rechargeRecords.createdAt}, 1, 10)`;
  const commDayExpr = sql<string>`substr(${commissionLedger.createdAt}, 1, 10)`;

  const [
    upgradeSummaryRows,
    upgradeParentShareRows,
    dailyUpgrades,
    dailyUpgradeShares,
    withdrawalFeeRows,
    refundSunkCostRows,
    receivableRows,
    localCostRows,
    cashInflowRows,
    cdkRows,
    liabilityRows,
  ] = await Promise.all([
    // 1. 代理开户与升级总流水
    db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(ROUND(SUM(${rechargeRecords.amount}), 2), 0)`,
      })
      .from(rechargeRecords)
      .where(recDateCond),
    // 2. 下级开户/升级分给上级代理的分成合计
    db
      .select({
        parentShare: sql<number>`COALESCE(ROUND(SUM(${commissionLedger.amount}), 2), 0)`,
      })
      .from(commissionLedger)
      .where(commDateCond),
    // 3. 按日代理开户/升级流水
    db
      .select({
        day: upgradeDayExpr,
        upgradeCount: sql<number>`count(*)`,
        upgradeTotal: sql<number>`COALESCE(ROUND(SUM(${rechargeRecords.amount}), 2), 0)`,
      })
      .from(rechargeRecords)
      .where(recDateCond)
      .groupBy(upgradeDayExpr)
      .orderBy(desc(upgradeDayExpr))
      .limit(90),
    // 4. 按日代理开户费给上级的分润
    db
      .select({
        day: commDayExpr,
        parentShare: sql<number>`COALESCE(ROUND(SUM(${commissionLedger.amount}), 2), 0)`,
      })
      .from(commissionLedger)
      .where(commDateCond)
      .groupBy(commDayExpr)
      .orderBy(desc(commDayExpr))
      .limit(90),
    // 5. 已打款提现手续费收入与实打款净额
    db
      .select({
        paidFeeIncome: sql<number>`COALESCE(ROUND(SUM(CASE WHEN ${agentWithdrawals.status} = 'paid' THEN ${agentWithdrawals.feeAmount} ELSE 0 END), 2), 0)`,
        paidNetAmount: sql<number>`COALESCE(ROUND(SUM(CASE WHEN ${agentWithdrawals.status} = 'paid' THEN CASE WHEN ${agentWithdrawals.netAmount} > 0 THEN ${agentWithdrawals.netAmount} ELSE ${agentWithdrawals.amount} - ${agentWithdrawals.feeAmount} END ELSE 0 END), 2), 0)`,
        pendingFeeAmount: sql<number>`COALESCE(ROUND(SUM(CASE WHEN ${agentWithdrawals.status} = 'pending' THEN ${agentWithdrawals.feeAmount} ELSE 0 END), 2), 0)`,
      })
      .from(agentWithdrawals)
      .where(wdDateCond),
    // 6. 已退款订单的不可退回上游采购沉没成本
    db
      .select({
        sunkUpstreamCost: sql<number>`COALESCE(ROUND(SUM(${orders.upstreamCostTotal}), 2), 0)`,
      })
      .from(orders)
      .where(and(ordDateCond, eq(orders.status, 'refunded'))),
    // 7. 退款后代理钱包不足形成的佣金应收坏账
    db
      .select({
        receivableTotal: sql<number>`COALESCE(ROUND(SUM(${refundCommissionRecoveries.receivableAmount}), 2), 0)`,
        receivableCount: sql<number>`COUNT(CASE WHEN ${refundCommissionRecoveries.receivableAmount} > 0.009 THEN 1 END)`,
      })
      .from(refundCommissionRecoveries),
    // 8. 本地自营卡密商品参考进货成本（products.cost_price * quantity）
    db
      .select({
        localCostTotal: sql<number>`COALESCE(ROUND(SUM(COALESCE(${products.costPrice}, 0) * ${orders.quantity}), 2), 0)`,
      })
      .from(orders)
      .leftJoin(products, eq(products.id, orders.productId))
      .where(and(ordDateCond, recognized, eq(orders.fulfillmentSource, 'local'))),
    // 9. 外部在线收银台现金实收（按业务类型汇总，用于与支付网关后台对账）
    db
      .select({
        bizType: paymentIntents.bizType,
        totalCny: sql<number>`COALESCE(ROUND(SUM(${paymentIntents.amountCny}), 2), 0)`,
      })
      .from(paymentIntents)
      .where(piDateCond)
      .groupBy(paymentIntents.bizType),
    // 10. 充值卡密 CDK 已兑换总额
    db
      .select({
        cdkRedeemed: sql<number>`COALESCE(ROUND(SUM(${rechargeCdks.amount}), 2), 0)`,
      })
      .from(rechargeCdks)
      .where(cdkDateCond),
    // 11. 站内钱包与推广金全站实时负债（不随日期窗口过滤，始终反映当前资产负债快照）
    db
      .select({
        totalBalance: sql<number>`COALESCE(ROUND(SUM(${users.balance}), 2), 0)`,
        agentBalance: sql<number>`COALESCE(ROUND(SUM(CASE WHEN ${users.role} = 'agent' THEN ${users.balance} ELSE 0 END), 2), 0)`,
        memberBalance: sql<number>`COALESCE(ROUND(SUM(CASE WHEN ${users.role} <> 'agent' THEN ${users.balance} ELSE 0 END), 2), 0)`,
        promoBalance: sql<number>`COALESCE(ROUND(SUM(${users.promoBalance}), 2), 0)`,
      })
      .from(users),
  ]);

  const cashByBiz = new Map(cashInflowRows.map((r) => [r.bizType, Number(r.totalCny || 0)]));

  return {
    agentUpgradeCount: Number(upgradeSummaryRows[0]?.count || 0),
    agentUpgradeTotal: Number(upgradeSummaryRows[0]?.total || 0),
    agentUpgradeParentShare: Number(upgradeParentShareRows[0]?.parentShare || 0),
    dailyUpgrades,
    dailyUpgradeShares,
    withdrawalFeeIncome: Number(withdrawalFeeRows[0]?.paidFeeIncome || 0),
    paidWithdrawalsNet: Number(withdrawalFeeRows[0]?.paidNetAmount || 0),
    pendingWithdrawalFees: Number(withdrawalFeeRows[0]?.pendingFeeAmount || 0),
    refundSunkUpstreamCost: Number(refundSunkCostRows[0]?.sunkUpstreamCost || 0),
    unrecoveredCommissionReceivable: Number(receivableRows[0]?.receivableTotal || 0),
    unrecoveredCommissionCount: Number(receivableRows[0]?.receivableCount || 0),
    localProductCostTotal: Number(localCostRows[0]?.localCostTotal || 0),
    cashInflowOrder: cashByBiz.get('order') ?? 0,
    cashInflowUpgrade: cashByBiz.get('agent_upgrade') ?? 0,
    cashInflowRecharge: cashByBiz.get('wallet_recharge') ?? 0,
    cdkRedeemedTotal: Number(cdkRows[0]?.cdkRedeemed || 0),
    walletLiabilityTotal: Number(liabilityRows[0]?.totalBalance || 0),
    walletLiabilityAgent: Number(liabilityRows[0]?.agentBalance || 0),
    walletLiabilityMember: Number(liabilityRows[0]?.memberBalance || 0),
    promoLiabilityTotal: Number(liabilityRows[0]?.promoBalance || 0),
  };
}

/** 查询全店非商品资金流水（代理开户升级流水 + 会员在线充值与 CDK 兑换流水） */
export async function queryAdminCashflowsRepo(db: AppDatabase) {
  const [upgradeRows, parentShareRows, rechargeIntentRows, cdkUsedRows] = await Promise.all([
    db
      .select({
        id: rechargeRecords.id,
        userId: rechargeRecords.userId,
        amount: rechargeRecords.amount,
        paymentMethod: rechargeRecords.paymentMethod,
        unlockedTierName: rechargeRecords.unlockedTierName,
        createdAt: rechargeRecords.createdAt,
        userEmail: users.email,
        userName: users.displayName,
        agentSlug: agents.slug,
        agentBrand: agents.brandName,
        parentAgentId: agents.parentAgentId,
      })
      .from(rechargeRecords)
      .leftJoin(users, eq(users.id, rechargeRecords.userId))
      .leftJoin(agents, eq(agents.userId, rechargeRecords.userId))
      .orderBy(desc(rechargeRecords.id))
      .limit(100),
    db
      .select({
        sourceAgentId: commissionLedger.sourceAgentId,
        amount: commissionLedger.amount,
        createdAt: commissionLedger.createdAt,
        beneficiarySlug: agents.slug,
        beneficiaryBrand: agents.brandName,
      })
      .from(commissionLedger)
      .leftJoin(agents, eq(agents.id, commissionLedger.beneficiaryAgentId))
      .where(eq(commissionLedger.rewardType, 'tier_upgrade_fee'))
      .orderBy(desc(commissionLedger.id))
      .limit(200),
    db
      .select({
        id: paymentIntents.id,
        intentNo: paymentIntents.intentNo,
        userId: paymentIntents.userId,
        provider: paymentIntents.provider,
        amountCny: paymentIntents.amountCny,
        status: paymentIntents.status,
        paidAt: paymentIntents.paidAt,
        createdAt: paymentIntents.createdAt,
        userEmail: users.email,
        userName: users.displayName,
      })
      .from(paymentIntents)
      .leftJoin(users, eq(users.id, paymentIntents.userId))
      .where(and(eq(paymentIntents.bizType, 'wallet_recharge'), eq(paymentIntents.paymentOwnerAgentId, 0)))
      .orderBy(desc(paymentIntents.id))
      .limit(100),
    db
      .select({
        id: rechargeCdks.id,
        code: rechargeCdks.code,
        amount: rechargeCdks.amount,
        usedByUserId: rechargeCdks.usedByUserId,
        usedByEmail: rechargeCdks.usedByEmail,
        usedAt: rechargeCdks.usedAt,
        batchNote: rechargeCdks.batchNote,
      })
      .from(rechargeCdks)
      .where(eq(rechargeCdks.status, 'used'))
      .orderBy(desc(rechargeCdks.usedAt))
      .limit(100),
  ]);

  // 关联开户记录与对应的上级开户费分成（按时间近邻匹配）
  const parentAgents = await db
    .select({ id: agents.id, slug: agents.slug, brandName: agents.brandName })
    .from(agents);
  const agentById = new Map(parentAgents.map((a) => [a.id, a]));
  const shareByAgentTime = new Map<string, number>();
  for (const s of parentShareRows) {
    const key = `${s.sourceAgentId}:${String(s.createdAt).slice(0, 16)}`;
    shareByAgentTime.set(key, Number(((shareByAgentTime.get(key) ?? 0) + Number(s.amount || 0)).toFixed(2)));
  }

  const agentUpgrades = upgradeRows.map((r) => {
    const parent = r.parentAgentId ? agentById.get(r.parentAgentId) : null;
    const myAgentId = parentAgents.find((a) => a.slug === r.agentSlug)?.id;
    const shareKey = myAgentId ? `${myAgentId}:${String(r.createdAt).slice(0, 16)}` : '';
    const parentShare = shareKey ? (shareByAgentTime.get(shareKey) ?? 0) : 0;
    const amount = Number(r.amount || 0);
    const platformNet = Number(Math.max(0, amount - parentShare).toFixed(2));
    return {
      id: r.id,
      user_id: r.userId,
      user_email: r.userEmail || '-',
      user_name: r.userName || '-',
      agent_slug: r.agentSlug || null,
      agent_brand: r.agentBrand || null,
      parent_slug: parent?.slug || null,
      unlocked_tier_name: r.unlockedTierName || '-',
      payment_method: r.paymentMethod,
      amount,
      parent_share: parentShare,
      platform_net: platformNet,
      created_at: r.createdAt,
    };
  });

  const walletRecharges = [
    ...rechargeIntentRows.map((r) => ({
      id: `pi_${r.id}`,
      ref_no: r.intentNo,
      source: 'online' as const,
      channel: r.provider,
      user_email: r.userEmail || '-',
      user_name: r.userName || '-',
      amount: Number(r.amountCny || 0),
      status: r.status,
      note: '',
      created_at: r.paidAt || r.createdAt,
    })),
    ...cdkUsedRows.map((c) => ({
      id: `cdk_${c.id}`,
      ref_no: c.code,
      source: 'cdk' as const,
      channel: 'cdk',
      user_email: c.usedByEmail || '-',
      user_name: '-',
      amount: Number(c.amount || 0),
      status: 'paid',
      note: c.batchNote || '',
      created_at: c.usedAt || '',
    })),
  ]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 120);

  return { agent_upgrades: agentUpgrades, wallet_recharges: walletRecharges };
}
