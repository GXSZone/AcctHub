/**
 * 闭环 3A：主站优惠券/CDK/在线充值、主站直客/推广返佣/到期提醒/游客收银台/待支付订单
 */

import { roundCurrency } from '@shared/domain/money';
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import type { AppDatabase } from '../../infra/db';
import {
  affiliateLedgers,
  coupons,
  orders,
  paymentIntents,
  products,
  rechargeCdks,
  rechargeRecords,
} from '../schema';
import type { SeededTopologyContext } from './seed-agents-topology';
import { applySeedPromoTx, applySeedWalletTx, offsetSqlTime } from './seed-ledger-helper';
import { seedMultiLevelAgentOrdersAndWithdrawals } from './seed-orders-agents';

export async function seedTransactionsAndFinanceLedger(
  db: AppDatabase,
  env: Env,
  ctx: SeededTopologyContext
): Promise<{
  mainDeliveredOrderNo: string;
  studioDeliveredOrderNo: string;
  pulseDeliveredOrderNo: string;
  expiringOrderNo: string;
}> {
  const [primaryProd] = await db
    .select({ id: products.id, title: products.title, basePrice: products.basePrice })
    .from(products)
    .where(eq(products.ownerAgentId, 0))
    .limit(1);
  if (!primaryProd) throw new Error('缺少主站基础商品，无法生成交易账本');

  // 1. 优惠券矩阵
  await db
    .insert(coupons)
    .values([
      {
        ownerAgentId: 0,
        code: 'VIP85',
        name: '会员全场 85 折优惠券',
        discountType: 'percent',
        discountValue: 15,
        minOrderAmount: 100,
        maxUses: 200,
        usedCount: 2,
        isActive: 1,
      },
      {
        ownerAgentId: 0,
        code: 'EXPIRED2025',
        name: '已停用历史活动券',
        discountType: 'fixed',
        discountValue: 20,
        minOrderAmount: 80,
        maxUses: 50,
        usedCount: 50,
        isActive: 0,
      },
      {
        ownerAgentId: ctx.studioAgentId,
        code: 'STUDIO5',
        name: '星尘分站专享立减 ¥5',
        discountType: 'fixed',
        discountValue: 5,
        minOrderAmount: 30,
        maxUses: 100,
        usedCount: 1,
        isActive: 1,
      },
    ])
    .onConflictDoNothing();

  // 2. 充值 CDK 与在线充值支付单
  await db
    .insert(rechargeCdks)
    .values([
      { code: 'AH-CDK-DEMO-50-001', amount: 50, status: 'available', batchNote: '沙盒测试 ¥50 充值卡' },
      { code: 'AH-CDK-DEMO-100-002', amount: 100, status: 'available', batchNote: '沙盒测试 ¥100 充值卡' },
      {
        code: 'AH-CDK-USED-100-003',
        amount: 100,
        status: 'used',
        usedByUserId: ctx.aliceId,
        usedByEmail: 'alice@accthub.dev',
        usedAt: offsetSqlTime(-96),
        batchNote: '历史已核销批次',
      },
    ])
    .onConflictDoNothing();

  const rechargeIntentNo = 'PAY-SEED-RCH-ALICE-01';
  await db
    .insert(paymentIntents)
    .values({
      intentNo: rechargeIntentNo,
      bizType: 'wallet_recharge',
      bizRef: `RCH-${ctx.aliceId}`,
      userId: ctx.aliceId,
      siteAgentId: 0,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 100,
      payAmount: 100,
      providerTradeNo: 'EPAY-TRADE-RCH-001',
      status: 'paid',
      fulfillStatus: 'done',
      expiresAt: offsetSqlTime(-119),
      paidAt: offsetSqlTime(-120),
      createdAt: offsetSqlTime(-120),
    })
    .onConflictDoNothing();
  if (
    await applySeedWalletTx(db, {
      userId: ctx.aliceId,
      type: 'recharge',
      amount: 100,
      refNo: rechargeIntentNo,
      note: '易支付在线钱包充值（沙盒已到账）',
      createdAt: offsetSqlTime(-120),
    })
  ) {
    await db.insert(rechargeRecords).values({
      userId: ctx.aliceId,
      amount: 100,
      paymentMethod: 'epay',
      createdAt: offsetSqlTime(-120),
    });
  }

  // 3. 主站会员下单（含 Affiliate 推广返佣）
  const mainDeliveredOrderNo = 'AH-SEED-MAIN-001';
  await db
    .insert(orders)
    .values({
      orderNo: mainDeliveredOrderNo,
      publicOrderNo: 'PUB-MAIN-001',
      userId: ctx.aliceId,
      contactEmail: 'alice@accthub.dev',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '标准月卡',
      quantity: 1,
      unitPrice: 148,
      totalAmount: 138,
      discountAmount: 10,
      couponCode: 'WELCOME10',
      couponDiscount: 10,
      paymentMethod: 'balance',
      status: 'delivered',
      deliveredAt: offsetSqlTime(-96),
      deliveredPayload: await sealDeliveryPayload(
        env,
        mainDeliveredOrderNo,
        'alice.claude.vip@accthub.mail----Pass#Alice2026----2FA:JBSWY3DPEHPK3PXP'
      ),
      buyerIp: '192.0.2.21',
      createdAt: offsetSqlTime(-96),
    })
    .onConflictDoNothing();
  await applySeedWalletTx(db, {
    userId: ctx.aliceId,
    type: 'order_pay',
    amount: -138,
    refNo: mainDeliveredOrderNo,
    note: `余额购买：${primaryProd.title}`,
    createdAt: offsetSqlTime(-96),
  });

  const affReward = roundCurrency(138 * 0.05);
  await db
    .insert(affiliateLedgers)
    .values({
      referrerUserId: ctx.memberId,
      buyerUserId: ctx.aliceId,
      orderNo: mainDeliveredOrderNo,
      orderAmount: 138,
      commissionRate: 0.05,
      rewardAmount: affReward,
      status: 'settled',
      createdAt: offsetSqlTime(-95),
    })
    .onConflictDoNothing();
  await applySeedPromoTx(db, {
    userId: ctx.memberId,
    type: 'affiliate_reward',
    amount: affReward,
    refNo: mainDeliveredOrderNo,
    note: '好友首次下单推广返佣 (5%)',
    createdAt: offsetSqlTime(-95),
  });

  // 4. 即将到期订阅单（28 天前交付、30 天质保 + 推广金抵扣 ¥2）
  const expiringOrderNo = 'AH-SEED-EXPIRING-002';
  await db
    .insert(orders)
    .values({
      orderNo: expiringOrderNo,
      publicOrderNo: 'PUB-EXPIRING-002',
      userId: ctx.memberId,
      contactEmail: 'member@accthub.dev',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '30天独享席位',
      quantity: 1,
      unitPrice: 68,
      totalAmount: 66,
      promoUsedAmount: 2,
      paymentMethod: 'balance',
      status: 'delivered',
      warrantyDays: 30,
      deliveredAt: offsetSqlTime(-28 * 24),
      deliveredPayload: await sealDeliveryPayload(
        env,
        expiringOrderNo,
        'member.renew.demo@accthub.mail----Pass#Renew26----2FA:JBSWY3DPEHPK3PXP'
      ),
      buyerIp: '192.0.2.15',
      createdAt: offsetSqlTime(-28 * 24),
    })
    .onConflictDoNothing();
  await applySeedPromoTx(db, {
    userId: ctx.memberId,
    type: 'order_use',
    amount: -2,
    refNo: expiringOrderNo,
    note: '下单自动抵扣推广消费金',
    createdAt: offsetSqlTime(-28 * 24),
  });
  await applySeedWalletTx(db, {
    userId: ctx.memberId,
    type: 'order_pay',
    amount: -66,
    refNo: expiringOrderNo,
    note: '余额下单（叠加推广金 ¥2 抵扣）',
    createdAt: offsetSqlTime(-28 * 24),
  });

  // 5. 游客支付宝当面付异步已交付单 & 待支付单
  const guestOrderNo = 'AH-SEED-GUEST-003';
  const guestIntentNo = 'PAY-SEED-GUEST-003';
  await db
    .insert(orders)
    .values({
      orderNo: guestOrderNo,
      publicOrderNo: 'PUB-GUEST-003',
      contactEmail: 'guest.vip@example.test',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '游客极速席位',
      quantity: 1,
      unitPrice: 128,
      totalAmount: 128,
      paymentMethod: 'alipay_f2f',
      paymentIntentNo: guestIntentNo,
      status: 'delivered',
      deliveredAt: offsetSqlTime(-72),
      deliveredPayload: await sealDeliveryPayload(
        env,
        guestOrderNo,
        'guest.seat.03@accthub.mail----Pass#G03'
      ),
      buyerIp: '192.0.2.77',
      createdAt: offsetSqlTime(-72),
    })
    .onConflictDoNothing();
  await db
    .insert(paymentIntents)
    .values({
      intentNo: guestIntentNo,
      bizType: 'order',
      bizRef: guestOrderNo,
      provider: 'alipay_f2f',
      currency: 'CNY',
      amountCny: 128,
      payAmount: 128,
      providerTradeNo: 'ALIPAY-2026-DEMO-003',
      status: 'paid',
      fulfillStatus: 'done',
      expiresAt: offsetSqlTime(-71),
      paidAt: offsetSqlTime(-72),
      createdAt: offsetSqlTime(-72),
    })
    .onConflictDoNothing();

  const pendingOrderNo = 'AH-SEED-PENDING-010';
  const pendingIntentNo = 'PAY-SEED-PEND-010';
  await db
    .insert(orders)
    .values({
      orderNo: pendingOrderNo,
      publicOrderNo: 'PUB-PEND-010',
      contactEmail: 'pending.buyer@example.test',
      productId: primaryProd.id,
      productTitle: primaryProd.title,
      specId: 'default',
      specName: '标准月卡',
      quantity: 1,
      unitPrice: 99,
      totalAmount: 99,
      paymentMethod: 'epay',
      paymentIntentNo: pendingIntentNo,
      paymentExpiresAt: offsetSqlTime(1),
      status: 'pending_payment',
      buyerIp: '192.0.2.120',
      createdAt: offsetSqlTime(-1),
    })
    .onConflictDoNothing();
  await db
    .insert(paymentIntents)
    .values({
      intentNo: pendingIntentNo,
      bizType: 'order',
      bizRef: pendingOrderNo,
      provider: 'epay',
      currency: 'CNY',
      amountCny: 99,
      payAmount: 99,
      status: 'pending',
      fulfillStatus: 'pending',
      expiresAt: offsetSqlTime(1),
      createdAt: offsetSqlTime(-1),
    })
    .onConflictDoNothing();

  const agentOrders = await seedMultiLevelAgentOrdersAndWithdrawals(db, env, ctx, primaryProd);
  return { mainDeliveredOrderNo, expiringOrderNo, ...agentOrders };
}
