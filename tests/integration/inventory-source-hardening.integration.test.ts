import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  orders,
  productCards,
  products,
  productUpstreamBindings,
  upstreamOrders,
} from '../../worker/db/schema/index';
import { createResellerOrder } from '../../worker/domains/reseller/reseller.service';
import { settleAsyncUpstreamCardsOutcome } from '../../worker/domains/upstream/upstream.poll.service';
import { listAutoSyncActiveSourcesRepo } from '../../worker/domains/upstream/upstream.repo';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('库存、批采与货源后台回归', () => {
  let ctx: TestAppContext;
  let productId: number;
  let adminHeaders: { Authorization: string };
  const createSource = (body: Record<string, unknown>, key?: string) =>
    ctx.jsonRequest<{ id: number }>('/api/admin/upstreams', {
      method: 'POST',
      headers: { ...adminHeaders, ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ name: '测试货源', ...body }),
    });
  const importLines = (lines: string) =>
    ctx.jsonRequest<{ imported: number; duplicates: number; rejected_samples: number }>(
      `/api/admin/products/${productId}/cards`,
      { method: 'POST', headers: adminHeaders, body: JSON.stringify({ spec_id: 'default', lines }) }
    );

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();
    const [product] = await ctx.db
      .insert(products)
      .values({
        categoryId: 1,
        slug: 'inventory-test',
        title: '测试商品',
        basePrice: 100,
        isActive: 1,
      })
      .returning();
    productId = product.id;
  });

  afterEach(() => ctx.close());

  it('[B04] 导入统一去掉凭证外层空白并按商品去重', async () => {
    expect((await importLines('  Example-Code  \r\nExample-Code\n')).data.imported).toBe(1);
    expect((await importLines('\tExample-Code')).data).toMatchObject({ imported: 0, duplicates: 1 });
    expect(await ctx.db.select().from(productCards)).toHaveLength(1);
  });

  it('[B45] 样例凭证单独计数并且不占用真实库存', async () => {
    const result = await importLines(
      'vip.1.BCDE@accthub.mail----Pass!2026----2FA:JBSWY3DPEHPK3PXP\nreal-inventory-item'
    );
    expect(result.data).toMatchObject({ imported: 1, rejected_samples: 1 });
    expect(await ctx.db.select().from(productCards)).toHaveLength(1);
  });

  it('[B45] 模拟货源不能用于预拉真实库存', async () => {
    const { data } = await createSource({ adapter_type: 'mock_sandbox' });
    const [binding] = await ctx.db
      .insert(productUpstreamBindings)
      .values({
        productId,
        sourceId: data.id,
        upstreamItemId: 'fixture',
        cachedStock: 10,
      })
      .returning();
    const res = await ctx.jsonRequest(`/api/admin/upstreams/bindings/${binding.id}/pull-cards`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ quantity: 1 }),
    });
    expect(res.status).toBe(400);
    expect(await ctx.db.select().from(productCards)).toHaveLength(0);
    expect(await ctx.db.select().from(upstreamOrders)).toHaveLength(0);
  });

  it('[S30] 上游补货复用手工导入的凭证指纹并完成采购台账', async () => {
    await importLines(' stocked-item ');
    const { data } = await createSource({});
    const [purchase] = await ctx.db
      .insert(upstreamOrders)
      .values({
        sourceId: data.id,
        idempotencyOutTradeNo: 'test-restock-1',
        purpose: 'restock_pull',
        productId,
        specId: 'default',
        quantity: 2,
        status: 'pending',
      })
      .returning();
    const settlement = {
      upOrder: purchase,
      sourceId: data.id,
      cards: ['stocked-item', 'new-stock'],
      upstreamOrderNo: 'supplier-test-ref',
      actualCost: 1,
      originUrl: 'http://localhost',
    };
    const outcomes = await Promise.all([
      settleAsyncUpstreamCardsOutcome(ctx.env, settlement),
      settleAsyncUpstreamCardsOutcome(ctx.env, settlement),
    ]);
    expect(outcomes).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    const stock = await ctx.db.select().from(productCards);
    expect(stock).toHaveLength(2);
    expect(stock.filter((card) => card.upstreamPurchaseId === purchase.id)).toHaveLength(1);
    const [saved] = await ctx.db.select().from(upstreamOrders).where(eq(upstreamOrders.id, purchase.id));
    expect(saved.status).toBe('succeeded');
  });

  it('[S32] 批采根据调用代理和幂等键识别重试并拒绝客户引用变化', async () => {
    const agent = {
      id: 123,
      userId: 12,
      slug: 'test-agent',
      brandName: '测试',
      apiIpWhitelist: '',
      totalCommission: 0,
      balance: 100,
      totalRecharged: 0,
      ownerEmail: 'owner@example.test',
      tierName: '测试',
      tierCode: 'test',
      levelRank: 1,
      tierDiscountRate: 1,
    };
    await ctx.db.insert(orders).values({
      orderNo: 'B2B-TEST',
      agentId: agent.id,
      tenantSlug: agent.slug,
      contactEmail: 'original-ref',
      channel: 'reseller_api',
      idempotencyKey: 'b2b:123:original-request',
      productId,
      productTitle: '测试商品',
      unitPrice: 100,
      totalAmount: 100,
      status: 'paid',
    });
    const retry = (customer_ref: string) =>
      createResellerOrder(
        ctx.env,
        agent,
        { product_id: productId, customer_ref, idempotency_key: 'original-request' },
        undefined,
        'http://localhost'
      );
    expect(await retry('original-ref')).toMatchObject({ status: 200, body: { order_no: 'B2B-TEST' } });
    expect(await retry('changed-ref')).toMatchObject({ status: 409 });
    expect(await ctx.db.select().from(orders)).toHaveLength(1);
  });

  it('[B13] 同一创建意图重复提交返回原货源并校验配置一致', async () => {
    const key = 'source-create-test-1234';
    const first = await createSource({}, key);
    const repeated = await createSource({}, key);
    expect(repeated.data.id).toBe(first.data.id);
    expect((await createSource({ name: '另一个名称' }, key)).status).toBe(409);
    expect((await createSource({}, 'source-create-test-5678')).data.id).not.toBe(first.data.id);
  });

  it('[B41] 停用货源保留状态并且不会被自动同步', async () => {
    const { data } = await createSource({ status: 'paused' });
    expect(await listAutoSyncActiveSourcesRepo(ctx.db)).not.toContainEqual(
      expect.objectContaining({ id: data.id })
    );
    const edit = (status: string) =>
      ctx.jsonRequest(`/api/admin/upstreams/${data.id}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({ status }),
      });
    expect((await edit('active')).status).toBe(200);
    expect(await listAutoSyncActiveSourcesRepo(ctx.db)).toContainEqual(
      expect.objectContaining({ id: data.id })
    );
    expect((await edit('invalid')).status).toBe(400);
  });

  it('[B42] 修改货源高级配置时保留未编辑的嵌套字段', async () => {
    const { data } = await createSource({
      order_template: { method: 'POST', extra_headers: { 'X-Protocol': 'v1' } },
      response_mapping: { success_values: ['OK'], cards_path: 'payload.cards' },
    });
    const update = await ctx.jsonRequest(`/api/admin/upstreams/${data.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        name: '更新名称',
        order_template: { content_type: 'json' },
        response_mapping: { cards_path: 'result.cards' },
      }),
    });
    expect(update.status).toBe(200);
    const source = await ctx.d1
      .prepare('select order_template_json, response_mapping_json from upstream_sources where id = ?')
      .bind(data.id)
      .first<{ order_template_json: string; response_mapping_json: string }>();
    expect(source && JSON.parse(source.order_template_json)).toEqual({
      method: 'POST',
      extra_headers: { 'X-Protocol': 'v1' },
      content_type: 'json',
    });
    expect(source && JSON.parse(source.response_mapping_json)).toEqual({
      success_values: ['OK'],
      cards_path: 'result.cards',
    });
  });

  it('[B43] 商品绑定删除必须匹配所属商品', async () => {
    const { data } = await createSource({});
    const [binding] = await ctx.db
      .insert(productUpstreamBindings)
      .values({
        productId,
        sourceId: data.id,
        upstreamItemId: 'fixture',
      })
      .returning();
    const remove = (owner: number) =>
      ctx.jsonRequest(`/api/admin/upstreams/bindings/${binding.id}?product_id=${owner}`, {
        method: 'DELETE',
        headers: adminHeaders,
      });
    expect((await remove(productId + 1)).status).toBe(404);
    expect(await ctx.db.select().from(productUpstreamBindings)).toHaveLength(1);
    expect((await remove(productId)).status).toBe(200);
    expect(await ctx.db.select().from(productUpstreamBindings)).toHaveLength(0);
  });
});
