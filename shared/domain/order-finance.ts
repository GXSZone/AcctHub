/** 已实收且当前未退款的订单，统一用于会员消费和财务收入。 */
export const RECOGNIZED_ORDER_STATUSES: readonly string[] = [
  'paid',
  'delivered',
  'upstream_pending',
  'fulfillment_failed',
];

export const FINANCE_INTEGRITY_CHECK_KEYS = [
  'commission_overflow',
  'refund_reversal',
  'negative_balance',
  'async_payment_sync',
  'promo_ledger_conservation',
  'wallet_ledger_conservation',
  'l1_orphan_deductions',
] as const;
