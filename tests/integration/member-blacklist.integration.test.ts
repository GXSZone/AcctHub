import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agents,
  categories,
  categoryGroups,
  productCards,
  products,
  users,
  walletTransactions,
} from '../../worker/db/schema/index';
import { saveSiteMailConfig } from '../../worker/infra/mail';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('全站会员拉黑联防与安全物理删除集成测试', () => {
  let ctx: TestAppContext;
  let adminHeaders: { Authorization: string };
  let productId: number;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();

    const [group] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'g-bl', name: '测试大类', sortOrder: 1, isActive: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: group.id, slug: 'c-bl', name: '测试分类', sortOrder: 1, isActive: 1 })
      .returning();
    const [prod] = await ctx.db
      .insert(products)
      .values({
        ownerAgentId: 0,
        categoryId: cat.id,
        slug: 'p-bl',
        title: '测试商品',
        basePrice: 10,
        stockMode: 'cards',
        specsJson: JSON.stringify([{ id: 'std', name: '标准', price: 10 }]),
        isActive: 1,
      })
      .returning();
    productId = prod.id;
    await ctx.db.insert(productCards).values({
      productId: prod.id,
      specId: 'std',
      cardContent: 'CARD-BL-001',
      status: 'available',
    });

    await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHub',
      from_email: 'noreply@example.com',
      api_endpoint: 'https://mail-relay.example.com/send',
    });

    // 准备一个测试分站用于验证跨分站同邮箱注册拦截
    const subOwner = await ctx.jsonRequest<{ user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'subowner@example.com', password: 'Password123!' }),
    });
    await ctx.db.insert(agents).values({
      userId: subOwner.data.user.id,
      slug: 'blshop',
      brandName: '分站测试店',
      apiKey: 'ak_blshop_test',
      status: 'active',
    });
  });

  afterEach(() => {
    ctx.close();
  });

  it('拉黑后立即吊销会话，全站拦截登录、跨分站注册、游客下单与到货订阅，解除拉黑后恢复', async () => {
    const targetEmail = 'badguy@example.com';
    const reg = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail, password: 'Password123!' }),
    });
    expect(reg.status).toBe(200);
    const userId = reg.data.user.id;
    const token = reg.data.token;

    // 1. 总控拉黑该会员
    const banRes = await ctx.jsonRequest(`/api/admin/members/${userId}/status`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'blacklisted', reason: '恶意拒付' }),
    });
    expect(banRes.status).toBe(200);

    // 2. 原 Token 立刻失效：/api/auth/me 返回 user: null，受保护接口直接返回 401
    const meRes = await ctx.jsonRequest<{ user: unknown }>('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.data.user).toBeNull();
    const protectedRes = await ctx.jsonRequest('/api/account/tickets', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(protectedRes.status).toBe(401);

    // 3. 再次登录直接 403
    const loginRes = await ctx.jsonRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail, password: 'Password123!' }),
    });
    expect(loginRes.status).toBe(403);

    // 4. 跨分站使用同一邮箱注册新号直接 403
    const crossReg = await ctx.jsonRequest('http://blshop.localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail, password: 'Password123!' }),
    });
    expect(crossReg.status).toBe(403);

    // 5. 游客免登录使用拉黑邮箱下单直接 403
    const guestOrder = await ctx.jsonRequest('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        product_id: productId,
        spec_id: 'std',
        quantity: 1,
        contact_email: targetEmail,
        payment_method: 'demo_instant',
      }),
    });
    expect(guestOrder.status).toBe(403);

    // 6. 使用拉黑邮箱登记到货提醒直接 403
    const restockRes = await ctx.jsonRequest('/api/storefront/restock-subscribe', {
      method: 'POST',
      body: JSON.stringify({ product_id: productId, spec_id: 'std', email: targetEmail }),
    });
    expect(restockRes.status).toBe(403);

    // 7. 解除拉黑后恢复正常登录
    const unbanRes = await ctx.jsonRequest(`/api/admin/members/${userId}/status`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'active' }),
    });
    expect(unbanRes.status).toBe(200);

    const loginAgain = await ctx.jsonRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: targetEmail, password: 'Password123!' }),
    });
    expect(loginAgain.status).toBe(200);
  });

  it('物理删除严格执行资金守恒拦截：有余额拒绝 409，空账号允许彻底删除', async () => {
    const reg = await ctx.jsonRequest<{ user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'deletable@example.com', password: 'Password123!' }),
    });
    const userId = reg.data.user.id;

    // 模拟持有余额 -> 拒绝物理删除
    await ctx.db.update(users).set({ balance: 50 }).where(eq(users.id, userId));
    const blocked = await ctx.jsonRequest(`/api/admin/members/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(blocked.status).toBe(409);

    // 余额归零但仍存在钱包流水记录（沙盒注册赠金流水）-> 资金守恒防线依然拒绝 409
    await ctx.db.update(users).set({ balance: 0, promoBalance: 0 }).where(eq(users.id, userId));
    const blockedByLedger = await ctx.jsonRequest(`/api/admin/members/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(blockedByLedger.status).toBe(409);

    // 真正无余额且无任何财务流水的空账号 -> 允许彻底物理删除
    await ctx.db.delete(walletTransactions).where(eq(walletTransactions.userId, userId));
    const okDel = await ctx.jsonRequest(`/api/admin/members/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(okDel.status).toBe(200);
    const remaining = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(remaining.length).toBe(0);
  });
});
