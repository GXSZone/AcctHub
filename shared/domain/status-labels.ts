import type {
  DeliveryType,
  OrderStatus,
  TicketCategory,
  TicketStatus,
  UpstreamOrderStatus,
  WithdrawalStatus,
} from '../constants/enums';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: '待支付',
  grouping: '拼团中',
  paid: '已付款',
  delivered: '已交付',
  upstream_pending: '上游出卡中',
  fulfillment_failed: '出卡异常待补发',
  risk_review: '风控人工审核中',
  refunded: '已退款',
  expired: '已超时关闭',
};

export const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  auto: '边缘自动发卡',
  api_key: '秒发 API Key',
  manual: '人工代充',
  preorder: '可预订交付',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: '待处理',
  replied: '已回复',
  agent_replied: '分站已回复',
  escalated: '已转交总控',
  admin_replied: '总控已回复',
  resolved: '已解决',
  closed: '已关闭',
};

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  after_sale: '售后质保',
  order_issue: '订单异常',
  account_issue: '账号使用',
  recharge: '充值账务',
  other: '其他咨询',
};

export const UPSTREAM_ORDER_STATUS_LABELS: Record<UpstreamOrderStatus, string> = {
  none: '本地出卡',
  pending: '上游处理中',
  delivered: '上游已交付',
  succeeded: '采购成功',
  timeout_unknown: '超时待核单',
  failed: '采购失败',
};

export const WITHDRAWAL_STATUS_LABELS: Record<WithdrawalStatus, string> = {
  pending: '待审核',
  approved: '已批准',
  rejected: '已驳回',
  paid: '已打款',
};

export function getOrderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as OrderStatus] ?? status;
}

export function getDeliveryTypeLabel(type: string): string {
  return DELIVERY_TYPE_LABELS[type as DeliveryType] ?? '边缘自动发卡';
}
