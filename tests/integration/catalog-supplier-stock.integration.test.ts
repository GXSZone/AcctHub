import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  categories,
  categoryGroups,
  productCards,
  products,
  productUpstreamBindings,
  upstreamSources,
  users,
} from '../../worker/db/schema/index';
import { sha256Hex } from '../../worker/infra/crypto';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('库存展示遵守供应商采购策略与余额约束', () => {
  const resellerKey = 'ah_agent_supplier_catalog_test';
  let ctx: TestAppContext;
  let localFirstId: number;
  let upstreamOnlyId: number;

  beforeEach(async () => {
    ctx = createTestApp({ APP_ENV: 'production', SANDBOX_MODE: 'true' });
    const [group] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'fixture', name: '测试分组' })
      .returning();
    const [category] = await ctx.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'fixture', name: '测试分类' })
      .returning();
    const [localFirst, upstreamOnly] = await ctx.db
      .insert(products)
      .values(
        ['local-first', 'upstream-only'].map((slug) => ({
          categoryId: category.id,
          slug,
          title: slug,
          basePrice: 20,
          stockMode: 'cards',
          specsJson: JSON.stringify([{ id: 'standard', name: '标准版', price: 20 }]),
          isActive: 1,
        }))
      )
      .returning();
    localFirstId = localFirst.id;
    upstreamOnlyId = upstreamOnly.id;
    const [primary, secondary, mock] = await ctx.db
      .insert(upstreamSources)
      .values([
        { name: '主启用真实货源', adapterType: 'generic_json', cachedBalance: 30 },
        { name: '备用真实货源', adapterType: 'generic_json', cachedBalance: 20 },
        { name: '模拟货源', adapterType: 'mock_sandbox', cachedBalance: 400 },
      ])
      .returning();
    for (const [productId, fulfillmentMode] of [
      [localFirstId, 'local_first'],
      [upstreamOnlyId, 'upstream_only'],
    ] as const) {
      await ctx.db.insert(productCards).values({
        productId,
        specId: 'standard',
        cardContent: `测试凭证-${productId}`,
        status: 'available',
      });
      await ctx.db.insert(productUpstreamBindings).values(
        [primary, secondary, mock].map((source) => ({
          productId,
          sourceId: source.id,
          specId: 'standard',
          upstreamItemId: `item-${productId}`,
          fulfillmentMode,
          cachedCost: 10,
          cachedStock: 50,
        }))
      );
    }
    const [owner] = await ctx.db
      .insert(users)
      .values({
        email: 'supplier-catalog-agent@example.test',
        displayName: '目录测试代理',
        passwordHash: 'unused-fixture-password',
        role: 'agent',
      })
      .returning();
    await ctx.db.insert(agents).values({
      userId: owner.id,
      slug: 'supplier-catalog-agent',
      brandName: '目录测试代理',
      apiKey: 'supplier-catalog-key-label',
      apiKeyHash: await sha256Hex(resellerKey),
      status: 'active',
    });
  });

  afterEach(() => ctx.close());

  async function expectStock(productId: number, stock: number) {
    const auth = { headers: { Authorization: `Bearer ${resellerKey}` } };
    const [list, detail, reseller, compat] = await Promise.all([
      ctx.jsonRequest<{ items: Array<{ id: number; available_stock: number }> }>(
        '/api/storefront/products?category=all&nocache=1'
      ),
      ctx.jsonRequest<{ product: { available_stock: number; spec_stock: Record<string, number> } }>(
        `/api/storefront/products/${productId}`
      ),
      ctx.jsonRequest<{
        products: Array<{ id: number; available_stock: number; specs: Array<{ available_stock: number }> }>;
      }>('/api/v1/reseller/products', auth),
      ctx.jsonRequest<{ data: { goods: Array<{ product_id: number; spec_id: string; stock: number }> } }>(
        '/api/v1/reseller/compat/catalog',
        auth
      ),
    ]);
    expect([list.status, detail.status, reseller.status, compat.status]).toEqual([200, 200, 200, 200]);
    const resellerProduct = reseller.data.products.find(({ id }) => id === productId);
    const compatSpec = compat.data.data.goods.find(
      ({ product_id, spec_id }) => product_id === productId && spec_id === 'standard'
    );
    expect({
      storefrontList: list.data.items.find(({ id }) => id === productId)?.available_stock,
      storefrontDetail: detail.data.product.available_stock,
      storefrontSpec: detail.data.product.spec_stock.standard,
      resellerProduct: resellerProduct?.available_stock,
      resellerSpec: resellerProduct?.specs[0]?.available_stock,
      resellerCompatSpec: compatSpec?.stock,
    }).toEqual({
      storefrontList: stock,
      storefrontDetail: stock,
      storefrontSpec: stock,
      resellerProduct: stock,
      resellerSpec: stock,
      resellerCompatSpec: stock,
    });
  }

  it('按可用真实货源最大可采购量与余额上限约束库存，并在非沙盒模式排除模拟货源', async () => {
    await expectStock(localFirstId, 4);
    await expectStock(upstreamOnlyId, 3);
  });

  it('当商品未配置可用真实货源时，保留本地卡密库存，仅上游规格显示售罄', async () => {
    ctx.env.SANDBOX_MODE = 'false';
    await ctx.db.delete(upstreamSources);
    const [mockOnly] = await ctx.db
      .insert(upstreamSources)
      .values({ name: '模拟货源', adapterType: 'mock_sandbox', cachedBalance: 400 })
      .returning();
    await ctx.db.insert(productUpstreamBindings).values([
      {
        productId: localFirstId,
        sourceId: mockOnly.id,
        specId: 'standard',
        upstreamItemId: `item-${localFirstId}`,
        fulfillmentMode: 'local_first',
        cachedCost: 10,
        cachedStock: 50,
      },
      {
        productId: upstreamOnlyId,
        sourceId: mockOnly.id,
        specId: 'standard',
        upstreamItemId: `item-${upstreamOnlyId}`,
        fulfillmentMode: 'upstream_only',
        cachedCost: 10,
        cachedStock: 50,
      },
    ]);
    await expectStock(localFirstId, 1);
    await expectStock(upstreamOnlyId, 0);
  });
});
