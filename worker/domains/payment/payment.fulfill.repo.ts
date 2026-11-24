import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  commissionLedger,
  coupons,
  paymentIntents,
  paymentPlugins,
  productCards,
  rechargeRecords,
  upstreamOrders,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import {
  mapPaymentIntentRow,
  type PaymentFulfillLease,
  type PaymentIntentRow,
  paymentFulfillLeaseGuard,
} from './payment.repo';

/** 查询订单在补偿中断前是否已成功分配本地卡密，防重试时重复扣库 */
export async function findClaimedCardsByOrderNoRepo(db: AppDatabase, orderNo: string) {
  return db
    .select({ id: productCards.id, cardContent: productCards.cardContent })
    .from(productCards)
    .where(and(eq(productCards.orderNo, orderNo), eq(productCards.status, 'sold')))
    .orderBy(asc(productCards.id));
}

/** 查询订单在补偿中断前是否已发出上游采购单 */
export async function findExistingUpstreamOrderForLocalNoRepo(db: AppDatabase, localOrderNo: string) {
  const rows = await db
    .select()
    .from(upstreamOrders)
    .where(and(eq(upstreamOrders.localOrderNo, localOrderNo), eq(upstreamOrders.purpose, 'order_fulfill')))
    .orderBy(sql`${upstreamOrders.id} DESC`)
    .limit(1);
  return rows[0] ?? null;
}

/** 查询代理升级佣金台账是否已以 refNo 写入过，防补偿重放双发升级费 */
export async function hasCommissionLedgerByRefRepo(db: AppDatabase, refNo: string): Promise<boolean> {
  if (!refNo) return false;
  const rows = await db
    .select({ id: commissionLedger.id })
    .from(commissionLedger)
    .where(eq(commissionLedger.orderNo, refNo))
    .limit(1);
  return rows.length > 0;
}

/** 查询代理升级支付单是否已完成累计充值与升级记录落库（幂等防重） */
export async function hasAgentUpgradeRechargeRecordRepo(
  db: AppDatabase,
  userId: number,
  amount: number,
  paymentMethod: string,
  sinceSqlTime: string
): Promise<boolean> {
  const rows = await db
    .select({ id: rechargeRecords.id })
    .from(rechargeRecords)
    .where(
      and(
        eq(rechargeRecords.userId, userId),
        eq(rechargeRecords.amount, Number(amount.toFixed(2))),
        eq(rechargeRecords.paymentMethod, paymentMethod),
        gte(rechargeRecords.createdAt, sinceSqlTime)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** CAS 原子按券码核销优惠券（校验 maxUses 上限防异步下单超发） */
export async function claimCouponUsageByCodeAtomic(
  db: AppDatabase,
  couponCode: string,
  lease: PaymentFulfillLease
): Promise<boolean> {
  const intent = eq(paymentIntents.intentNo, lease.intentNo);
  const prior = sql<number>`json_extract(${paymentIntents.payloadJson}, '$.fulfill_coupon_id')`;
  const guard = paymentFulfillLeaseGuard(lease);
  const intentSite = db
    .select({ siteAgentId: paymentIntents.siteAgentId })
    .from(paymentIntents)
    .where(intent);
  const candidate = db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.ownerAgentId, sql`coalesce((${intentSite}), 0)`),
        sql`upper(${coupons.code}) = ${couponCode.toUpperCase()}`
      )
    )
    .orderBy(asc(coupons.id))
    .limit(1);
  const claim = db
    .update(coupons)
    .set({ usedCount: sql`${coupons.usedCount} + 1` })
    .where(
      and(
        eq(coupons.id, sql`(${candidate})`),
        eq(coupons.isActive, 1),
        sql`(${coupons.maxUses} <= 0 OR ${coupons.usedCount} < ${coupons.maxUses})`,
        guard,
        sql`(${db.select({ id: prior }).from(paymentIntents).where(intent)}) IS NULL`
      )
    );
  const checkpoint = db
    .update(paymentIntents)
    .set({ payloadJson: sql`json_set(${paymentIntents.payloadJson}, '$.fulfill_coupon_id', (${candidate}))` })
    .where(and(intent, sql`changes() = 1`));
  const [, , result] = await db.batch([
    claim,
    checkpoint,
    db.select({ id: prior }).from(paymentIntents).where(and(intent, guard)),
  ]);
  return Boolean(result[0]?.id);
}

