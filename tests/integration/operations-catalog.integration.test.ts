import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  agentTiers,
  categories,
  categoryGroups,
  products,
  users,
} from '../../worker/db/schema/index';
import { issueAuthSession } from '../../worker/domains/auth/auth.session';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('商品目录及代理定价行为', () => {
  let ctx: TestAppContext;
  let categoryId: number;
  let adminToken: string;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp({ ADMIN_SECRET: 'catalog-admin' });
    const setup = await ctx.jsonRequest<{ token: string }>('/api/setup/initialize', {
      method: 'POST',
      body: JSON.stringify({
        setup_secret: 'catalog-admin',
        admin_email: 'admin@catalog.dev',
        admin_password: 'StrongPassword#2026',
        brand_name: 'Catalog',
      }),
    });
    expect(setup.ok).toBe(true);
    adminToken = setup.data.token;
    const [group] = await ctx.db.insert(categoryGroups).values({ slug: 'ops', name: '目录' }).returning();
    const [category] = await ctx.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'opsp', name: '商品' })
      .returning();
    categoryId = category.id;
  });

  afterEach(() => ctx.close());

  function createProduct(body: Record<string, unknown>) {
    return ctx.jsonRequest<{ id: number }>('/api/admin/products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ category_id: categoryId, title: '本地商品', base_price: 100, ...body }),
    });
  }

  it('[B16] 零库存下架商品可按正常编辑流程上架', async () => {
    const created = await createProduct({ stock_mode: 'manual_stock', manual_stock: 0, is_active: false });
    expect(created.ok).toBe(true);
    const url = `/api/storefront/products/${created.data.id}`;
    const [row] = await ctx.db.select().from(products).where(eq(products.id, created.data.id));
    expect(row).toMatchObject({ manualStock: 0, isActive: 0 });
    expect((await ctx.jsonRequest(url)).status).toBe(404);
    const published = await ctx.jsonRequest(`/api/admin/products/${created.data.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ is_active: true }),
    });
    expect(published.ok).toBe(true);
    const detail = await ctx.jsonRequest<{ product: { available_stock: number } }>(url);
    expect(detail.data.product.available_stock).toBe(0);
  });

  it('[B27] 拒绝超过单笔最多购买量的档位并保留可兑现的边界档位', async () => {
    const invalid = await createProduct({ tier_pricing: [{ min_qty: 21, discount_rate: 0.9 }] });
    expect(invalid.status).toBe(400);
    const valid = await createProduct({ tier_pricing: [{ min_qty: 20, discount_rate: 0.9 }] });
    expect(valid.ok).toBe(true);
    const detail = await ctx.jsonRequest<{ product: { tier_pricing: unknown[] } }>(
      `/api/storefront/products/${valid.data.id}`
    );
    expect(detail.data.product.tier_pricing).toEqual([{ min_qty: 20, discount_rate: 0.9 }]);
    const update = await ctx.jsonRequest(`/api/admin/products/${valid.data.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ tier_pricing: [{ min_qty: 21, discount_rate: 0.9 }] }),
    });
    expect(update.status).toBe(400);
  });

  it('[B34] 商品管理接口限制新建和编辑时的席位数', async () => {
    expect((await createProduct({ stock_mode: 'seats', seat_total: 21 })).status).toBe(400);
    const created = await createProduct({ stock_mode: 'seats', seat_total: 20, seat_used: 5 });
    expect(created.ok).toBe(true);
    const updated = await ctx.jsonRequest(`/api/admin/products/${created.data.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ seat_total: 21 }),
    });
    expect(updated.status).toBe(400);
    const overused = await ctx.jsonRequest(`/api/admin/products/${created.data.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ seat_used: 21 }),
    });
    expect(overused.status).toBe(400);
  });

  async function seedAgent() {
    const [member] = await ctx.db
      .insert(users)
      .values({ email: 'agent@ops.dev', displayName: '代理', role: 'agent', passwordHash: 'unused' })
      .returning();
    const [agent] = await ctx.db
      .insert(agents)
      .values({
        userId: member.id,
        brandName: 'Beta',
        slug: 'ops-beta',
        status: 'active',
        apiKey: 'ops-test-key',
      })
      .returning();
    const token = await issueAuthSession(ctx.db, ctx.env, member);
    return { agent, token };
  }

  it('[B24] 分站商品列表和详情使用分站自己的批发基准', async () => {
    const { agent } = await seedAgent();
    await ctx.db.insert(agentTiers).values({
      ownerAgentId: agent.id,
      code: 'entry',
      name: '分站起始',
      levelRank: 1,
      discountRate: 0.96,
    });
    const created = await createProduct({
      slug: 'tenant-wholesale',
      delivery_type: 'manual',
      stock_mode: 'manual_stock',
      manual_stock: 10,
    });
    expect(created.ok).toBe(true);
    const list = await ctx.jsonRequest<{ items: { wholesale_price: number }[] }>(
      'http://ops-beta.localhost/api/storefront/products?category=all'
    );
    const detail = await ctx.jsonRequest<{ product: { wholesale_price: number } }>(
      `http://ops-beta.localhost/api/storefront/products/${created.data.id}`
    );
    expect(list.data.items[0].wholesale_price).toBe(96);
    expect(detail.data.product.wholesale_price).toBe(96);
    const [buyer] = await ctx.db
      .insert(users)
      .values({
        email: 'child@ops.dev',
        displayName: '直属代理',
        role: 'agent',
        siteAgentId: agent.id,
        passwordHash: 'unused',
        balance: 200,
      })
      .returning();
    await ctx.db.insert(agents).values({
      userId: buyer.id,
      parentAgentId: agent.id,
      brandName: 'Child',
      slug: 'ops-child',
      status: 'active',
      apiKey: 'ops-child-key',
    });
    const token = await issueAuthSession(ctx.db, ctx.env, buyer);
    const checkout = await ctx.jsonRequest<{ order: { total_amount: number } }>(
      'http://ops-beta.localhost/api/orders',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          product_id: created.data.id,
          quantity: 1,
          contact_email: buyer.email,
          payment_method: 'balance',
        }),
      }
    );
    expect(checkout.ok).toBe(true);
    expect(checkout.data.order.total_amount).toBe(detail.data.product.wholesale_price);
  });

  it('[B17] 空目标改价和恢复默认均不改动已有商品定价', async () => {
    const { agent, token } = await seedAgent();
    const agentOrigin = `http://${agent.slug}.localhost`;
    const created = await createProduct({ stock_mode: 'manual_stock', manual_stock: 10 });
    async function batch(body: Record<string, unknown>) {
      return ctx.jsonRequest<{ updated_count: number }>(`${agentOrigin}/api/agent/pricing/batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    }
    const fullUpdate = await batch({ mode: 'markup_main_pct', value: 25, scope: 'all' });
    expect(fullUpdate.ok).toBe(true);
    expect(fullUpdate.data.updated_count).toBe(1);
    const readPrice = async () => {
      const matrix = await ctx.jsonRequest<{
        items: { product_id: number; specs: { custom_price: number | null }[] }[];
      }>(`${agentOrigin}/api/agent/pricing`, { headers: { Authorization: `Bearer ${token}` } });
      return matrix.data.items.find((x) => x.product_id === created.data.id)?.specs[0].custom_price;
    };
    expect(await readPrice()).toBe(125);
    expect((await batch({ mode: 'reset_all' })).status).toBe(400);
    expect(await readPrice()).toBe(125);
    expect((await batch({ mode: 'markup_main_pct', value: 60, targets: [] })).data.updated_count).toBe(0);
    expect(await readPrice()).toBe(125);
    expect((await batch({ mode: 'reset_all', targets: [] })).data.updated_count).toBe(0);
    expect(await readPrice()).toBe(125);
    const fullReset = await batch({ mode: 'reset_all', scope: 'all' });
    expect(fullReset.ok).toBe(true);
    expect(await readPrice()).toBeNull();
  });

  it('[B19] 亏损确认绑定对应等级、折扣和当前商品成本', async () => {
    const created = await createProduct({ slug: 'tier-cost', cost_price: 80, allow_below_cost: true });
    expect(created.ok).toBe(true);
    const levels = await ctx.db
      .insert(agentTiers)
      .values([
        { ownerAgentId: 0, code: 'ops-a', name: '等级 A', levelRank: 10, discountRate: 0.95 },
        { ownerAgentId: 0, code: 'ops-b', name: '等级 B', levelRank: 11, discountRate: 0.95 },
      ])
      .returning();
    const update = (id: number, patch: Record<string, unknown>) =>
      ctx.jsonRequest<{ code: string; loss_confirmation: string }>(`/api/admin/agent-tiers/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(patch),
      });
    const [a, b] = levels;
    const rejected = await update(a.id, { discount_rate: 0.7, force_allow_loss: true });
    expect(rejected.status).toBe(400);
    expect(rejected.data.code).toBe('TIER_DISCOUNT_CAUSES_LOSS');
    expect(rejected.data.loss_confirmation).toBeUndefined();
    const previewLoss = (path: string) =>
      ctx.jsonRequest<{ loss_confirmation: string }>(path, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    const previewPath = `/api/admin/agent-tiers/${a.id}/loss-preview?discount_rate=0.7`;
    const preview = await previewLoss(previewPath);
    expect(preview.data.loss_confirmation).toBeTruthy();
    expect(
      (await update(b.id, { discount_rate: 0.7, loss_confirmation: preview.data.loss_confirmation })).status
    ).toBe(400);
    expect(
      (await update(a.id, { discount_rate: 0.71, loss_confirmation: preview.data.loss_confirmation })).status
    ).toBe(400);

    await ctx.db.update(products).set({ costPrice: 81 }).where(eq(products.id, created.data.id));
    expect(
      (await update(a.id, { discount_rate: 0.7, loss_confirmation: preview.data.loss_confirmation })).status
    ).toBe(400);
    const revised = await previewLoss(previewPath);
    expect(revised.data.loss_confirmation).not.toBe(preview.data.loss_confirmation);
    expect(
      (await update(a.id, { discount_rate: 0.7, loss_confirmation: revised.data.loss_confirmation })).ok
    ).toBe(true);

    const create = (patch: Record<string, unknown>) =>
      ctx.jsonRequest<{ id: number; loss_confirmation: string }>('/api/admin/agent-tiers', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ code: 'ops-new', name: '新等级', discount_rate: 0.7, ...patch }),
      });
    expect((await create({ force_allow_loss: true })).status).toBe(400);
    expect((await create({ loss_confirmation: revised.data.loss_confirmation })).status).toBe(400);
    const createPreview = await previewLoss(
      '/api/admin/agent-tiers/loss-preview?code=ops-new&discount_rate=0.7'
    );
    expect(createPreview.data.loss_confirmation).toBeTruthy();
    expect(
      (await create({ code: 'ops-other', loss_confirmation: createPreview.data.loss_confirmation })).status
    ).toBe(400);
    const createdTier = await create({ loss_confirmation: createPreview.data.loss_confirmation });
    expect(createdTier.ok).toBe(true);

    const audit = await ctx.jsonRequest<{ logs: Array<{ targetId: string; afterJson: string }> }>(
      '/api/admin/audit-logs?action=agent-tiers',
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    expect(audit.data.logs.map((entry) => entry.targetId).sort()).toEqual(
      [String(a.id), String(createdTier.data.id)].sort()
    );
    for (const entry of audit.data.logs) {
      expect(JSON.parse(entry.afterJson)).toEqual({
        loss_discount_rate: 0.7,
        loss_cost_version: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(entry.afterJson).not.toContain(createPreview.data.loss_confirmation);
    }
  });

  it('[B54] 代理控制台公开接入模式且不公开 Cloudflare 凭据', async () => {
    const { token } = await seedAgent();
    const fetchProfile = () =>
      ctx.jsonRequest<{ domain_config: { provisioning_mode: string } }>('/api/agent/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
    expect((await fetchProfile()).data.domain_config.provisioning_mode).toBe('manual_review');
    await ctx.d1
      .prepare('INSERT INTO site_settings (key, value) VALUES (?, ?), (?, ?)')
      .bind('cf_saas_zone_id', 'zone-not-for-client', 'cf_saas_api_token', 'token-not-for-client')
      .run();
    const configured = await fetchProfile();
    expect(configured.data.domain_config.provisioning_mode).toBe('cloudflare_saas');
    expect(JSON.stringify(configured.data)).not.toContain('token-not-for-client');
  });
});

it.each([
  [{ APP_ENV: 'test', SANDBOX_MODE: 'true' }, 50],
  [{ APP_ENV: 'production', SANDBOX_MODE: 'true' }, 0],
] as const)('[B52] 公开的注册权益与实际注册余额一致 (%j)', async (env, expected) => {
  resetRateLimitBucketsForTest();
  const ctx = createTestApp(env);
  try {
    const bootstrap = await ctx.jsonRequest<{ registration: { welcome_credit: number } }>(
      '/api/storefront/bootstrap'
    );
    expect(bootstrap.data.registration?.welcome_credit).toBe(expected);
    const registration = await ctx.jsonRequest<{ user: { balance: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'buyer@ops.dev', password: 'StrongPassword#2026' }),
    });
    expect(registration.ok).toBe(true);
    expect(registration.data.user.balance).toBe(expected);
  } finally {
    ctx.close();
  }
});
