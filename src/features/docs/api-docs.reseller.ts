/**
 * 开放平台 API 文档：类型定义、B2B 批采与前台目录接口规范
 */

import type { DocsDict } from '../../i18n/namespaces/docs/zh-CN';

export type CodeLang = 'curl' | 'ts' | 'go';

export interface ParamRow {
  name: string;
  in: 'header' | 'query' | 'path' | 'body';
  type: string;
  required: boolean;
  desc: string;
}

export interface EndpointSpec {
  id: string;
  group: 'reseller' | 'storefront' | 'orders' | 'auth' | 'admin';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  title: string;
  summary: string;
  auth: 'none' | 'reseller_key' | 'user_jwt' | 'admin_jwt';
  params?: ParamRow[];
  sampleRequestBody?: Record<string, unknown>;
  sampleResponse: Record<string, unknown>;
  liveTestable?: boolean;
  livePath?: string;
}

export function buildResellerAndStorefrontEndpoints(d: DocsDict): EndpointSpec[] {
  return [
    {
      id: 'reseller-balance',
      group: 'reseller',
      method: 'GET',
      path: '/api/v1/reseller/balance',
      title: d.epResellerBalTitle,
      summary: d.epResellerBalSum,
      auth: 'reseller_key',
      params: [
        {
          name: 'Authorization',
          in: 'header',
          type: 'string',
          required: true,
          desc: d.epResellerBalP1,
        },
      ],
      sampleResponse: {
        agent_slug: 'studio',
        brand_name: d.demoBrandName,
        balance: 358.8,
        commission_rate: 15,
        total_commission: 642.08,
      },
      liveTestable: true,
      livePath: '/api/v1/reseller/balance',
    },
    {
      id: 'reseller-products',
      group: 'reseller',
      method: 'GET',
      path: '/api/v1/reseller/products',
      title: d.epResellerProdTitle,
      summary: d.epResellerProdSum,
      auth: 'reseller_key',
      params: [
        { name: 'Authorization', in: 'header', type: 'string', required: true, desc: d.epResellerProdP1 },
      ],
      sampleResponse: {
        agent: 'studio',
        count: 11,
        products: [
          {
            id: 1,
            slug: 'claude-pro-official-topup',
            title: d.demoProdTitle,
            delivery_type: 'auto',
            retail_price: 140,
            wholesale_price: 119,
            available_stock: 18,
            specs: [
              { id: 'official_topup', name: d.demoSpec1, wholesale_price: 119 },
              { id: 'ready_account', name: d.demoSpec2, wholesale_price: 140.25 },
            ],
          },
        ],
      },
      liveTestable: true,
      livePath: '/api/v1/reseller/products',
    },
    {
      id: 'reseller-order',
      group: 'reseller',
      method: 'POST',
      path: '/api/v1/reseller/order',
      title: d.epResellerOrderTitle,
      summary: d.epResellerOrderSum,
      auth: 'reseller_key',
      params: [
        { name: 'Authorization', in: 'header', type: 'string', required: true, desc: d.epResellerOrderP1 },
        {
          name: 'product_id',
          in: 'body',
          type: 'number',
          required: true,
          desc: d.epResellerOrderP2,
        },
        { name: 'spec_id', in: 'body', type: 'string', required: false, desc: d.epResellerOrderP3 },
        { name: 'quantity', in: 'body', type: 'number', required: false, desc: d.epResellerOrderP4 },
        { name: 'idempotency_key', in: 'body', type: 'string', required: false, desc: d.epResellerOrderP6 },
        {
          name: 'customer_ref',
          in: 'body',
          type: 'string',
          required: false,
          desc: d.epResellerOrderP5,
        },
      ],
      sampleRequestBody: {
        product_id: 1,
        spec_id: 'official_topup',
        quantity: 1,
        customer_ref: 'ext-order-20261120-001',
        idempotency_key: 'ext-order-20261120-001',
      },
      sampleResponse: {
        order_no: 'B2B73430170411',
        status: 'delivered',
        unit_wholesale_price: 119,
        total_deducted: 119,
        remaining_balance: 239.8,
        cards: [d.demoCardSample],
      },
    },
    {
      id: 'reseller-order-status',
      group: 'reseller',
      method: 'GET',
      path: '/api/v1/reseller/order',
      title: d.epResellerOrderStatusTitle,
      summary: d.epResellerOrderStatusSum,
      auth: 'reseller_key',
      params: [
        {
          name: 'order_no',
          in: 'query',
          type: 'string',
          required: false,
          desc: d.epResellerOrderStatusTitle,
        },
        { name: 'idempotency_key', in: 'query', type: 'string', required: false, desc: d.epResellerOrderP6 },
      ],
      sampleResponse: {
        order_no: 'B2B73430170411',
        status: 'upstream_pending',
        total_deducted: 119,
        cards: [],
      },
    },
    {
      id: 'reseller-compat-catalog',
      group: 'reseller',
      method: 'GET',
      path: '/api/v1/reseller/compat/catalog',
      title: d.epResellerCompatTitle,
      summary: d.epResellerCompatSum,
      auth: 'reseller_key',
      params: [
        {
          name: 'Authorization',
          in: 'header',
          type: 'string',
          required: true,
          desc: d.epResellerCompatP1,
        },
      ],
      sampleResponse: {
        code: 200,
        msg: 'ok',
        data: {
          balance: 358.8,
          discount_rate: 0.85,
          goods: [
            {
              goods_id: '1:official_topup',
              product_id: 1,
              spec_id: 'official_topup',
              name: d.demoProdShort,
              price: 119,
              stock: 18,
              delivery: 'auto',
            },
          ],
        },
      },
      liveTestable: true,
      livePath: '/api/v1/reseller/compat/catalog',
    },
    {
      id: 'storefront-bootstrap',
      group: 'storefront',
      method: 'GET',
      path: '/api/storefront/bootstrap',
      title: d.epSfBootTitle,
      summary: d.epSfBootSum,
      auth: 'none',
      params: [
        {
          name: 'Host',
          in: 'header',
          type: 'string',
          required: true,
          desc: d.epSfBootP1,
        },
      ],
      sampleResponse: {
        tenant: {
          isSubAgent: true,
          agentId: 1,
          slug: 'studio',
          brandName: d.demoBrandName,
          markupPercent: 10,
          commissionRate: 15,
        },
        settings: { brand_name: d.demoBrandName, default_view_mode: 'list' },
        groups: [{ id: 1, slug: 'ai-models', name: d.demoGroupName, categories: [] }],
        counts: { featured: 7, all: 11 },
      },
      liveTestable: true,
      livePath: '/api/storefront/bootstrap',
    },
    {
      id: 'storefront-products',
      group: 'storefront',
      method: 'GET',
      path: '/api/storefront/products',
      title: d.epSfProdTitle,
      summary: d.epSfProdSum,
      auth: 'none',
      params: [
        {
          name: 'category',
          in: 'query',
          type: 'string',
          required: false,
          desc: d.epSfProdP1,
        },
        { name: 'q', in: 'query', type: 'string', required: false, desc: d.epSfProdP2 },
        {
          name: 'tag',
          in: 'query',
          type: 'string',
          required: false,
          desc: d.epSfProdP3,
        },
      ],
      sampleResponse: {
        tenant: { isSubAgent: false, markupPercent: 0 },
        items: [
          { id: 1, title: d.demoProdShort, price: 140, available_stock: 18, stock_label: d.demoStockLabel },
        ],
      },
      liveTestable: true,
      livePath: '/api/storefront/products?category=featured',
    },
    {
      id: 'storefront-product-detail',
      group: 'storefront',
      method: 'GET',
      path: '/api/storefront/products/:idOrSlug',
      title: d.epSfDetailTitle,
      summary: d.epSfDetailSum,
      auth: 'none',
      params: [
        {
          name: 'idOrSlug',
          in: 'path',
          type: 'string',
          required: true,
          desc: d.epSfDetailP1,
        },
      ],
      sampleResponse: {
        product: {
          id: 1,
          title: d.demoProdTitle,
          price: 140,
          spec_stock: { official_topup: 6, ready_account: 6, max_5x_seat: 6 },
          specs: [],
          faq: [],
        },
      },
      liveTestable: true,
      livePath: '/api/storefront/products/1',
    },
    {
      id: 'storefront-concierge',
      group: 'storefront',
      method: 'POST',
      path: '/api/storefront/concierge/match',
      title: d.epSfConciergeTitle,
      summary: d.epSfConciergeSum,
      auth: 'none',
      params: [{ name: 'prompt', in: 'body', type: 'string', required: true, desc: d.epSfConciergeP1 }],
      sampleRequestBody: { prompt: d.demoConciergePrompt },
      sampleResponse: {
        prompt: d.demoConciergePrompt,
        reasoning: d.demoConciergeReason,
        items: [],
      },
      liveTestable: true,
      livePath: '/api/storefront/concierge/match',
    },
  ];
}
