/**
 * 闭环 3B：L1/L2/L3 多级代理穿透分润、B2B 批采、退款佣金冲红、分站私有单与代理提现三态平账
 */

import { roundCurrency } from '@shared/domain/money';
import { eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import type { AppDatabase } from '../../infra/db';
import { agents, agentWithdrawals, commissionLedger, orderRefunds, orders, paymentIntents } from '../schema';
import type { SeededTopologyContext } from './seed-agents-topology';
import { applySeedWalletTx, offsetSqlTime } from './seed-ledger-helper';

export async function seedMultiLevelAgentOrdersAndWithdrawals(
  db: AppDatabase,
  env: Env,
  ctx: SeededTopologyContext,
  primaryProd: { id: number; title: string }
): Promise<{ studioDeliveredOrderNo: string; pulseDeliveredOrderNo: string }> {
  // 1. L1 一级分站 @studio 零售单（分润 ¥32）
  const studioDeliveredOrderNo = 'AH-SEED-L1-STUDIO-004';
  const studioIntentNo = 'PAY-SEED-L1-004';
  await db
    .insert(orders)
    .values({
      orderNo: studioDeliveredOrderNo,
      publicOrderNo: 'PUB-L1-004',
      userId: ctx.subStudioBuyerId,
      agentId: ctx.studioAgentId,
      tenantSlug: 'studio',
      contactEmail: 'sub.buyer@studio.demo',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '星尘分站专供',
      quantity: 1,
      unitPrice: 158,
      totalAmount: 158,
      commissionAmount: 32,
      paymentMethod: 'epay',
      paymentIntentNo: studioIntentNo,
      status: 'delivered',
      deliveredAt: offsetSqlTime(-60),
      deliveredPayload: await sealDeliveryPayload(
        env,
        studioDeliveredOrderNo,
        'studio.buyer.04@accthub.mail----Pass#St04'
      ),
      buyerIp: '192.0.2.91',
      createdAt: offsetSqlTime(-60),
    })
    .onConflictDoNothing();
  await db
    .insert(paymentIntents)
    .values({
      intentNo: studioIntentNo,
      bizType: 'order',
      bizRef: studioDeliveredOrderNo,
      userId: ctx.subStudioBuyerId,
      siteAgentId: ctx.studioAgentId,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 158,
      payAmount: 158,
      providerTradeNo: 'EPAY-2026-L1-004',
      status: 'paid',
      fulfillStatus: 'done',
      expiresAt: offsetSqlTime(-59),
      paidAt: offsetSqlTime(-60),
      createdAt: offsetSqlTime(-60),
    })
    .onConflictDoNothing();
  if (
    await applySeedWalletTx(db, {
      userId: ctx.studioUserId,
      type: 'commission',
      amount: 32,
      refNo: studioDeliveredOrderNo,
      note: 'L1 分站直售分润（@studio）',
      createdAt: offsetSqlTime(-60),
    })
  ) {
    await db.insert(commissionLedger).values({
      orderNo: studioDeliveredOrderNo,
      beneficiaryAgentId: ctx.studioAgentId,
      sourceAgentId: ctx.studioAgentId,
      hopDistance: 0,
      rewardType: 'direct_sale',
      amount: 32,
      note: '星尘分站零售加价差价分润',
      createdAt: offsetSqlTime(-60),
    });
  }

  // 2. L2 二级分站 @aurora 零售单（@aurora ¥22 + 上级 @studio ¥10）
  const auroraOrderNo = 'AH-SEED-L2-AURORA-005';
  const auroraIntentNo = 'PAY-SEED-L2-005';
  await db
    .insert(orders)
    .values({
      orderNo: auroraOrderNo,
      publicOrderNo: 'PUB-L2-005',
      agentId: ctx.auroraAgentId,
      tenantSlug: 'aurora',
      contactEmail: 'dev.customer@aurora.test',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '极光站月卡',
      quantity: 1,
      unitPrice: 168,
      totalAmount: 168,
      commissionAmount: 32,
      paymentMethod: 'usdt_trc20',
      paymentIntentNo: auroraIntentNo,
      status: 'delivered',
      deliveredAt: offsetSqlTime(-40),
      deliveredPayload: await sealDeliveryPayload(
        env,
        auroraOrderNo,
        'aurora.dev.05@accthub.mail----Pass#Au05'
      ),
      buyerIp: '198.51.100.41',
      createdAt: offsetSqlTime(-40),
    })
    .onConflictDoNothing();
  await db
    .insert(paymentIntents)
    .values({
      intentNo: auroraIntentNo,
      bizType: 'order',
      bizRef: auroraOrderNo,
      siteAgentId: ctx.auroraAgentId,
      provider: 'usdt_trc20',
      currency: 'USDT',
      amountCny: 168,
      payAmount: 23.1724,
      providerTradeNo: 'TRC20-TX-DEMO-005',
      status: 'paid',
      fulfillStatus: 'done',
      expiresAt: offsetSqlTime(-39),
      paidAt: offsetSqlTime(-40),
      createdAt: offsetSqlTime(-40),
    })
    .onConflictDoNothing();
  for (const leg of [
    {
      uid: ctx.auroraUserId,
      agentId: ctx.auroraAgentId,
      hop: 0,
      amt: 22,
      type: 'direct_sale',
      note: 'L2 分站直售分润（@aurora）',
    },
    {
      uid: ctx.studioUserId,
      agentId: ctx.studioAgentId,
      hop: 1,
      amt: 10,
      type: 'tier_override',
      note: 'L1 上级跨级极差分润（来自下级 @aurora）',
    },
  ]) {
    if (
      await applySeedWalletTx(db, {
        userId: leg.uid,
        type: 'commission',
        amount: leg.amt,
        refNo: auroraOrderNo,
        note: leg.note,
        createdAt: offsetSqlTime(-40),
      })
    ) {
      await db.insert(commissionLedger).values({
        orderNo: auroraOrderNo,
        beneficiaryAgentId: leg.agentId,
        sourceAgentId: ctx.auroraAgentId,
        hopDistance: leg.hop,
        rewardType: leg.type,
        amount: leg.amt,
        note: leg.note,
        createdAt: offsetSqlTime(-40),
      });
    }
  }

  // 3. L3 三级分站 @pulse 零售单（@pulse ¥20 + @aurora ¥10 + @studio ¥8）
  const pulseDeliveredOrderNo = 'AH-SEED-L3-PULSE-006';
  const pulseIntentNo = 'PAY-SEED-L3-006';
  await db
    .insert(orders)
    .values({
      orderNo: pulseDeliveredOrderNo,
      publicOrderNo: 'PUB-L3-006',
      agentId: ctx.pulseAgentId,
      tenantSlug: 'pulse',
      contactEmail: 'campus.geek@pulse.test',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '三级分站校园版',
      quantity: 1,
      unitPrice: 180,
      totalAmount: 180,
      commissionAmount: 38,
      paymentMethod: 'epay',
      paymentIntentNo: pulseIntentNo,
      status: 'delivered',
      deliveredAt: offsetSqlTime(-22),
      deliveredPayload: await sealDeliveryPayload(
        env,
        pulseDeliveredOrderNo,
        'pulse.l3.06@accthub.mail----Pass#Pu06'
      ),
      buyerIp: '198.51.100.66',
      createdAt: offsetSqlTime(-22),
    })
    .onConflictDoNothing();
  await db
    .insert(paymentIntents)
    .values({
      intentNo: pulseIntentNo,
      bizType: 'order',
      bizRef: pulseDeliveredOrderNo,
      siteAgentId: ctx.pulseAgentId,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 180,
      payAmount: 180,
      providerTradeNo: 'EPAY-2026-L3-006',
      status: 'paid',
      fulfillStatus: 'done',
      expiresAt: offsetSqlTime(-21),
      paidAt: offsetSqlTime(-22),
      createdAt: offsetSqlTime(-22),
    })
    .onConflictDoNothing();
  for (const leg of [
    {
      uid: ctx.pulseUserId,
      agentId: ctx.pulseAgentId,
      hop: 0,
      amt: 20,
      type: 'direct_sale',
      note: 'L3 分站直售分润（@pulse）',
    },
    {
      uid: ctx.auroraUserId,
      agentId: ctx.auroraAgentId,
      hop: 1,
      amt: 10,
      type: 'tier_override',
      note: 'L2 上级极差分润（来自下级 @pulse）',
    },
    {
      uid: ctx.studioUserId,
      agentId: ctx.studioAgentId,
      hop: 2,
      amt: 8,
      type: 'tier_override',
      note: 'L1 隔代极差分润（来自三级 @pulse）',
    },
  ]) {
    if (
      await applySeedWalletTx(db, {
        userId: leg.uid,
        type: 'commission',
        amount: leg.amt,
        refNo: pulseDeliveredOrderNo,
        note: leg.note,
        createdAt: offsetSqlTime(-22),
      })
    ) {
      await db.insert(commissionLedger).values({
        orderNo: pulseDeliveredOrderNo,
        beneficiaryAgentId: leg.agentId,
        sourceAgentId: ctx.pulseAgentId,
        hopDistance: leg.hop,
        rewardType: leg.type,
        amount: leg.amt,
        note: leg.note,
        createdAt: offsetSqlTime(-22),
      });
    }
  }

  // 4. B2B 批采 API 单（@kairo 拿货，上级 @nebula 享极差 ¥14）
  const b2bOrderNo = 'AH-SEED-B2B-KAIRO-007';
  await db
    .insert(orders)
    .values({
      orderNo: b2bOrderNo,
      publicOrderNo: 'PUB-B2B-007',
      userId: ctx.kairoUserId,
      agentId: ctx.kairoAgentId,
      tenantSlug: 'kairo',
      contactEmail: 'kairo@accthub.dev',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: 'B2B 批采 2 件',
      quantity: 2,
      unitPrice: 105,
      totalAmount: 210,
      commissionAmount: 14,
      paymentMethod: 'balance',
      channel: 'reseller_api',
      idempotencyKey: 'seed-b2b-kairo-007',
      status: 'delivered',
      deliveredAt: offsetSqlTime(-16),
      deliveredPayload: await sealDeliveryPayload(
        env,
        b2bOrderNo,
        'b2b.kairo.01@accthub.mail----Pass#B2B1\nb2b.kairo.02@accthub.mail----Pass#B2B2'
      ),
      buyerIp: '198.51.100.88',
      createdAt: offsetSqlTime(-16),
    })
    .onConflictDoNothing();
  await applySeedWalletTx(db, {
    userId: ctx.kairoUserId,
    type: 'order_pay',
    amount: -210,
    refNo: b2bOrderNo,
    note: 'B2B Open API 批量采购扣款 (2 件)',
    createdAt: offsetSqlTime(-16),
  });
  if (
    await applySeedWalletTx(db, {
      userId: ctx.nebulaUserId,
      type: 'commission',
      amount: 14,
      refNo: b2bOrderNo,
      note: 'V4 上级 @nebula 享下级 @kairo B2B 批采极差收益',
      createdAt: offsetSqlTime(-16),
    })
  ) {
    await db.insert(commissionLedger).values({
      orderNo: b2bOrderNo,
      beneficiaryAgentId: ctx.nebulaAgentId,
      sourceAgentId: ctx.kairoAgentId,
      hopDistance: 1,
      rewardType: 'tier_override',
      amount: 14,
      note: '下级 @kairo B2B 批采跨级极差',
      createdAt: offsetSqlTime(-16),
    });
  }

  // 5. 已退款且佣金全额冲红单（严格满足巡检 2）
  const refundedOrderNo = 'AH-SEED-REFUND-008';
  await db
    .insert(orders)
    .values({
      orderNo: refundedOrderNo,
      publicOrderNo: 'PUB-REFUND-008',
      userId: ctx.subStudioBuyerId,
      agentId: ctx.studioAgentId,
      tenantSlug: 'studio',
      contactEmail: 'sub.buyer@studio.demo',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '已退款测试单',
      quantity: 1,
      unitPrice: 118,
      totalAmount: 118,
      commissionAmount: 0,
      paymentMethod: 'balance',
      status: 'refunded',
      buyerIp: '192.0.2.91',
      createdAt: offsetSqlTime(-52),
    })
    .onConflictDoNothing();
  await applySeedWalletTx(db, {
    userId: ctx.subStudioBuyerId,
    type: 'order_pay',
    amount: -118,
    refNo: refundedOrderNo,
    note: '星尘分站余额下单',
    createdAt: offsetSqlTime(-52),
  });
  await applySeedWalletTx(db, {
    userId: ctx.subStudioBuyerId,
    type: 'refund',
    amount: 118,
    refNo: refundedOrderNo,
    note: '售后全额退款至余额',
    createdAt: offsetSqlTime(-50),
  });
  if (
    await applySeedWalletTx(db, {
      userId: ctx.studioUserId,
      type: 'commission',
      amount: 18,
      refNo: refundedOrderNo,
      note: '分站下单分润入账',
      createdAt: offsetSqlTime(-52),
    })
  ) {
    await db.insert(commissionLedger).values({
      orderNo: refundedOrderNo,
      beneficiaryAgentId: ctx.studioAgentId,
      sourceAgentId: ctx.studioAgentId,
      hopDistance: 0,
      rewardType: 'direct_sale',
      amount: 18,
      note: '原订单直售分润',
      createdAt: offsetSqlTime(-52),
    });
  }
  if (
    await applySeedWalletTx(db, {
      userId: ctx.studioUserId,
      type: 'commission_reversal',
      amount: -18,
      refNo: refundedOrderNo,
      note: '订单退款自动冲红已发分润',
      createdAt: offsetSqlTime(-50),
    })
  ) {
    await db.insert(commissionLedger).values({
      orderNo: refundedOrderNo,
      beneficiaryAgentId: ctx.studioAgentId,
      sourceAgentId: ctx.studioAgentId,
      hopDistance: 0,
      rewardType: 'refund_reversal',
      amount: -18,
      note: '退款全额冲红分润',
      createdAt: offsetSqlTime(-50),
    });
  }
  await db
    .insert(orderRefunds)
    .values({
      orderNo: refundedOrderNo,
      operationId: 'REF-SEED-008',
      siteAgentId: ctx.studioAgentId,
      mode: 'manual',
      route: 'wallet',
      status: 'succeeded',
      provider: 'balance',
      originalPayment: refundedOrderNo,
      currency: 'CNY',
      amount: 118,
      amountCny: 118,
      createdAt: offsetSqlTime(-50),
      updatedAt: offsetSqlTime(-50),
    })
    .onConflictDoNothing();

  // 6. 分站自营私有商品订单（agent_direct）
  const privateOrderNo = 'AH-SEED-PRIVATE-009';
  await db
    .insert(orders)
    .values({
      orderNo: privateOrderNo,
      publicOrderNo: 'PUB-PRIV-009',
      userId: ctx.subNebulaBuyerId,
      agentId: ctx.nebulaAgentId,
      tenantSlug: 'nebula',
      productOwnerAgentId: ctx.nebulaAgentId,
      settlementMode: 'agent_direct',
      contactEmail: 'sub.buyer@nebula.demo',
      productId: ctx.nebulaPrivateProductId,
      productTitle: '星云自营 · 独享高并发模型转发节点',
      specId: 'monthly',
      specName: '月度独享节点',
      quantity: 1,
      unitPrice: 88,
      totalAmount: 88,
      paymentMethod: 'epay',
      status: 'delivered',
      deliveredAt: offsetSqlTime(-10),
      deliveredPayload: await sealDeliveryPayload(env, privateOrderNo, 'NEBULA-RELAY-KEY-2026-SOLD-009'),
      buyerIp: '192.0.2.105',
      createdAt: offsetSqlTime(-10),
    })
    .onConflictDoNothing();

  // 7. 多状态代理提现（pending / paid / rejected）
  const existingWd = await db.select({ id: agentWithdrawals.id }).from(agentWithdrawals).limit(1);
  if (existingWd.length === 0) {
    await applySeedWalletTx(db, {
      userId: ctx.studioUserId,
      type: 'withdrawal_freeze',
      amount: -100,
      refNo: 'WD-SEED-STUDIO-01',
      note: '代理佣金提现冻结（待总控审核）',
      createdAt: offsetSqlTime(-5),
    });
    await applySeedWalletTx(db, {
      userId: ctx.nebulaUserId,
      type: 'withdrawal_freeze',
      amount: -200,
      refNo: 'WD-SEED-NEBULA-02',
      note: '代理佣金提现打款出账',
      createdAt: offsetSqlTime(-48),
    });
    await applySeedWalletTx(db, {
      userId: ctx.auroraUserId,
      type: 'withdrawal_freeze',
      amount: -50,
      refNo: 'WD-SEED-AURORA-03',
      note: '代理佣金提现申请冻结',
      createdAt: offsetSqlTime(-30),
    });
    await applySeedWalletTx(db, {
      userId: ctx.auroraUserId,
      type: 'withdrawal_refund',
      amount: 50,
      refNo: 'WD-SEED-AURORA-03',
      note: '提现驳回退回钱包余额',
      createdAt: offsetSqlTime(-28),
    });
    await db.insert(agentWithdrawals).values([
      {
        agentId: ctx.studioAgentId,
        userId: ctx.studioUserId,
        amount: 100,
        feeRate: 0.02,
        feeAmount: 2,
        netAmount: 98,
        channel: 'alipay',
        accountInfo: 'studio.pay@accthub.dev',
        accountName: '林知行',
        status: 'pending',
        createdAt: offsetSqlTime(-5),
      },
      {
        agentId: ctx.nebulaAgentId,
        userId: ctx.nebulaUserId,
        amount: 200,
        feeRate: 0.01,
        feeAmount: 2,
        netAmount: 198,
        channel: 'usdt_trc20',
        accountInfo: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        accountName: '沈星河',
        status: 'paid',
        adminNote: '已通过波场链上打款核验',
        createdAt: offsetSqlTime(-48),
        processedAt: offsetSqlTime(-45),
      },
      {
        agentId: ctx.auroraAgentId,
        userId: ctx.auroraUserId,
        amount: 50,
        feeRate: 0.02,
        feeAmount: 1,
        netAmount: 49,
        channel: 'alipay',
        accountInfo: 'wrong-account-demo',
        accountName: '陆北辰',
        status: 'rejected',
        adminNote: '收款账号信息有误，请核对后重新提交',
        createdAt: offsetSqlTime(-30),
        processedAt: offsetSqlTime(-28),
      },
    ]);
  }

  // 8. 按真实订单与分润账本重算代理汇总统计
  const allAgents = await db.select({ id: agents.id }).from(agents);
  for (const ag of allAgents) {
    const [revRow] = await db
      .select({
        rev: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN ('delivered','paid','upstream_pending') THEN ${orders.totalAmount} ELSE 0 END), 0)`,
      })
      .from(orders)
      .where(eq(orders.agentId, ag.id));
    const [commRow] = await db
      .select({ comm: sql<number>`COALESCE(SUM(${commissionLedger.amount}), 0)` })
      .from(commissionLedger)
      .where(eq(commissionLedger.beneficiaryAgentId, ag.id));
    await db
      .update(agents)
      .set({
        totalRevenue: roundCurrency(Number(revRow?.rev || 0)),
        totalCommission: roundCurrency(Number(commRow?.comm || 0)),
      })
      .where(eq(agents.id, ag.id));
  }

  return { studioDeliveredOrderNo, pulseDeliveredOrderNo };
}
