import { applyPriceRounding, type PriceRoundingMode } from '@shared/domain/money';
import type { UpstreamFieldMapping, UpstreamSourceInput, UpstreamSourceStatus } from '@shared/index';
import type { AdminUpstreamDrawerDict } from '../../i18n/namespaces/admin-upstream-drawer';

export function buildAdapterOptions(d: AdminUpstreamDrawerDict): Array<{
  key: string;
  label: string;
  short: string;
  desc: string;
  defaultAuth: string;
}> {
  return [
    {
      key: 'mock_sandbox',
      label: d.adapterMockLabel,
      short: d.adapterMockShort,
      desc: d.adapterMockDesc,
      defaultAuth: 'header_bearer',
    },
    {
      key: 'acgfaka',
      label: d.adapterAcgLabel,
      short: d.adapterAcgShort,
      desc: d.adapterAcgDesc,
      defaultAuth: 'acgfaka_sign',
    },
    {
      key: 'dujiaoka_like',
      label: d.adapterDujiaokaLabel,
      short: d.adapterDujiaokaShort,
      desc: d.adapterDujiaokaDesc,
      defaultAuth: 'header_bearer',
    },
    {
      key: 'accthub_v1',
      label: d.adapterAccthubLabel,
      short: d.adapterAccthubShort,
      desc: d.adapterAccthubDesc,
      defaultAuth: 'header_bearer',
    },
    {
      key: 'generic_json',
      label: d.adapterGenericLabel,
      short: d.adapterGenericShort,
      desc: d.adapterGenericDesc,
      defaultAuth: 'header_bearer',
    },
  ];
}

export function buildAdapterLabelMap(d: AdminUpstreamDrawerDict) {
  return Object.fromEntries(buildAdapterOptions(d).map((a) => [a.key, a]));
}

export function buildAuthModeOptions(
  d: AdminUpstreamDrawerDict
): Array<{ key: string; label: string; hint: string }> {
  return [
    { key: 'header_bearer', label: d.authHeaderLabel, hint: d.authHeaderHint },
    { key: 'acgfaka_sign', label: d.authAcgLabel, hint: d.authAcgHint },
    { key: 'hmac_sha256', label: d.authHmacLabel, hint: d.authHmacHint },
    { key: 'custom_body', label: d.authBodyLabel, hint: d.authBodyHint },
  ];
}

const DEFAULT_FIELD_MAPPING: UpstreamFieldMapping = {
  list_path: 'data.items',
  id_field: 'sku_code',
  title_field: 'item_name',
  category_field: 'group_name',
  price_field: 'wholesale_cny',
  stock_field: 'qty_left',
  status_field: 'sale_state',
  desc_field: 'intro',
  specs_field: 'specs',
};

export function buildFieldMappingPresets(
  d: AdminUpstreamDrawerDict
): Array<{ label: string; mapping: UpstreamFieldMapping }> {
  return [
    { label: d.presetMockLabel, mapping: { ...DEFAULT_FIELD_MAPPING } },
    {
      label: d.presetListLabel,
      mapping: {
        list_path: 'data.list',
        id_field: 'id',
        title_field: 'name',
        category_field: 'category_name',
        price_field: 'price',
        stock_field: 'stock',
        status_field: 'status',
        desc_field: 'description',
        specs_field: 'specs',
      },
    },
    {
      label: d.presetRootLabel,
      mapping: {
        list_path: '',
        id_field: 'id',
        title_field: 'title',
        category_field: 'category',
        price_field: 'cost',
        stock_field: 'inventory',
        status_field: 'state',
        desc_field: 'summary',
        specs_field: 'specs',
      },
    },
  ];
}

export function previewCalculatedPrice(
  cost: number,
  rules?: { markup_percent?: number; markup_fixed?: number; rounding?: string }
): number {
  const pct = Number(rules?.markup_percent ?? 20);
  const fixed = Number(rules?.markup_fixed ?? 0);
  const raw = Math.max(cost, cost * (1 + pct / 100) + fixed);
  const rounding: PriceRoundingMode =
    rules?.rounding === 'integer' || rules?.rounding === 'point9' ? rules.rounding : 'none';
  return Math.max(cost, applyPriceRounding(raw, rounding));
}

export interface SourceEditorDraft extends UpstreamSourceInput {
  status: UpstreamSourceStatus;
  body_template_text: string;
}

export function emptySourceDraft(defaultCategoryId: number): SourceEditorDraft {
  return {
    name: '',
    adapter_type: 'acgfaka',
    auth_mode: 'acgfaka_sign',
    app_id: '',
    base_url: 'https://supplier.example.com/api/v1/supplier/products',
    order_url: 'https://supplier.example.com/api/v1/supplier/order/create',
    query_order_url: 'https://supplier.example.com/api/v1/supplier/order/query',
    balance_url: 'https://supplier.example.com/api/v1/supplier/balance',
    api_key: '',
    api_secret: '',
    webhook_secret: '',
    proxy_relay_url: '',
    proxy_relay_token: '',
    auth_header: 'Authorization',
    auth_prefix: 'Bearer ',
    field_mapping: { ...DEFAULT_FIELD_MAPPING },
    filter_rules: {
      include_keywords: [],
      exclude_keywords: [],
      min_cost_price: 0,
      max_cost_price: 0,
    },
    pricing_rules: {
      markup_percent: 25,
      markup_fixed: 0,
      rounding: 'point9',
      price_spike_guard_pct: 35,
    },
    order_template: { method: 'POST', content_type: 'json' },
    response_mapping: {
      order_no_path: 'data.trade_no',
      cards_path: 'data.cards',
      cost_path: 'data.amount',
      balance_path: 'data.balance',
      error_path: 'msg',
    },
    out_of_stock_action: 'mark_sold_out',
    auto_republish_on_restock: true,
    default_category_id: defaultCategoryId,
    sync_interval_minutes: 15,
    auto_sync_enabled: true,
    low_balance_threshold: 100,
    sandbox_mode: 'normal',
    status: 'active',
    body_template_text: '',
  };
}
