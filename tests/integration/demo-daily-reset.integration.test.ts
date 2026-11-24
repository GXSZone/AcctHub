import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { products, siteSettings, users } from '../../worker/db/schema/index';
import { ensureDemoSeeded } from '../../worker/db/seeds';
import { maybeRunDailyDemoReset, resetPublicDemoDatabase } from '../../worker/db/seeds/reset';
import { createTestApp, type TestAppContext } from './helpers/test-app';

let ctx: TestAppContext;

beforeEach(() => {
  ctx = createTestApp({
    APP_ENV: 'development',
    SANDBOX_MODE: 'true',
    PUBLIC_DEMO_MODE: 'true',
  });
});

afterEach(() => ctx.close());

it('非公开演示环境绝不执行重置删库操作', async () => {
  await ensureDemoSeeded(ctx.env);
  const nonDemoEnv = { APP_ENV: 'development', SANDBOX_MODE: 'true' } as typeof ctx.env;
  const prodEnv = {
    APP_ENV: 'production',
    SANDBOX_MODE: 'false',
    PUBLIC_DEMO_MODE: 'true',
  } as typeof ctx.env;

  expect(await resetPublicDemoDatabase(nonDemoEnv, '2026-12-01')).toBe(false);
  expect(await maybeRunDailyDemoReset(prodEnv, '2026-12-01')).toBe(false);

  const [countRow] = await ctx.db.select({ c: sql<number>`count(*)` }).from(products);
  expect(Number(countRow?.c || 0)).toBeGreaterThan(0);
});

it('公开演示环境跨天自动清空脏数据、复位主键并恢复原始演示状态，同日内保持幂等', async () => {
  await ensureDemoSeeded(ctx.env);

  const [initialProd] = await ctx.db
    .select({ id: products.id, title: products.title })
    .from(products)
    .orderBy(products.id)
    .limit(1);
  const [initialProdCount] = await ctx.db.select({ c: sql<number>`count(*)` }).from(products);

  // 模拟公网访客注册账号与修改品牌名称
  const reg = await ctx.jsonRequest<{ token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'visitor-dirty@example.com', password: 'VisitorPass#2026' }),
  });
  expect(reg.status).toBe(200);

  await ctx.db
    .insert(siteSettings)
    .values({ key: 'brand_name', value: '被访客临时修改的品牌名' })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: '被访客临时修改的品牌名' },
    });

  // 同日内再次检查不应触发重复重置
  expect(await maybeRunDailyDemoReset(ctx.env)).toBe(false);
  const [dirtyBrand] = await ctx.db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'brand_name'))
    .limit(1);
  expect(dirtyBrand?.value).toBe('被访客临时修改的品牌名');

  // 模拟跨天进入新的一天，自动清空全部业务表并恢复初始演示数据
  const nextDayKey = '2099-01-02';
  expect(await maybeRunDailyDemoReset(ctx.env, nextDayKey)).toBe(true);

  const [visitorUser] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'visitor-dirty@example.com'))
    .limit(1);
  expect(visitorUser).toBeUndefined();

  const [restoredBrand] = await ctx.db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'brand_name'))
    .limit(1);
  expect(restoredBrand?.value).not.toBe('被访客临时修改的品牌名');

  const [restoredProd] = await ctx.db
    .select({ id: products.id, title: products.title })
    .from(products)
    .orderBy(products.id)
    .limit(1);
  const [restoredProdCount] = await ctx.db.select({ c: sql<number>`count(*)` }).from(products);
  expect(restoredProd?.id).toBe(initialProd?.id);
  expect(restoredProd?.title).toBe(initialProd?.title);
  expect(restoredProdCount?.c).toBe(initialProdCount?.c);

  // 新的一天内重复触发保持幂等不重跑
  expect(await maybeRunDailyDemoReset(ctx.env, nextDayKey)).toBe(false);
});
