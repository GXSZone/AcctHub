export interface FieldMappingConfig {
  list_path?: string;
  id_field?: string;
  title_field?: string;
  category_field?: string;
  price_field?: string;
  stock_field?: string;
  status_field?: string;
  desc_field?: string;
  specs_field?: string;
}

export interface FilterRulesConfig {
  include_keywords?: string[];
  exclude_keywords?: string[];
  min_cost_price?: number;
  max_cost_price?: number;
}

export interface PricingRulesConfig {
  markup_percent?: number;
  markup_fixed?: number;
  rounding?: 'none' | 'integer' | 'point9';
  price_spike_guard_pct?: number;
}

export interface OrderTemplateConfig {
  method?: 'POST' | 'GET';
  content_type?: 'json' | 'form';
  body_template?: Record<string, unknown>;
  extra_headers?: Record<string, string>;
}

export interface ResponseMappingConfig {
  /** 仅当供应商合同明确保证从未受理时配置。 */
  not_accepted_path?: string;
  not_accepted_values?: string[];
  success_path?: string;
  success_values?: string[];
  pending_values?: string[];
  order_no_path?: string;
  cards_path?: string;
  cost_path?: string;
  error_path?: string;
  balance_path?: string;
  status_path?: string;
}

export interface NormalizedUpstreamSpec {
  id: string;
  name: string;
  price: number;
  stock?: number;
}

export interface NormalizedUpstreamItem {
  upstream_item_id: string;
  raw_title: string;
  raw_category: string;
  raw_price: number;
  raw_stock: number;
  raw_status: 'active' | 'inactive' | 'sold_out';
  raw_specs: NormalizedUpstreamSpec[];
  raw_description: string;
  raw_payload: Record<string, unknown>;
}

export interface UpstreamSourceRow {
  id: number;
  name: string;
  adapter_type: 'accthub_v1' | 'acgfaka' | 'dujiaoka_like' | 'generic_json' | 'mock_sandbox' | string;
  auth_mode: 'header_bearer' | 'query_key' | 'acgfaka_sign' | 'hmac_sha256' | 'custom_body' | string;
  app_id: string;
  base_url: string;
  order_url: string;
  query_order_url: string;
  balance_url: string;
  api_key?: string;
  api_key_enc: string;
  api_secret_enc: string;
  webhook_secret_enc: string;
  proxy_relay_url: string;
  proxy_relay_token_enc: string;
  auth_header: string;
  auth_prefix: string;
  field_mapping_json: string;
  filter_rules_json: string;
  pricing_rules_json: string;
  order_template_json: string;
  response_mapping_json: string;
  out_of_stock_action: 'mark_sold_out' | 'auto_unpublish' | string;
  auto_republish_on_restock: number;
  default_category_id: number;
  sync_interval_minutes: number;
  auto_sync_enabled: number;
  cached_balance: number | null;
  low_balance_threshold: number;
  balance_updated_at: string | null;
  sandbox_mode: 'normal' | 'always_fail' | 'always_async' | 'always_timeout' | string;
  status: string;
  last_sync_at: string | null;
  last_sync_status?: string;
  last_sync_message?: string;
}

export interface DecryptedSourceSecrets {
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  proxyRelayToken: string;
}

export interface UpstreamPlaceOrderRequest {
  upstreamItemId: string;
  upstreamSpecId?: string;
  quantity: number;
  outTradeNo: string;
  contactEmail?: string;
  webhookUrl?: string;
  unitCostHint?: number;
  customInputs?: Record<string, string>;
}

export interface UpstreamPlaceOrderResult {
  status: 'succeeded' | 'pending' | 'failed' | 'timeout_unknown';
  upstreamOrderNo: string;
  cards: string[];
  actualCost: number;
  errorMessage: string;
  rawResponse: Record<string, unknown>;
}
