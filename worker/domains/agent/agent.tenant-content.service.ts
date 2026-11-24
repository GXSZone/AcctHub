import { sanitizeHeaderLinksJson } from '@shared/domain/header-links';
import { and, asc, desc, eq } from 'drizzle-orm';
import { coupons, helpArticles } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { bumpEdgeCacheVersion } from '../../infra/security';
import { getTenantSettingsMapRepo, upsertTenantSettingsRepo } from '../tenant/tenant-settings.repo';
import type { ActiveAgentContext } from './agent.guard';

/** 获取分站独立运营扩展设置（API 文档显隐、帮助中心继承开关、顶部自定义外链） */
export async function getAgentSitePreferences(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const map = await getTenantSettingsMapRepo(db, ctx.agent.id, [
    'show_api_docs',
    'inherit_platform_help',
    'header_links_json',
  ]);
  return {
    show_api_docs: map.get('show_api_docs') !== '0',
    inherit_platform_help: map.get('inherit_platform_help') !== '0',
    header_links_json: map.get('header_links_json') || '[]',
  };
}

/** 更新分站独立运营扩展设置 */
export async function updateAgentSitePreferences(
  env: Env,
  ctx: ActiveAgentContext,
  body: { show_api_docs?: boolean; inherit_platform_help?: boolean; header_links_json?: string }
) {
  const db = createDb(env.DB);
  const entries: Array<[string, string]> = [];
  if (body.show_api_docs !== undefined) {
    entries.push(['show_api_docs', body.show_api_docs ? '1' : '0']);
  }
  if (body.inherit_platform_help !== undefined) {
    entries.push(['inherit_platform_help', body.inherit_platform_help ? '1' : '0']);
  }
  if (body.header_links_json !== undefined) {
    entries.push(['header_links_json', sanitizeHeaderLinksJson(body.header_links_json)]);
  }
  if (entries.length > 0) {
    await upsertTenantSettingsRepo(db, ctx.agent.id, entries);
    bumpEdgeCacheVersion();
  }
  return { ok: true, ...(await getAgentSitePreferences(env, ctx)) };
}

/** 列出当前分站自己的专属优惠券 */
export async function listAgentCoupons(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(coupons)
    .where(eq(coupons.ownerAgentId, ctx.agent.id))
    .orderBy(desc(coupons.id))
    .limit(100);
  return {
    items: rows.map((c) => ({
      id: c.id,
      owner_agent_id: c.ownerAgentId,
      code: c.code,
      name: c.name,
      discount_type: c.discountType,
      discount_value: c.discountValue,
      min_order_amount: c.minOrderAmount,
      max_uses: c.maxUses,
      used_count: c.usedCount,
      expires_at: c.expiresAt,
      is_active: c.isActive,
      created_at: c.createdAt,
    })),
  };
}

