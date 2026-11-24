/**
 * 开放平台 API 文档：订单、认证与总控端点目录汇总
 */

import type { DocsDict } from '../../i18n/namespaces/docs/zh-CN';
import { buildResellerAndStorefrontEndpoints, type EndpointSpec } from './api-docs.reseller';

export type { CodeLang, EndpointSpec, ParamRow } from './api-docs.reseller';

export interface DocsGroupMetaItem {
  id: string;
  label: string;
  badge: string;
}

export function buildGroupMeta(d: DocsDict): DocsGroupMetaItem[] {
  return [
    { id: 'reseller', label: d.grpResellerLabel, badge: d.grpResellerBadge },
    { id: 'storefront', label: d.grpStorefrontLabel, badge: d.grpStorefrontBadge },
    { id: 'orders', label: d.grpOrdersLabel, badge: d.grpOrdersBadge },
    { id: 'auth', label: d.grpAuthLabel, badge: d.grpAuthBadge },
    { id: 'admin', label: d.grpAdminLabel, badge: d.grpAdminBadge },
  ];
}

export function buildEndpoints(d: DocsDict): EndpointSpec[] {
  const otherEndpoints: EndpointSpec[] = [
    {
      id: 'orders-create',
      group: 'orders',
      method: 'POST',
      path: '/api/orders',
      title: d.epOrdCreateTitle,
      summary: d.epOrdCreateSum,
      auth: 'none',
      params: [
        { name: 'product_id', in: 'body', type: 'number', required: true, desc: d.epOrdCreateP1 },
        { name: 'spec_id', in: 'body', type: 'string', required: false, desc: d.epOrdCreateP2 },
        { name: 'quantity', in: 'body', type: 'number', required: false, desc: d.epOrdCreateP3 },
        { name: 'contact_email', in: 'body', type: 'string', required: true, desc: d.epOrdCreateP4 },
        {
          name: 'payment_method',
          in: 'body',
          type: 'string',
          required: false,
          desc: d.epOrdCreateP5,
        },
        {
          name: 'custom_inputs',
          in: 'body',
          type: 'object',
          required: false,
          desc: d.epOrdCreateP6,
        },
      ],
      sampleRequestBody: {
        product_id: 6,
        spec_id: 'api_10usd',
        quantity: 1,
        contact_email: 'buyer@example.com',
        payment_method: 'demo_instant',
      },
      sampleResponse: {
        order: {
          order_no: 'AHQ-0123456789abcdef0123456789abcdef',
          public_order_no: 'AHQ-0123456789abcdef0123456789abcdef',
          total_amount: 35,
          status: 'delivered',
          delivered_payload: 'API Endpoint: https://api.accthub.edge/v1\nAPI Key: sk-accthub-live-...',
        },
      },
    },
    {
      id: 'orders-lookup',
      group: 'orders',
      method: 'POST',
      path: '/api/orders/lookup',
      title: d.epOrdLookupTitle,
      summary: d.epOrdLookupSum,
      auth: 'none',
      params: [
        { name: 'q', in: 'body', type: 'string', required: false, desc: d.epOrdLookupP1 },
        { name: 'password', in: 'body', type: 'string', required: false, desc: d.epOrdLookupPassword },
        { name: 'cursor', in: 'body', type: 'number', required: false, desc: d.epOrdLookupCursor },
        {
          name: 'turnstile_token',
          in: 'body',
          type: 'string',
          required: false,
          desc: d.epOrdLookupTurnstile,
        },
      ],
      sampleRequestBody: { q: 'AHQ-0123456789abcdef0123456789abcdef' },
      sampleResponse: { orders: [], next_cursor: null },
    },
    {
      id: 'auth-login',
      group: 'auth',
      method: 'POST',
      path: '/api/auth/login',
      title: d.epAuthLoginTitle,
      summary: d.epAuthLoginSum,
      auth: 'none',
      params: [
        { name: 'email', in: 'body', type: 'string', required: true, desc: d.epAuthLoginP1 },
        { name: 'password', in: 'body', type: 'string', required: true, desc: d.epAuthLoginP2 },
        {
          name: 'cf-turnstile-response',
          in: 'body',
          type: 'string',
          required: false,
          desc: d.epAuthLoginP3,
        },
      ],
      sampleRequestBody: { email: 'partner@example.com', password: '<YOUR_PASSWORD>' },
      sampleResponse: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: { id: 1, email: 'partner@example.com', role: 'agent', balance: 358.8 },
      },
    },
    {
      id: 'agent-apply',
      group: 'auth',
      method: 'PUT',
      path: '/api/agent/brand',
      title: d.epAgentApplyTitle,
      summary: d.epAgentApplySum,
      auth: 'user_jwt',
      params: [
        {
          name: 'Authorization',
          in: 'header',
          type: 'string',
          required: true,
          desc: d.epAgentApplyP1,
        },
        { name: 'slug', in: 'body', type: 'string', required: true, desc: d.epAgentApplyP2 },
        { name: 'brand_name', in: 'body', type: 'string', required: true, desc: d.epAgentApplyP3 },
        {
          name: 'markup_percent',
          in: 'body',
          type: 'number',
          required: false,
          desc: d.epAgentApplyP4,
        },
      ],
      sampleRequestBody: { slug: 'my-ai-shop', brand_name: d.demoAgentBrand, markup_percent: 15 },
      sampleResponse: { ok: true, agent: { slug: 'my-ai-shop', status: 'active' } },
    },
    {
      id: 'admin-overview',
      group: 'admin',
      method: 'GET',
      path: '/api/admin/overview',
      title: d.epAdminOverviewTitle,
      summary: d.epAdminOverviewSum,
      auth: 'admin_jwt',
      params: [
        {
          name: 'Authorization',
          in: 'header',
          type: 'string',
          required: true,
          desc: d.epAdminOverviewP1,
        },
      ],
      sampleResponse: {
        stats: { total_orders: 1, total_gmv: 140, total_products: 11, total_agents: 1 },
        settings: {},
        groups: [],
        categories: [],
        products: [],
      },
      liveTestable: true,
      livePath: '/api/admin/overview',
    },
  ];
  return [...buildResellerAndStorefrontEndpoints(d), ...otherEndpoints];
}
