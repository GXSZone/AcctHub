import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowSql = sql`(datetime('now'))`;

/** 钱包资金流水账本表 */
export const walletTransactions = sqliteTable(
  'wallet_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    type: text('type').notNull(),
    amount: real('amount').notNull(),
    balanceAfter: real('balance_after').notNull().default(0),
    refNo: text('ref_no').notNull().default(''),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_wallet_tx_user').on(t.userId, t.id)]
);

/** 优惠券表（按 owner_agent_id 租户隔离，不同分站可使用同名券码） */
export const coupons = sqliteTable(
  'coupons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerAgentId: integer('owner_agent_id').notNull().default(0),
    code: text('code').notNull(),
    name: text('name').notNull(),
    discountType: text('discount_type').notNull().default('fixed'),
    discountValue: real('discount_value').notNull().default(5),
    minOrderAmount: real('min_order_amount').notNull().default(0),
    maxUses: integer('max_uses').notNull().default(100),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: text('expires_at'),
    isActive: integer('is_active').notNull().default(1),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [uniqueIndex('uq_coupons_owner_code').on(t.ownerAgentId, t.code)]
);

/** 充值卡密 CDK 表 */
export const rechargeCdks = sqliteTable(
  'recharge_cdks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull().unique(),
    amount: real('amount').notNull(),
    status: text('status').notNull().default('available'),
    usedByUserId: integer('used_by_user_id'),
    usedByEmail: text('used_by_email'),
    usedAt: text('used_at'),
    batchNote: text('batch_note').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_cdks_status').on(t.status)]
);

/** 会员/代理充值升级记录表 */
export const rechargeRecords = sqliteTable(
  'recharge_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    amount: real('amount').notNull(),
    paymentMethod: text('payment_method').notNull().default('balance'),
    unlockedTierName: text('unlocked_tier_name').notNull().default(''),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [index('idx_recharge_user').on(t.userId)]
);

/** 订单主表（含下单时固化的质保快照与异步支付关联） */
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderNo: text('order_no').notNull().unique(),
    userId: integer('user_id'),
    agentId: integer('agent_id'),
    tenantSlug: text('tenant_slug'),
    contactEmail: text('contact_email').notNull(),
    publicOrderNo: text('public_order_no'),
    lookupUrl: text('lookup_url'),
    queryPasswordHash: text('query_password_hash'),
    checkoutSecretHash: text('checkout_secret_hash'),
    checkoutPayloadHash: text('checkout_payload_hash'),
    productId: integer('product_id').notNull(),
    productOwnerAgentId: integer('product_owner_agent_id').notNull().default(0),
    settlementMode: text('settlement_mode').notNull().default('platform_collect'),
    productTitle: text('product_title').notNull(),
    specId: text('spec_id').notNull().default('default'),
    specName: text('spec_name').notNull().default(''),
    quantity: integer('quantity').notNull().default(1),
    unitPrice: real('unit_price').notNull(),
    totalAmount: real('total_amount').notNull(),
    discountAmount: real('discount_amount').notNull().default(0),
    couponCode: text('coupon_code'),
    couponDiscount: real('coupon_discount').notNull().default(0),
    promoUsedAmount: real('promo_used_amount').notNull().default(0),
    commissionAmount: real('commission_amount').notNull().default(0),
    paymentMethod: text('payment_method').notNull().default('balance'),
    channel: text('channel').notNull().default('web'),
    status: text('status').notNull().default('paid'),
    customInputsJson: text('custom_inputs_json').notNull().default('{}'),
    deliveredPayload: text('delivered_payload').notNull().default(''),
    idempotencyKey: text('idempotency_key'),
    resellerRequestDigest: text('reseller_request_digest'),
    fulfillmentSource: text('fulfillment_source').notNull().default('local'),
    upstreamSourceId: integer('upstream_source_id'),
    upstreamOrderNo: text('upstream_order_no').notNull().default(''),
    upstreamCostTotal: real('upstream_cost_total').notNull().default(0),
    upstreamStatus: text('upstream_status').notNull().default('none'),
    upstreamError: text('upstream_error').notNull().default(''),
    warrantyType: text('warranty_type').notNull().default('full_period'),
    deliveredAt: text('delivered_at'),
    warrantyDays: integer('warranty_days').notNull().default(30),
    warrantySummary: text('warranty_summary').notNull().default(''),
    paymentIntentNo: text('payment_intent_no'),
    paymentExpiresAt: text('payment_expires_at'),
    createdAt: text('created_at').notNull().default(nowSql),
    buyerIp: text('buyer_ip').notNull().default(''),
    paymentFeeAmount: real('payment_fee_amount').notNull().default(0),
    riskFlag: text('risk_flag').notNull().default(''),
    riskNote: text('risk_note').notNull().default(''),
    groupBuySessionId: integer('group_buy_session_id'),
    renewalRemindedAt: text('renewal_reminded_at').notNull().default(''),
  },
  (t) => [
    index('idx_orders_agent_created').on(t.agentId, t.id),
    index('idx_orders_email').on(t.contactEmail),
    index('idx_orders_status').on(t.status),
    index('idx_orders_user_site_page').on(t.userId, t.agentId, t.id),
    index('idx_orders_buyer_ip').on(t.buyerIp, t.createdAt),
    index('idx_orders_group_buy_session').on(t.groupBuySessionId),
    index('idx_orders_renewal_scan').on(t.status, t.renewalRemindedAt, t.deliveredAt),
    uniqueIndex('uq_orders_public_order_no').on(t.publicOrderNo),
    uniqueIndex('uq_orders_main_checkout_key')
      .on(t.idempotencyKey)
      .where(sql`${t.agentId} IS NULL AND ${t.checkoutPayloadHash} IS NOT NULL`),
    uniqueIndex('uq_orders_subsite_checkout_key')
      .on(t.agentId, t.idempotencyKey)
      .where(sql`${t.agentId} IS NOT NULL AND ${t.checkoutPayloadHash} IS NOT NULL`),
    uniqueIndex('uq_orders_reseller_idempotency')
      .on(t.agentId, t.idempotencyKey)
      .where(
        sql`${t.channel} = 'reseller_api' AND ${t.idempotencyKey} IS NOT NULL AND ${t.idempotencyKey} <> ''`
      ),
  ]
);

