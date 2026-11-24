/**
 * 订单、质保状态与异步支付单类型定义
 */

import type { WarrantyType as SharedWarrantyType } from '@shared/constants/enums';
import type { PublicGroupBuySessionDto } from '@shared/contracts/commerce.contract';

export type WarrantyType = SharedWarrantyType;

export interface OrderWarrantyStatus {
  warranty_type: WarrantyType;
  warranty_days: number;
  warranty_summary: string;
  in_warranty: boolean;
  status: 'in_warranty' | 'expired' | 'first_login' | 'none';
  badge_label: string;
  expires_at: string | null;
  remaining_days: number | null;
}

interface TicketOrderUpstreamInfo {
  fulfillment_source: string;
  upstream_source_id: number | null;
  upstream_source_name: string;
  upstream_order_no: string;
  upstream_cost_total: number;
  upstream_status: string;
  upstream_error: string;
  net_profit: number;
  has_bindings: boolean;
}

export interface TicketOrderSnapshot {
  order_no: string;
  product_id: number;
  product_title: string;
  spec_id?: string;
  spec_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  status: string;
  payment_method: string;
  channel: string;
  tenant_slug: string | null;
  contact_email: string;
  created_at: string;
  delivered_payload?: string;
  warranty: OrderWarrantyStatus;
  upstream_info?: TicketOrderUpstreamInfo | null;
}

export interface PaymentIntentInfo {
  intent_no: string;
  biz_type?: 'order' | 'wallet_recharge' | 'agent_upgrade';
  biz_ref?: string;
  provider: 'epay' | 'stripe' | 'usdt_trc20' | string;
  currency: string;
  amount_cny: number;
  pay_amount: number;
  pay_url: string;
  qr_content: string;
  status: 'pending' | 'paid' | 'expired' | 'failed';
  fulfill_status?: 'pending' | 'processing' | 'done' | 'failed' | 'none';
  expires_at: string;
  paid_at?: string | null;
  sandbox_simulated?: boolean;
  view_token?: string;
}

export interface OrderRecord {
  id?: number;
  order_no: string;
  public_order_no?: string | null;
  product_id?: number;
  product_title: string;
  spec_id?: string;
  spec_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  discount_amount?: number;
  coupon_code?: string | null;
  coupon_discount?: number;
  promo_used_amount?: number;
  commission_amount?: number;
  payment_method?: string;
  payment_reference?: string;
  payment_message?: string;
  channel?: string;
  status: string;
  contact_email: string;
  delivered_payload: string;
  mail_delivery?: { status: 'sent' | 'pending' | 'disabled'; reason?: string };
  locked?: boolean;
  tenant_slug?: string | null;
  warranty?: OrderWarrantyStatus;
  fulfillment_source?: string;
  upstream_source_id?: number | null;
  upstream_source_name?: string | null;
  upstream_order_no?: string;
  upstream_cost_total?: number;
  upstream_status?: string;
  upstream_error?: string;
  group_buy_session?: PublicGroupBuySessionDto;
  delivered_at?: string | null;
  created_at: string;
}
