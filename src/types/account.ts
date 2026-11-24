/**
 * 会员钱包、工单、2FA 保险箱、营销券码与邮件配置类型定义
 */

import type {
  MailProvider as SharedMailProvider,
  TicketStatus as SharedTicketStatus,
  WalletTxType as SharedWalletTxType,
} from '@shared/constants/enums';
import type { TicketOrderSnapshot } from './order';

export interface WalletTransactionRecord {
  id: number;
  user_id: number;
  type: SharedWalletTxType | string;
  amount: number;
  balance_after: number;
  ref_no: string;
  note: string;
  created_at: string;
}

export interface SupportTicketRecord {
  id: number;
  ticket_no: string;
  site_agent_id: number;
  site_slug?: string | null;
  site_brand?: string | null;
  user_id: number | null;
  contact_email: string;
  order_no: string;
  category: string;
  subject: string;
  status: SharedTicketStatus | string;
  escalated_to_admin: number;
  message_count?: number;
  last_message_id?: number;
  last_sender_role?: string | null;
  order_info?: TicketOrderSnapshot | null;
  created_at: string;
  updated_at: string;
}

export interface TicketMessageRecord {
  id: number;
  ticket_id: number;
  sender_role: 'user' | 'agent' | 'admin' | 'system' | string;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface TotpVaultItem {
  id: string;
  issuer: string;
  account_name: string;
  secret: string;
  digits: number;
  period: number;
  created_at?: string;
}

export interface CouponRecord {
  id: number;
  code: string;
  name: string;
  discount_type: 'fixed' | 'percent' | string;
  discount_value: number;
  min_order_amount: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: number;
  created_at: string;
}

export interface RechargeCdkRecord {
  id: number;
  code: string;
  amount: number;
  status: 'available' | 'used' | string;
  used_by_email: string | null;
  used_at: string | null;
  batch_note: string;
  created_at: string;
}

export type MailProvider = SharedMailProvider;

export interface SiteMailConfigPublic {
  owner_agent_id: number;
  enabled: boolean;
  auto_send_order: boolean;
  auto_send_restock: boolean;
  provider: MailProvider;
  from_name: string;
  from_email: string;
  reply_to: string;
  has_api_key: boolean;
  api_key_masked: string;
  api_endpoint: string;
  mailgun_domain: string;
  footer_note: string;
  order_email_subject_tpl?: string;
  order_email_body_tpl?: string;
  updated_at: string;
}

export interface EmailDeliveryLogRow {
  id: number;
  owner_agent_id: number;
  order_no: string;
  to_email: string;
  subject: string;
  provider: string;
  scene: string;
  status: 'sent' | 'failed' | string;
  error_message: string;
  created_at: string;
}
