import { expect, it } from 'vitest';
import { docsZhCN } from '../../i18n/namespaces/docs/zh-CN';
import { buildEndpoints } from './api-docs.catalog';

it('[B48] 批采文档区分已交付与已扣款待交付，并用原业务号查单', () => {
  const endpoints = buildEndpoints(docsZhCN);
  const purchase = endpoints.find(({ id }) => id === 'reseller-order');
  const lookup = endpoints.find(({ id }) => id === 'reseller-order-status');
  expect(purchase?.method).toBe('POST');
  expect(lookup).toMatchObject({ method: 'GET', path: purchase?.path, auth: 'reseller_key' });
  expect(purchase?.summary).toContain('upstream_pending 已扣款，cards 为空');
  expect(purchase?.sampleResponse).toMatchObject({ status: 'delivered', cards: [expect.any(String)] });
  expect(lookup?.sampleResponse).toMatchObject({
    order_no: purchase?.sampleResponse.order_no,
    status: 'upstream_pending',
    cards: [],
    total_deducted: purchase?.sampleResponse.total_deducted,
  });
  expect(lookup?.params?.map(({ name }) => name)).toEqual(['order_no', 'idempotency_key']);
});

it('[B50] 查单文档说明每页最多五十条并给出读取下一页的游标', () => {
  const lookup = buildEndpoints(docsZhCN).find(({ path }) => path === '/api/orders/lookup');
  expect(lookup?.summary).toMatch(/本站本人的订单.*每页最多 50 条/);
  expect(lookup?.params).toContainEqual(
    expect.objectContaining({ name: 'cursor', desc: expect.stringContaining('next_cursor') })
  );
  expect(lookup?.sampleResponse).toHaveProperty('next_cursor');
});