/** 统一异步支付单表（覆盖商品下单、钱包充值、代理升级三大收单场景） */
export const paymentIntents = sqliteTable(
  'payment_intents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    intentNo: text('intent_no').notNull().unique(),
    bizType: text('biz_type').notNull().default('order'),
    bizRef: text('biz_ref').notNull(),
    userId: integer('user_id'),
    siteAgentId: integer('site_agent_id').notNull().default(0),
    paymentOwnerAgentId: integer('payment_owner_agent_id').notNull().default(0),
    settlementMode: text('settlement_mode').notNull().default('platform_collect'),
    provider: text('provider').notNull(),
    currency: text('currency').notNull().default('CNY'),
    amountCny: real('amount_cny').notNull(),
    payAmount: real('pay_amount').notNull(),
    payUrl: text('pay_url').notNull().default(''),
    qrContent: text('qr_content').notNull().default(''),
    providerTradeNo: text('provider_trade_no').notNull().default(''),
    status: text('status').notNull().default('pending'),
    fulfillStatus: text('fulfill_status').notNull().default('pending'),
    fulfillError: text('fulfill_error').notNull().default(''),
    fulfillLeaseToken: text('fulfill_lease_token'),
    fulfillLeaseUntil: text('fulfill_lease_until'),
    payloadJson: text('payload_json').notNull().default('{}'),
    expiresAt: text('expires_at').notNull(),
    paidAt: text('paid_at'),
    createdAt: text('created_at').notNull().default(nowSql),
  },
  (t) => [
    index('idx_payment_intents_biz').on(t.bizType, t.bizRef),
    index('idx_payment_intents_provider_status_amt').on(t.provider, t.status, t.payAmount),
    uniqueIndex('uq_payment_intents_provider_trade')
      .on(t.provider, t.providerTradeNo)
      .where(sql`${t.status} = 'paid' AND ${t.providerTradeNo} <> ''`),
    uniqueIndex('uq_usdt_active_pay_amount')
      .on(t.provider, t.payAmount)
      .where(sql`${t.provider} IN ('usdt_trc20', 'usdt_bep20', 'usdt_erc20') AND ${t.status} = 'pending'`),
  ]
);

export type OrderRow = typeof orders.$inferSelect;
export type PaymentIntentDbRow = typeof paymentIntents.$inferSelect;
