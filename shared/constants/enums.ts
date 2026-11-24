export const USER_ROLES = ['user', 'agent', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DELIVERY_TYPES = ['auto', 'api_key', 'manual', 'preorder'] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const STOCK_MODES = ['cards', 'seats', 'manual_stock'] as const;
export type StockMode = (typeof STOCK_MODES)[number];

export const WARRANTY_TYPES = ['full_period', 'days', 'first_login', 'none'] as const;
export type WarrantyType = (typeof WARRANTY_TYPES)[number];

export const WARRANTY_STATUSES = ['in_warranty', 'expired', 'first_login', 'none', 'not_started'] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'grouping',
  'paid',
  'delivered',
  'upstream_pending',
  'fulfillment_failed',
  'risk_review',
  'refunded',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_INTENT_STATUSES = ['pending', 'paid', 'expired', 'failed'] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const PAYMENT_BIZ_TYPES = ['order', 'wallet_recharge', 'agent_upgrade'] as const;
export type PaymentBizType = (typeof PAYMENT_BIZ_TYPES)[number];

export const ASYNC_PAYMENT_PROVIDERS = [
  'epay',
  'stripe',
  'alipay_f2f',
  'usdt_trc20',
  'usdt_bep20',
  'usdt_erc20',
] as const;
export type AsyncPaymentProvider = (typeof ASYNC_PAYMENT_PROVIDERS)[number];

export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const ORDER_CHANNELS = ['web', 'reseller_api'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const FULFILLMENT_SOURCES = ['local', 'upstream'] as const;
export type FulfillmentSource = (typeof FULFILLMENT_SOURCES)[number];

export const FULFILLMENT_MODES = ['local_first', 'upstream_only'] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

export const ROUTING_STRATEGIES = ['priority', 'lowest_cost'] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const UPSTREAM_ADAPTER_TYPES = [
  'accthub_v1',
  'acgfaka',
  'dujiaoka_like',
  'generic_json',
  'mock_sandbox',
] as const;
export type UpstreamAdapterType = (typeof UPSTREAM_ADAPTER_TYPES)[number];

// 上游鉴权模式枚举（与前后端实际支持的鉴权协议严格一致）
export const UPSTREAM_AUTH_MODES = [
  'header_bearer',
  'header_custom',
  'acgfaka_sign',
  'acgfaka_md5',
  'hmac_sha256',
  'custom_body',
] as const;
export type UpstreamAuthMode = (typeof UPSTREAM_AUTH_MODES)[number];

// 上游缺货处理策略枚举
export const UPSTREAM_OUT_OF_STOCK_ACTIONS = ['mark_sold_out', 'auto_unpublish', 'unpublish'] as const;
export type UpstreamOutOfStockAction = (typeof UPSTREAM_OUT_OF_STOCK_ACTIONS)[number];

// 上游沙盒仿真模式枚举
export const UPSTREAM_SANDBOX_MODES = [
  'normal',
  'always_fail',
  'always_async',
  'always_timeout',
  'out_of_stock',
  'async_pending',
  'timeout_error',
] as const;
export type UpstreamSandboxMode = (typeof UPSTREAM_SANDBOX_MODES)[number];

export const UPSTREAM_ORDER_STATUSES = [
  'none',
  'pending',
  'delivered',
  'succeeded',
  'timeout_unknown',
  'failed',
] as const;
export type UpstreamOrderStatus = (typeof UPSTREAM_ORDER_STATUSES)[number];

// 售后工单完整状态机枚举
export const TICKET_STATUSES = [
  'open',
  'replied',
  'agent_replied',
  'escalated',
  'admin_replied',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = ['after_sale', 'order_issue', 'account_issue', 'recharge', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

// 边缘发信服务商枚举
export const MAIL_PROVIDERS = ['resend', 'brevo', 'mailgun', 'custom_webhook'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];

export const AI_PROVIDERS = ['openai_compatible', 'anthropic', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const ANNOUNCEMENT_AUDIENCES = ['storefront', 'direct_downlines'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_LEVELS = ['info', 'highlight', 'warning'] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

export const WITHDRAWAL_STATUSES = ['pending', 'approved', 'rejected', 'paid'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

// 钱包交易流水类型枚举
export const WALLET_TX_TYPES = [
  'recharge',
  'cdk',
  'cdk_redeem',
  'order_pay',
  'refund',
  'order_refund',
  'commission',
  'commission_clawback',
  'withdraw',
  'withdrawal',
  'withdraw_refund',
  'withdrawal_refund',
  'agent_upgrade',
  'admin_adjust',
] as const;
export type WalletTxType = (typeof WALLET_TX_TYPES)[number];

export const CARD_STATUSES = ['available', 'sold', 'disabled'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const TENANT_RESOLUTION_MODES = [
  'main',
  'custom_domain',
  'neutral_subdomain',
  'local_subdomain',
  'unauthorized',
] as const;
export type TenantResolutionMode = (typeof TENANT_RESOLUTION_MODES)[number];

export const TENANT_DOMAIN_TYPES = ['custom', 'subdomain'] as const;
export type TenantDomainType = (typeof TENANT_DOMAIN_TYPES)[number];

export const TENANT_DOMAIN_AUTH_MODES = ['cloudflare_saas', 'manual_approval'] as const;
export type TenantDomainAuthMode = (typeof TENANT_DOMAIN_AUTH_MODES)[number];

export const TENANT_DOMAIN_STATUSES = [
  'pending_dns',
  'pending_review',
  'active',
  'expired',
  'revoked',
] as const;
export type TenantDomainStatus = (typeof TENANT_DOMAIN_STATUSES)[number];
