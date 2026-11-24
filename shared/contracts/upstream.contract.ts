import { z } from 'zod';
import {
  FULFILLMENT_MODES,
  ROUTING_STRATEGIES,
  UPSTREAM_ADAPTER_TYPES,
  UPSTREAM_AUTH_MODES,
  UPSTREAM_OUT_OF_STOCK_ACTIONS,
  UPSTREAM_SANDBOX_MODES,
} from '../constants/enums';

export const UPSTREAM_SOURCE_STATUSES = ['active', 'paused'] as const;
export type UpstreamSourceStatus = (typeof UPSTREAM_SOURCE_STATUSES)[number];

const upstreamSourceFields = z.object({
  name: z.string().trim().min(1, '货源名称不能为空').max(80),
  adapter_type: z.enum(UPSTREAM_ADAPTER_TYPES).optional(),
  auth_mode: z.enum(UPSTREAM_AUTH_MODES).optional(),
  app_id: z.string().trim().max(120).optional(),
  base_url: z.string().trim().max(500).optional(),
  order_url: z.string().trim().max(500).optional(),
  query_order_url: z.string().trim().max(500).optional(),
  balance_url: z.string().trim().max(500).optional(),
  api_key: z.string().max(500).optional(),
  api_secret: z.string().max(500).optional(),
  webhook_secret: z.string().max(500).optional(),
  proxy_relay_url: z.string().trim().max(500).optional(),
  proxy_relay_token: z.string().max(500).optional(),
  auth_header: z.string().trim().max(80).optional(),
  auth_prefix: z.string().max(40).optional(),
  field_mapping: z.record(z.string(), z.unknown()).optional(),
  filter_rules: z.record(z.string(), z.unknown()).optional(),
  pricing_rules: z.record(z.string(), z.unknown()).optional(),
  order_template: z.record(z.string(), z.unknown()).optional(),
  response_mapping: z.record(z.string(), z.unknown()).optional(),
  out_of_stock_action: z.enum(UPSTREAM_OUT_OF_STOCK_ACTIONS).optional(),
  auto_republish_on_restock: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  default_category_id: z.number().int().positive().optional(),
  sync_interval_minutes: z.number().int().min(1).max(1440).optional(),
  auto_sync_enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
  low_balance_threshold: z.number().nonnegative().optional(),
  sandbox_mode: z.enum(UPSTREAM_SANDBOX_MODES).optional(),
  status: z.enum(UPSTREAM_SOURCE_STATUSES).optional(),
  cached_balance: z.number().nonnegative().nullable().optional(),
});

export const upsertUpstreamSourceSchema = upstreamSourceFields;

export const updateUpstreamSourceSchema = upstreamSourceFields.partial().extend({
  clear_api_key: z.boolean().optional(),
  clear_api_secret: z.boolean().optional(),
  clear_webhook_secret: z.boolean().optional(),
  clear_proxy_relay_token: z.boolean().optional(),
});

export const upsertUpstreamBindingSchema = z.object({
  product_id: z.number().int().positive(),
  spec_id: z.string().trim().min(1).max(64),
  source_id: z.number().int().positive(),
  upstream_item_id: z.string().trim().min(1).max(120),
  upstream_spec_id: z.string().trim().max(120).default(''),
  fulfillment_mode: z.enum(FULFILLMENT_MODES).default('local_first'),
  routing_strategy: z.enum(ROUTING_STRATEGIES).default('priority'),
  priority: z.number().int().min(1).max(999).default(10),
  is_enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).default(true),
});

export type UpsertUpstreamSourceInput = z.infer<typeof upsertUpstreamSourceSchema>;
export type UpsertUpstreamBindingInput = z.infer<typeof upsertUpstreamBindingSchema>;

export interface UpstreamFieldMapping {
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

export interface UpstreamFilterRules {
  include_keywords?: string[];
  exclude_keywords?: string[];
  min_cost_price?: number;
  max_cost_price?: number;
}

export interface UpstreamPricingRules {
  markup_percent?: number;
  markup_fixed?: number;
  rounding?: 'none' | 'integer' | 'point9';
  price_spike_guard_pct?: number;
}

export interface UpstreamOrderTemplate {
  method?: 'POST' | 'GET';
  content_type?: 'json' | 'form';
  body_template?: Record<string, unknown>;
  extra_headers?: Record<string, string>;
}

export interface UpstreamResponseMapping {
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

export interface UpstreamSourceInput {
  name: string;
  adapter_type: 'mock_sandbox' | 'accthub_v1' | 'acgfaka' | 'dujiaoka_like' | 'generic_json' | string;
  auth_mode?: 'header_bearer' | 'query_key' | 'acgfaka_sign' | 'hmac_sha256' | 'custom_body' | string;
  app_id?: string;
  base_url: string;
  order_url?: string;
  query_order_url?: string;
  balance_url?: string;
  api_key?: string;
  api_secret?: string;
  webhook_secret?: string;
  proxy_relay_url?: string;
  proxy_relay_token?: string;
  auth_header: string;
  auth_prefix: string;
  field_mapping: UpstreamFieldMapping;
  filter_rules: UpstreamFilterRules;
  pricing_rules: UpstreamPricingRules;
  order_template?: UpstreamOrderTemplate;
  response_mapping?: UpstreamResponseMapping;
  out_of_stock_action: 'mark_sold_out' | 'auto_unpublish' | string;
  auto_republish_on_restock: boolean;
  default_category_id: number;
  sync_interval_minutes: number;
  auto_sync_enabled: boolean;
  low_balance_threshold?: number;
  sandbox_mode?: 'normal' | 'always_fail' | 'always_async' | 'always_timeout' | string;
  status?: UpstreamSourceStatus;
}
