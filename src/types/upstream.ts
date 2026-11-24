/**
 * 上游货源对接、选品池、SKU 路由绑定与采购账本类型定义
 */

import type {
  UpstreamFieldMapping,
  UpstreamFilterRules,
  UpstreamOrderTemplate,
  UpstreamPricingRules,
  UpstreamResponseMapping,
  UpstreamSourceInput,
} from '@shared/index';

export type {
  UpstreamFieldMapping,
  UpstreamFilterRules,
  UpstreamOrderTemplate,
  UpstreamPricingRules,
  UpstreamResponseMapping,
  UpstreamSourceInput,
};

export interface UpstreamSourceRecord {
  id: number;
  name: string;
  adapter_type: string;
  auth_mode: string;
  app_id: string;
  base_url: string;
  order_url: string;
  query_order_url: string;
  balance_url: string;
  has_api_key?: boolean;
  api_key_masked?: string;
  has_api_secret?: boolean;
  api_secret_masked?: string;
  has_webhook_secret?: boolean;
  webhook_secret_masked?: string;
  proxy_relay_url: string;
  has_proxy_relay_token?: boolean;
  auth_header: string;
  auth_prefix: string;
  field_mapping: UpstreamFieldMapping;
  filter_rules: UpstreamFilterRules;
  pricing_rules: UpstreamPricingRules;
  order_template: UpstreamOrderTemplate;
  response_mapping: UpstreamResponseMapping;
  out_of_stock_action: string;
  auto_republish_on_restock: number;
  default_category_id: number;
  sync_interval_minutes: number;
  auto_sync_enabled: number;
  cached_balance: number | null;
  low_balance_threshold: number;
  balance_updated_at: string | null;
  sandbox_mode: string;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  total_items: number;
  collected_items: number;
  sold_out_items: number;
  active_bindings?: number;
}

export interface UpstreamBindingRecord {
  id: number;
  product_id: number;
  product_title?: string;
  spec_id: string;
  source_id: number;
  source_name: string;
  adapter_type?: string;
  cached_balance?: number | null;
  source_status?: string;
  upstream_item_id: string;
  upstream_spec_id: string;
  fulfillment_mode: 'local_first' | 'upstream_only' | string;
  routing_strategy: 'priority' | 'lowest_cost' | string;
  priority: number;
  cached_cost: number;
  cached_stock: number;
  is_enabled: number;
  circuit_broken_reason: string;
  updated_at: string;
}

export interface UpstreamOrderLedgerRecord {
  id: number;
  local_order_no: string;
  attempt_no: number;
  idempotency_out_trade_no: string;
  source_id: number;
  source_name: string;
  product_id: number | null;
  spec_id: string;
  upstream_item_id: string;
  upstream_spec_id: string;
  quantity: number;
  upstream_order_no: string;
  upstream_cost: number;
  status: 'pending' | 'succeeded' | 'failed' | 'timeout_unknown' | 'refunded' | string;
  purpose: 'order_fulfill' | 'manual_retry' | 'restock_pull' | 'after_sale_replace' | string;
  cards: string[];
  error_message: string;
  local_total_amount?: number | null;
  local_commission?: number | null;
  local_product_title?: string | null;
  local_contact_email?: string | null;
  local_order_status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpstreamExceptionOrderRecord {
  id: number;
  order_no: string;
  user_id: number | null;
  product_id: number;
  product_title: string;
  spec_id: string;
  spec_name: string;
  quantity: number;
  total_amount: number;
  payment_method: string;
  contact_email: string;
  status: 'upstream_pending' | 'fulfillment_failed' | string;
  upstream_source_id: number | null;
  upstream_source_name: string | null;
  upstream_order_no: string;
  upstream_cost_total: number;
  upstream_status: string;
  upstream_error: string;
  created_at: string;
}

export interface UpstreamNormalizedPreview {
  upstream_item_id: string;
  raw_title: string;
  raw_category: string;
  raw_price: number;
  raw_stock: number;
  raw_status: string;
  raw_description: string;
}

export interface UpstreamItemRecord {
  id: number;
  source_id: number;
  upstream_item_id: string;
  raw_title: string;
  raw_category: string;
  raw_price: number;
  raw_stock: number;
  raw_status: string;
  raw_description: string;
  raw_specs: Array<{ id: string; name: string; price: number; stock?: number }>;
  raw_payload: Record<string, unknown>;
  collect_status: 'pending' | 'collected' | 'ignored';
  local_product_id: number | null;
  target_category_id: number | null;
  lock_local_price: number;
  lock_local_content: number;
  last_seen_at: string;
  local_title: string | null;
  local_price: number | null;
  local_stock: number | null;
  local_is_active: number | null;
}

export interface UpstreamSyncLogRecord {
  id: number;
  source_id: number;
  source_name: string;
  trigger_type: 'manual' | 'cron' | string;
  status: string;
  fetched_count: number;
  synced_count: number;
  out_of_stock_count: number;
  skipped_count: number;
  alerts: string[];
  duration_ms: number;
  message: string;
  created_at: string;
}
