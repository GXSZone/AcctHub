import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { UpstreamBindingsTable } from './UpstreamBindingsTable';

it('[B44] 路由矩阵展示配置优先级且不预判最低成本策略的成交来源', () => {
  const html = renderToStaticMarkup(
    createElement(UpstreamBindingsTable, {
      bindings: [
        {
          id: 1,
          product_id: 1,
          spec_id: 'default',
          source_id: 1,
          upstream_item_id: 'sku',
          upstream_spec_id: '',
          fulfillment_mode: 'local_first',
          routing_strategy: 'lowest_cost',
          priority: 4,
          cached_cost: 30,
          cached_stock: 0,
          is_enabled: 1,
          circuit_broken_reason: '',
          updated_at: '',
          source_name: '测试货源',
          adapter_type: 'generic_json',
          cached_balance: 0,
          source_status: 'active',
        },
      ],
      onReloadAll: vi.fn(async () => undefined),
      onStorefrontUpdated: vi.fn(),
      showToast: vi.fn(),
    })
  );
  expect(html).toContain('value="4"');
  expect(html).not.toContain('主源 Primary');
});
