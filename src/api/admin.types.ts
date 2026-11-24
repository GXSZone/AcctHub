import type { AdminMemberItemDto, AdminMembersSummaryDto } from '@shared/index';

export interface AdminAuditLogRow {
  id: number;
  actorUserId: number;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  beforeJson: string;
  afterJson: string;
  ip: string;
  userAgent: string;
  requestId: string;
  createdAt: string;
}

export interface FinanceReconciliationResponse {
  days: number;
  summary: {
    paid_orders: number;
    pending_orders: number;
    refunded_orders: number;
    gross_gmv: number;
    total_recognized_revenue?: number;
    refunded_amount: number;
    coupon_discount_total: number;
    promo_discount_total?: number;
    upstream_cost_total: number;
    local_product_cost_total?: number;
    refund_sunk_upstream_cost?: number;
    unrecovered_commission_receivable?: number;
    unrecovered_commission_count?: number;
    agent_commission_total: number;
    platform_net_profit: number;
    comprehensive_net_profit?: number;
    agent_upgrade_count?: number;
    agent_upgrade_total?: number;
    agent_upgrade_parent_share?: number;
    agent_upgrade_platform_net?: number;
    withdrawal_fee_income?: number;
    pending_withdrawals: number;
    paid_withdrawals: number;
    paid_withdrawals_net?: number;
    cash_inflow_order?: number;
    cash_inflow_upgrade?: number;
    cash_inflow_recharge?: number;
    cash_inflow_total?: number;
    cdk_redeemed_total?: number;
    wallet_liability_total?: number;
    wallet_liability_agent?: number;
    wallet_liability_member?: number;
    promo_liability_total?: number;
  };
  daily: Array<{
    day: string;
    order_count: number;
    upgrade_count?: number;
    gmv: number;
    upgrade_total?: number;
    upgrade_platform_net?: number;
    total_revenue?: number;
    upstream_cost: number;
    commission: number;
    refunded: number;
    net_profit: number;
  }>;
  by_tenant: Array<{
    tenant_slug: string;
    brand_name: string;
    order_count: number;
    gmv: number;
    commission: number;
    upstream_cost: number;
    net_profit: number;
  }>;
  integrity_checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    count: number;
    detail: string;
  }>;
}

export interface AdminCashflowsResponse {
  agent_upgrades: Array<{
    id: number;
    user_id: number;
    user_email: string;
    user_name: string;
    agent_slug: string | null;
    agent_brand: string | null;
    parent_slug: string | null;
    unlocked_tier_name: string;
    payment_method: string;
    amount: number;
    parent_share: number;
    platform_net: number;
    created_at: string;
  }>;
  wallet_recharges: Array<{
    id: string;
    ref_no: string;
    source: 'online' | 'cdk';
    channel: string;
    user_email: string;
    user_name: string;
    amount: number;
    status: string;
    note: string;
    created_at: string;
  }>;
}

export interface AdminMembersResponse {
  items: AdminMemberItemDto[];
  total: number;
  page: number;
  page_size: number;
  summary: AdminMembersSummaryDto;
}

export interface AdminMemberTransactionsResponse {
  user: {
    id: number;
    email: string;
    display_name: string;
    balance: number;
    promo_balance: number;
  };
  transactions: Array<{
    id: number;
    user_id: number;
    type: string;
    amount: number;
    balance_after: number;
    ref_no: string;
    note: string;
    created_at: string;
  }>;
}