/** 分站新建专属优惠券（仅在本分站生效，自动受拿货底价保护） */
export async function createAgentCoupon(
  env: Env,
  ctx: ActiveAgentContext,
  body: {
    code?: string;
    name?: string;
    discount_type?: 'fixed' | 'percent';
    discount_value?: number;
    min_order_amount?: number;
    max_uses?: number;
    expires_at?: string | null;
  }
) {
  const code = String(body.code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (code.length < 3 || code.length > 32) {
    throw Errors.validation('优惠券码需为 3–32 位字母、数字、下划线或短横线');
  }
  const name = String(body.name || code)
    .trim()
    .slice(0, 80);
  const discountType = body.discount_type === 'percent' ? 'percent' : 'fixed';
  const rawVal = Number(body.discount_value || 0);
  if (!Number.isFinite(rawVal) || rawVal <= 0) {
    throw Errors.validation('优惠面额/折扣值必须大于 0');
  }
  const discountValue = discountType === 'percent' ? Math.min(90, rawVal) : rawVal;
  const db = createDb(env.DB);
  try {
    const [ins] = await db
      .insert(coupons)
      .values({
        ownerAgentId: ctx.agent.id,
        code,
        name,
        discountType,
        discountValue,
        minOrderAmount: Math.max(0, Number(body.min_order_amount || 0)),
        maxUses: Math.max(0, Number(body.max_uses ?? 100)),
        expiresAt: body.expires_at?.trim() ? body.expires_at.trim() : null,
        isActive: 1,
      })
      .returning({ id: coupons.id });
    return { ok: true, id: ins.id };
  } catch (err) {
    if (/unique/i.test(err instanceof Error ? err.message : '')) {
      throw Errors.conflict(`本店已存在优惠券码「${code}」`);
    }
    throw err;
  }
}

export async function toggleAgentCoupon(env: Env, ctx: ActiveAgentContext, id: number, isActive: boolean) {
  const db = createDb(env.DB);
  const updated = await db
    .update(coupons)
    .set({ isActive: isActive ? 1 : 0 })
    .where(and(eq(coupons.id, id), eq(coupons.ownerAgentId, ctx.agent.id)))
    .returning({ id: coupons.id });
  if (updated.length === 0) throw Errors.notFound('未找到该分站优惠券');
  return { ok: true };
}

export async function deleteAgentCoupon(env: Env, ctx: ActiveAgentContext, id: number) {
  const db = createDb(env.DB);
  await db.delete(coupons).where(and(eq(coupons.id, id), eq(coupons.ownerAgentId, ctx.agent.id)));
  return { ok: true };
}

/** 列出当前分站专属帮助中心文档 */
export async function listAgentHelpArticles(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(helpArticles)
    .where(eq(helpArticles.ownerAgentId, ctx.agent.id))
    .orderBy(asc(helpArticles.sortOrder), asc(helpArticles.id));
  return {
    items: rows.map((r) => ({
      id: r.id,
      owner_agent_id: r.ownerAgentId,
      category: r.category,
      title: r.title,
      title_en: r.titleEn,
      content: r.content,
      content_en: r.contentEn,
      translations_json: r.translationsJson,
      sort_order: r.sortOrder,
      is_active: r.isActive,
      created_at: r.createdAt,
    })),
  };
}

export async function createAgentHelpArticle(
  env: Env,
  ctx: ActiveAgentContext,
  body: {
    category?: string;
    title?: string;
    title_en?: string;
    content?: string;
    content_en?: string;
    sort_order?: number;
    is_active?: boolean;
  }
) {
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title || !content) throw Errors.validation('帮助文章标题与正文不能为空');
  const db = createDb(env.DB);
  const [ins] = await db
    .insert(helpArticles)
    .values({
      ownerAgentId: ctx.agent.id,
      category: String(body.category || '常见问题')
        .trim()
        .slice(0, 60),
      title: title.slice(0, 160),
      titleEn: String(body.title_en || '')
        .trim()
        .slice(0, 160),
      content,
      contentEn: String(body.content_en || '').trim(),
      sortOrder: Number(body.sort_order || 0),
      isActive: body.is_active === false ? 0 : 1,
    })
    .returning({ id: helpArticles.id });
  return { ok: true, id: ins.id };
}

export async function updateAgentHelpArticle(
  env: Env,
  ctx: ActiveAgentContext,
  id: number,
  body: {
    category?: string;
    title?: string;
    title_en?: string;
    content?: string;
    content_en?: string;
    sort_order?: number;
    is_active?: boolean;
  }
) {
  const patch: Partial<typeof helpArticles.$inferInsert> = {};
  if (body.category !== undefined) patch.category = body.category.trim().slice(0, 60);
  if (body.title !== undefined) patch.title = body.title.trim().slice(0, 160);
  if (body.title_en !== undefined) patch.titleEn = body.title_en.trim().slice(0, 160);
  if (body.content !== undefined) patch.content = body.content.trim();
  if (body.content_en !== undefined) patch.contentEn = body.content_en.trim();
  if (body.sort_order !== undefined) patch.sortOrder = Number(body.sort_order);
  if (body.is_active !== undefined) patch.isActive = body.is_active ? 1 : 0;

  const db = createDb(env.DB);
  const updated = await db
    .update(helpArticles)
    .set(patch)
    .where(and(eq(helpArticles.id, id), eq(helpArticles.ownerAgentId, ctx.agent.id)))
    .returning({ id: helpArticles.id });
  if (updated.length === 0) throw Errors.notFound('未找到该分站帮助文章');
  return { ok: true };
}

export async function deleteAgentHelpArticle(env: Env, ctx: ActiveAgentContext, id: number) {
  const db = createDb(env.DB);
  await db
    .delete(helpArticles)
    .where(and(eq(helpArticles.id, id), eq(helpArticles.ownerAgentId, ctx.agent.id)));
  return { ok: true };
}
