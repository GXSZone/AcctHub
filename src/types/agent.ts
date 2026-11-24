/**
 * 用户身份、代理等级、分站与提现类型定义
 */

import type { GlobalSaasPolicyDto, TenantDomainDto } from '@shared/index';

export type TenantDomainItem = TenantDomainDto;
export type GlobalSaasPolicy = GlobalSaasPolicyDto;

export interface AgentTierInfo {
  id: number;
  owner_agent_id?: number;
  code: string;
  name: string;
  level_rank: number;
  min_recharge: number;
  discount_rate: number;
  commission_rate: number;
  sub_override_rate: number;
  max_sub_agents: number;
  badge_color: string;
  perks: string[];
  allow_custom_domain?: number;
  max_custom_domains?: number;
  allow_private_products?: number;
  allow_own_payment?: number;
}

export interface AgentInfo {
  id: number;
  user_id: number;
  tier_id?: number | null;
  parent_agent_id?: number | null;
  depth?: number;
  slug: string;
  brand_name: string;
  brand_tagline: string;
  support_label?: string;
  support_url?: string;
  support_note?: string;
  support_media_json?: string;
  support_links_json?: string;
  announcement_banner?: string;
  ticker_enabled?: number;
  ticker_mode?: string;
  ticker_include_notices?: number;
  popup_enabled?: number;
  popup_title?: string;
  popup_content?: string;
  popup_frequency?: string;
  popup_version?: string;
  downline_popup_enabled?: number;
  downline_popup_title?: string;
  downline_popup_content?: string;
  downline_popup_frequency?: string;
  downline_popup_version?: string;
  api_ip_whitelist?: string;
  markup_percent: number;
  commission_rate: number;
  api_key: string;
  status: string;
  theme_accent?: string;
  favicon_url?: string;
  og_image_url?: string;
  seo_title?: string;
  seo_description?: string;
  footer_text?: string;
  total_revenue: number;
  total_commission: number;
  allow_private_products_override?: number | null;
  allow_own_payment_override?: number | null;
  created_at: string;
}

export interface AgentWithdrawalRecord {
  id: number;
  agent_id: number;
  user_id: number;
  amount: number;
  fee_rate?: number;
  fee_amount?: number;
  net_amount?: number;
  channel: 'alipay' | 'wechat' | 'usdt_trc20' | string;
  account_info: string;
  account_name: string;
  status: 'pending' | 'paid' | 'rejected' | string;
  admin_note: string;
  created_at: string;
  processed_at: string | null;
  agent_slug?: string;
  agent_brand?: string;
  owner_email?: string;
}

export interface UserProfile {
  id: number;
  site_agent_id?: number;
  email: string;
  display_name: string;
  role: 'user' | 'agent' | 'admin';
  balance: number;
  total_recharged?: number;
  referral_code?: string | null;
  promo_balance?: number;
  agent?: AgentInfo | null;
  agent_tier?: AgentTierInfo | null;
}
