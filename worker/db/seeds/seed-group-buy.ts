/**
 * 闭环 2B：拼团合租三态场次（进行中差 1 人、已满员成团、已超时自动全额退余额）与补货订阅
 */

import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import type { AppDatabase } from '../../infra/db';
import { groupBuyMembers, groupBuySessions, orderRefunds, orders, restockSubscriptions } from '../schema';
import type { SeededTopologyContext } from './seed-agents-topology';
import { applySeedWalletTx, offsetSqlTime } from './seed-ledger-helper';

export async function seedGroupBuyAndRestockShowcase(
  db: AppDatabase,
  env: Env,
  ctx: SeededTopologyContext,
  groupBuyProductId: number,
  restockProductId: number
): Promise<void> {
  const openOrderNo = 'AH-SEED-GB-OPEN-01';
  const compOrderA = 'AH-SEED-GB-COMP-01';
  const compOrderB = 'AH-SEED-GB-COMP-02';
  const expOrderNo = 'AH-SEED-GB-EXP-01';

  await db
    .insert(groupBuySessions)
    .values([
      {
        code: 'GBDEMO01',
        siteAgentId: 0,
        productId: groupBuyProductId,
        specId: 'default',
        leaderUserId: ctx.memberId,
        leaderName: '苏清和 · 会员',
        requiredSize: 2,
        currentSize: 1,
        groupPrice: 19.9,
        status: 'open',
        expiresAt: offsetSqlTime(20),
        createdAt: offsetSqlTime(-4),
      },
      {
        code: 'GBDONE02',
        siteAgentId: 0,
        productId: groupBuyProductId,
        specId: 'default',
        leaderUserId: ctx.aliceId,
        leaderName: '许知意 · Pro 会员',
        requiredSize: 2,
        currentSize: 2,
        groupPrice: 19.9,
        status: 'completed',
        expiresAt: offsetSqlTime(-24),
        completedAt: offsetSqlTime(-30),
        createdAt: offsetSqlTime(-34),
      },
      {
        code: 'GBEXP003',
        siteAgentId: 0,
        productId: groupBuyProductId,
        specId: 'default',
        leaderUserId: ctx.bobId,
        leaderName: '周明远 · 开发者',
        requiredSize: 2,
        currentSize: 1,
        groupPrice: 19.9,
        status: 'expired',
        expiresAt: offsetSqlTime(-48),
        createdAt: offsetSqlTime(-72),
      },
    ])
    .onConflictDoNothing();

  const gbRows = await db.select().from(groupBuySessions);
  const gbByCode = new Map(gbRows.map((g) => [g.code, g.id]));
  const openGbId = gbByCode.get('GBDEMO01');
  const doneGbId = gbByCode.get('GBDONE02');
  const expGbId = gbByCode.get('GBEXP003');

  if (openGbId) {
    await db
      .insert(orders)
      .values({
        orderNo: openOrderNo,
        publicOrderNo: 'PUB-GB-OPEN01',
        userId: ctx.memberId,
        contactEmail: 'member@accthub.dev',
        productId: groupBuyProductId,
        productTitle: 'Netflix 4K 家庭组 2 人拼团合租 · 满员自动发车',
        specId: 'default',
        specName: '4K 独立子车位 · 30天',
        quantity: 1,
        unitPrice: 19.9,
        totalAmount: 19.9,
        paymentMethod: 'balance',
        status: 'paid',
        groupBuySessionId: openGbId,
        buyerIp: '192.0.2.15',
        createdAt: offsetSqlTime(-4),
      })
      .onConflictDoNothing();
    await applySeedWalletTx(db, {
      userId: ctx.memberId,
      type: 'order_pay',
      amount: -19.9,
      refNo: openOrderNo,
      note: '拼团开团余额支付（Netflix 4K 拼团）',
      createdAt: offsetSqlTime(-4),
    });
    await db
      .insert(groupBuyMembers)
      .values({
        sessionId: openGbId,
        userId: ctx.memberId,
        orderNo: openOrderNo,
        email: 'member@accthub.dev',
        paidAmount: 19.9,
        status: 'paid',
        createdAt: offsetSqlTime(-4),
      })
      .onConflictDoNothing();
  }

  if (doneGbId) {
    for (const [ordNo, pubNo, uid, email, pin] of [
      [compOrderA, 'PUB-GB-COMP01', ctx.aliceId, 'alice@accthub.dev', '7781'],
      [compOrderB, 'PUB-GB-COMP02', ctx.bobId, 'bob@accthub.dev', '7782'],
    ] as const) {
      await db
        .insert(orders)
        .values({
          orderNo: ordNo,
          publicOrderNo: pubNo,
          userId: uid,
          contactEmail: email,
          productId: groupBuyProductId,
          productTitle: 'Netflix 4K 家庭组 2 人拼团合租 · 满员自动发车',
          specId: 'default',
          specName: '4K 独立子车位 · 30天',
          quantity: 1,
          unitPrice: 19.9,
          totalAmount: 19.9,
          paymentMethod: 'balance',
          status: 'delivered',
          deliveredAt: offsetSqlTime(-30),
          deliveredPayload: await sealDeliveryPayload(
            env,
            ordNo,
            `nf.group.done@stream.demo----Pass#Done26----PIN:${pin}`
          ),
          groupBuySessionId: doneGbId,
          buyerIp: '192.0.2.31',
          createdAt: offsetSqlTime(-34),
        })
        .onConflictDoNothing();
      await applySeedWalletTx(db, {
        userId: uid,
        type: 'order_pay',
        amount: -19.9,
        refNo: ordNo,
        note: '拼团成团余额支付（Netflix 4K 拼团）',
        createdAt: offsetSqlTime(-34),
      });
      await db
        .insert(groupBuyMembers)
        .values({
          sessionId: doneGbId,
          userId: uid,
          orderNo: ordNo,
          email,
          paidAmount: 19.9,
          status: 'delivered',
          createdAt: offsetSqlTime(-34),
        })
        .onConflictDoNothing();
    }
  }

  if (expGbId) {
    await db
      .insert(orders)
      .values({
        orderNo: expOrderNo,
        publicOrderNo: 'PUB-GB-EXP01',
        userId: ctx.bobId,
        contactEmail: 'bob@accthub.dev',
        productId: groupBuyProductId,
        productTitle: 'Netflix 4K 家庭组 2 人拼团合租 · 满员自动发车',
        specId: 'default',
        specName: '4K 独立子车位 · 30天',
        quantity: 1,
        unitPrice: 19.9,
        totalAmount: 19.9,
        paymentMethod: 'balance',
        status: 'refunded',
        groupBuySessionId: expGbId,
        buyerIp: '192.0.2.44',
        createdAt: offsetSqlTime(-72),
      })
      .onConflictDoNothing();
    await applySeedWalletTx(db, {
      userId: ctx.bobId,
      type: 'order_pay',
      amount: -19.9,
      refNo: expOrderNo,
      note: '拼团开团余额支付（未成团）',
      createdAt: offsetSqlTime(-72),
    });
    await applySeedWalletTx(db, {
      userId: ctx.bobId,
      type: 'refund',
      amount: 19.9,
      refNo: expOrderNo,
      note: '拼团超时自动全额退回余额',
      createdAt: offsetSqlTime(-48),
    });
    await db
      .insert(orderRefunds)
      .values({
        orderNo: expOrderNo,
        operationId: 'REF-SEED-GB-EXP-01',
        siteAgentId: 0,
        mode: 'automatic',
        route: 'wallet',
        status: 'succeeded',
        provider: 'balance',
        originalPayment: expOrderNo,
        currency: 'CNY',
        amount: 19.9,
        amountCny: 19.9,
        createdAt: offsetSqlTime(-48),
        updatedAt: offsetSqlTime(-48),
      })
      .onConflictDoNothing();
    await db
      .insert(groupBuyMembers)
      .values({
        sessionId: expGbId,
        userId: ctx.bobId,
        orderNo: expOrderNo,
        email: 'bob@accthub.dev',
        paidAmount: 19.9,
        status: 'refunded',
        createdAt: offsetSqlTime(-72),
      })
      .onConflictDoNothing();
  }

  await db
    .insert(restockSubscriptions)
    .values([
      {
        siteAgentId: 0,
        productId: restockProductId,
        specId: 'default',
        email: 'waitlist.user1@example.test',
        status: 'waiting',
      },
      {
        siteAgentId: ctx.studioAgentId,
        productId: restockProductId,
        specId: 'default',
        email: 'sub.buyer@studio.demo',
        status: 'notified',
        notifiedAt: offsetSqlTime(-12),
      },
    ])
    .onConflictDoNothing();
}