/** 只退还这笔支付已核销的优惠券，重复恢复不会退还别的订单用量。 */
export async function rollbackPaymentCouponUsage(db: AppDatabase, lease: PaymentFulfillLease): Promise<void> {
  const intent = eq(paymentIntents.intentNo, lease.intentNo);
  const guard = paymentFulfillLeaseGuard(lease);
  const claimedCoupon = db
    .select({
      id: sql<number>`json_extract(${paymentIntents.payloadJson}, '$.fulfill_coupon_id')`,
    })
    .from(paymentIntents)
    .where(intent);
  await db.batch([
    db
      .update(coupons)
      .set({ usedCount: sql`max(0, ${coupons.usedCount} - 1)` })
      .where(and(eq(coupons.id, sql`(${claimedCoupon})`), guard)),
    db
      .update(paymentIntents)
      .set({ payloadJson: sql`json_remove(${paymentIntents.payloadJson}, '$.fulfill_coupon_id')` })
      .where(and(intent, or(sql`changes() = 1`, guard))),
  ]);
}

/** 查询活跃与 2 小时滞后保护窗内刚过期的 USDT 支付单（用于 L3 迟到转账补核销） */
export async function listUsdtMatchCandidatesRepo(db: AppDatabase): Promise<PaymentIntentRow[]> {
  const rows = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        inArray(paymentIntents.provider, ['usdt_trc20', 'usdt_bep20', 'usdt_erc20']),
        or(
          eq(paymentIntents.status, 'pending'),
          and(
            eq(paymentIntents.status, 'expired'),
            sql`${paymentIntents.expiresAt} >= datetime('now', '-2 hours')`
          )
        )
      )
    )
    .orderBy(asc(paymentIntents.id))
    .limit(120);
  return rows.map(mapPaymentIntentRow);
}

/** 查找同收款地址、金额和时间窗口内的候选，发现多笔时由人工对账。 */
export async function findUsdtTransferCandidatesRepo(
  db: AppDatabase,
  input: { provider: string; recipient: string; payAmount: number; timestamp: string }
) {
  const recipientMatches =
    input.provider === 'usdt_trc20'
      ? eq(paymentIntents.qrContent, input.recipient)
      : sql`lower(${paymentIntents.qrContent}) = ${input.recipient}`;
  return db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.provider, input.provider),
        eq(paymentIntents.currency, 'USDT'),
        eq(paymentIntents.payAmount, input.payAmount),
        recipientMatches,
        inArray(paymentIntents.status, ['pending', 'expired']),
        sql`${paymentIntents.createdAt} <= ${input.timestamp}`,
        sql`${input.timestamp} <= datetime(${paymentIntents.expiresAt}, '+2 hours')`
      )
    )
    .limit(2);
}

/** 批量查询已被已付款支付单占用的链上交易哈希集合（S5 防一笔转账核销两单） */
export async function listMatchedProviderTradeNosRepo(
  db: AppDatabase,
  provider: string,
  tradeNos: string[]
): Promise<Set<string>> {
  const unique = Array.from(new Set(tradeNos.map((t) => t.trim()).filter(Boolean)));
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ providerTradeNo: paymentIntents.providerTradeNo })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.provider, provider),
        eq(paymentIntents.status, 'paid'),
        inArray(paymentIntents.providerTradeNo, unique)
      )
    );
  return new Set(rows.map((r) => r.providerTradeNo));
}

/** 幂等补齐新增异步支付插件元数据（支付宝当面付 RSA2 + USDT BEP20/ERC20 多链） */
export async function ensureExtendedPaymentPluginsRepo(db: AppDatabase): Promise<void> {
  await db
    .insert(paymentPlugins)
    .values([
      {
        id: 'alipay_f2f',
        name: '支付宝官方当面付（RSA2 扫码）',
        description: '直连支付宝官方预下单接口生成收款二维码，纯边缘 RSA2 签名验签',
        enabled: 0,
        configJson: JSON.stringify({
          app_id: '',
          private_key: '',
          alipay_public_key: '',
          gateway_url: 'https://openapi.alipay.com/gateway.do',
        }),
      },
      {
        id: 'usdt_bep20',
        name: 'USDT BEP20（BSC 币安智能链）',
        description: '低 Gas 费 BSC 链上 4 位尾数防撞单与自动核单',
        enabled: 0,
        configJson: JSON.stringify({
          wallet_address: '',
          usdt_cny_rate: '7.25',
          rate_markup: '0.02',
          auto_fx: 'true',
          explorer_api_key: '',
        }),
      },
      {
        id: 'usdt_erc20',
        name: 'USDT ERC20（以太坊主网）',
        description: '以太坊主网 4 位尾数防撞单与链上自动核单',
        enabled: 0,
        configJson: JSON.stringify({
          wallet_address: '',
          usdt_cny_rate: '7.25',
          rate_markup: '0.02',
          auto_fx: 'true',
          explorer_api_key: '',
        }),
      },
    ])
    .onConflictDoNothing();
}
