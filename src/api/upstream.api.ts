/**
 * 上游货源对接、选品同步、SKU 路由与采购账本 API 客户端
 */

import type {
  UpstreamBindingRecord,
  UpstreamExceptionOrderRecord,
  UpstreamItemRecord,
  UpstreamNormalizedPreview,
  UpstreamOrderLedgerRecord,
  UpstreamSourceInput,
  UpstreamSourceRecord,
  UpstreamSyncLogRecord,
} from '../types';
import { apiRequest } from './http';

export type {
  UpstreamBindingRecord,
  UpstreamExceptionOrderRecord,
  UpstreamFieldMapping,
  UpstreamFilterRules,
  UpstreamItemRecord,
  UpstreamNormalizedPreview,
  UpstreamOrderLedgerRecord,
  UpstreamOrderTemplate,
  UpstreamPricingRules,
  UpstreamResponseMapping,
  UpstreamSourceInput,
  UpstreamSourceRecord,
  UpstreamSyncLogRecord,
} from '../types';

export const upstreamApi = {
  listSources: () =>
    apiRequest<{
      sources: UpstreamSourceRecord[];
      logs: UpstreamSyncLogRecord[];
      summary?: { pending_orders: number; failed_orders: number };
    }>('/api/admin/upstreams', {}, { admin: true }),

  createSource: (payload: UpstreamSourceInput, creationKey: string) =>
    apiRequest<{ id: number; ok: boolean }>(
      '/api/admin/upstreams',
      { method: 'POST', headers: { 'Idempotency-Key': creationKey }, body: JSON.stringify(payload) },
      { admin: true }
    ),

  updateSource: (
    id: number,
    payload: Partial<UpstreamSourceInput> & {
      clear_api_key?: boolean;
      clear_api_secret?: boolean;
      clear_webhook_secret?: boolean;
      clear_proxy_relay_token?: boolean;
      cached_balance?: number;
    }
  ) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/upstreams/${id}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteSource: (id: number) =>
    apiRequest<{ ok: boolean }>(`/api/admin/upstreams/${id}`, { method: 'DELETE' }, { admin: true }),

  testSource: (id: number) =>
    apiRequest<{ ok: boolean; count: number; balance?: number | null; preview: UpstreamNormalizedPreview[] }>(
      `/api/admin/upstreams/${id}/test`,
      { method: 'POST' },
      { admin: true }
    ),

  checkBalance: (id: number) =>
    apiRequest<{
      ok: boolean;
      status: string;
      balance: number | null;
      low_balance: boolean;
      currency: string;
      error?: string;
    }>(`/api/admin/upstreams/${id}/balance`, { method: 'POST' }, { admin: true }),

  syncSource: (id: number) =>
    apiRequest<{
      ok: boolean;
      fetched_count: number;
      synced_count: number;
      out_of_stock_count: number;
      skipped_count: number;
      balance?: number | null;
      alerts: string[];
      duration_ms: number;
      message: string;
    }>(`/api/admin/upstreams/${id}/sync`, { method: 'POST' }, { admin: true }),

  listItems: (sourceId: number) =>
    apiRequest<{ items: UpstreamItemRecord[] }>(
      `/api/admin/upstreams/${sourceId}/items`,
      {},
      { admin: true }
    ),

  updateItem: (
    itemId: number,
    payload: {
      action?: 'collect' | 'ignore' | 'reset_pending';
      target_category_id?: number;
      lock_local_price?: boolean;
      lock_local_content?: boolean;
      fulfillment_mode?: 'upstream_only' | 'local_first';
    }
  ) =>
    apiRequest<{ ok: boolean; status?: string; local_product_id?: number; alerts?: string[] }>(
      `/api/admin/upstreams/items/${itemId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  listBindings: (productId?: number) =>
    apiRequest<{ bindings: UpstreamBindingRecord[] }>(
      `/api/admin/upstreams/bindings/list${productId ? `?product_id=${productId}` : ''}`,
      {},
      { admin: true }
    ),

  saveBinding: (payload: {
    product_id: number;
    spec_id: string;
    source_id: number;
    upstream_item_id: string;
    upstream_spec_id?: string;
    fulfillment_mode?: 'local_first' | 'upstream_only';
    routing_strategy?: 'priority' | 'lowest_cost';
    priority?: number;
    cached_cost?: number;
    cached_stock?: number;
    is_enabled?: boolean;
  }) =>
    apiRequest<{ ok: boolean; id?: number }>(
      '/api/admin/upstreams/bindings',
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  updateBinding: (
    bindingId: number,
    productId: number,
    payload: {
      fulfillment_mode?: 'local_first' | 'upstream_only';
      routing_strategy?: 'priority' | 'lowest_cost';
      priority?: number;
      cached_cost?: number;
      cached_stock?: number;
      is_enabled?: boolean;
      reset_circuit?: boolean;
    }
  ) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/upstreams/bindings/${bindingId}?product_id=${productId}`,
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  deleteBinding: (bindingId: number, productId: number) =>
    apiRequest<{ ok: boolean }>(
      `/api/admin/upstreams/bindings/${bindingId}?product_id=${productId}`,
      { method: 'DELETE' },
      { admin: true }
    ),

  pullCards: (bindingId: number, quantity: number) =>
    apiRequest<{ ok: boolean; imported: number; upstreamOrderNo: string; cost: number; cards: string[] }>(
      `/api/admin/upstreams/bindings/${bindingId}/pull-cards`,
      { method: 'POST', body: JSON.stringify({ quantity }) },
      { admin: true }
    ),

  getLedger: () =>
    apiRequest<{
      upstream_orders: UpstreamOrderLedgerRecord[];
      exception_orders: UpstreamExceptionOrderRecord[];
      profit_summary: {
        delivered_count: number;
        gross_revenue: number;
        total_commission: number;
        total_upstream_cost: number;
        net_profit: number;
      };
    }>('/api/admin/upstreams/orders/ledger', {}, { admin: true }),

  pollOrder: (upOrderId: number) =>
    apiRequest<{ ok: boolean; status: string; cards: string[]; errorMessage: string }>(
      `/api/admin/upstreams/orders/${upOrderId}/poll`,
      { method: 'POST' },
      { admin: true }
    ),

  retryFailedOrder: (orderNo: string, sourceId?: number) =>
    apiRequest<{ ok: boolean; status: string; upstream_order_no?: string; message?: string }>(
      `/api/admin/upstreams/local-orders/${encodeURIComponent(orderNo)}/retry`,
      { method: 'POST', body: JSON.stringify(sourceId ? { source_id: sourceId } : {}) },
      { admin: true }
    ),

  manualFulfillOrder: (
    orderNo: string,
    payload: { cards_text: string; upstream_order_no?: string; upstream_cost?: number }
  ) =>
    apiRequest<{ ok: boolean; status: string; mail_status: 'pending' | 'sent' | 'disabled' | 'failed' }>(
      `/api/admin/upstreams/local-orders/${encodeURIComponent(orderNo)}/manual-fulfill`,
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),

  refundFailedOrderToBalance: (orderNo: string, walletCompensation: boolean) =>
    apiRequest<{ ok: boolean; refundedToWallet: boolean; amount: number }>(
      `/api/admin/upstreams/local-orders/${encodeURIComponent(orderNo)}/refund-balance`,
      { method: 'POST', body: JSON.stringify({ walletCompensation }) },
      { admin: true }
    ),

  replaceTicketViaUpstream: (
    ticketId: number,
    payload: { quantity?: number; source_id?: number; note?: string }
  ) =>
    apiRequest<{
      ok: boolean;
      status: string;
      mailStatus: string;
      errorMessage: string;
      cards: string[];
      upstreamOrderNo: string;
      upstreamSourceName: string;
      cost: number;
    }>(
      `/api/admin/upstreams/tickets/${ticketId}/replace-via-upstream`,
      { method: 'POST', body: JSON.stringify(payload) },
      { admin: true }
    ),
  retryReplacementEmail: (ticketId: number) =>
    apiRequest<{ mailStatus: string }>(
      `/api/admin/upstreams/tickets/${ticketId}/retry-replacement-email`,
      { method: 'POST' },
      { admin: true }
    ),
};
