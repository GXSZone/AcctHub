import { sanitizeHeaderLinksJson } from '@shared/domain/header-links';
import { normalizeTierPricingRules } from '@shared/index';
import { type Env, isDevOrTestEnv, isSandboxEnabled } from '../../env';
import { getCloudflareSaasConfig } from '../../infra/cloudflare-saas';
import { maskSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { getSiteMailConfigSafe, listSiteMailLogs } from '../../infra/mail';
import { getOpsNotifyConfig } from '../../infra/notify';
import { bumpEdgeCacheVersion } from '../../infra/security';
import { sanitizeHexColor, sanitizeSafeMediaUrl } from '../../infra/seo';
import {
  appendDownlinePopupHistoryRepo,
  MAIN_DOWNLINE_POPUP_HISTORY_KEY,
  removeDownlinePopupHistoryRepo,
} from '../agent/downline-popup-history.repo';
import { attachOrderInfoToTickets } from '../orders/order-snapshot.repo';
import { loadCachedFxSnapshot } from '../payment/payment.fx';
import { ensureExtendedPaymentPluginsRepo } from '../payment/payment.repo';
import { upsertTenantSettingsRepo } from '../tenant/tenant-settings.repo';

export { getAdminSaasPolicy, updateAdminSaasPolicy, updateSaasConfig } from './admin.saas.service';

import {
  countCategoriesInGroupRepo,
  countProductsInCategoryRepo,
  createCategoryGroupRepo,
  createCategoryRepo,
  deleteCategoryGroupRepo,
  deleteCategoryRepo,
  reorderCategoriesRepo,
  reorderCategoryGroupsRepo,
  updateCategoryGroupRepo,
  updateCategoryRepo,
  upsertSiteSettingRepo,
} from './admin.catalog.repo';
import { loadAdminOverviewRaw } from './admin.overview.repo';

/** 总控后台全量初始化概览数据（严格屏蔽 AI/SaaS/通知敏感密钥，仅返掩码） */
export async function getAdminOverview(env: Env) {
  const db = createDb(env.DB);
  await ensureExtendedPaymentPluginsRepo(db).catch(() => undefined);
  const [raw, saasCfg, notifyCfg, mailCfg, mailLogs, fxSnapshot] = await Promise.all([
    loadAdminOverviewRaw(db),
    getCloudflareSaasConfig(env),
    getOpsNotifyConfig(env),
    getSiteMailConfigSafe(env, 0),
    listSiteMailLogs(env, 0, 25),
    loadCachedFxSnapshot(env),
  ]);

  const settingsObj: Record<string, string> = {};
  for (const r of raw.settingsRows) {
    if (r.key.startsWith('ai_') || r.key === 'cf_saas_api_token' || r.key.startsWith('notify_')) continue;
    settingsObj[r.key] = r.value;
  }

  const enrichedTickets = await attachOrderInfoToTickets(env, raw.tickets, false, true);

  // 安全合规巡检提醒（配置驱动降级可视化提醒，不泄露任何明文密钥）
  const securityWarnings: Array<{ level: 'warning' | 'danger'; code: string; message: string }> = [];
  const isStrictEnv = !isDevOrTestEnv(env);
  if (!String(env.TURNSTILE_SECRET || '').trim()) {
    securityWarnings.push({
      level: isStrictEnv ? 'danger' : 'warning',
      code: 'TURNSTILE_NOT_CONFIGURED',
      message: isStrictEnv
        ? '当前预发/生产环境尚未配置 TURNSTILE_SECRET / TURNSTILE_SITE_KEY，注册、登录、游客下单与 CDK 兑换暂未启用人机验证。'
        : '当前未配置 Cloudflare Turnstile 密钥（非生产模式已自动放行），上线前建议绑定 TURNSTILE_SECRET。',
    });
  }
  if (isStrictEnv && isSandboxEnabled(env)) {
    securityWarnings.push({
      level: 'danger',
      code: 'SANDBOX_ENABLED_IN_PROD',
      message: '当前预发/生产环境仍显式开启了 SANDBOX_MODE=true，请立即关闭以防恶意白嫖沙盒加款与测试下单。',
    });
  }

  return {
    stats: {
      total_orders: raw.stats.totalOrders,
      total_gmv: Number(raw.stats.totalGmv.toFixed(2)),
      product_gmv: Number(raw.stats.productGmv.toFixed(2)),
      agent_upgrade_total: Number(raw.stats.agentUpgradeTotal.toFixed(2)),
      total_products: raw.products.length,
      total_agents: raw.agents.length,
      upstream_exceptions: raw.stats.upstreamExceptions,
    },
    security_warnings: securityWarnings,
    settings: settingsObj,
    saas_config: {
      neutral_base_domain: saasCfg.neutralBaseDomain,
      saas_cname_target: saasCfg.cnameTarget,
      cf_saas_zone_id: saasCfg.zoneId,
      cf_saas_has_token: Boolean(saasCfg.apiToken),
      cf_saas_token_masked: maskSecret(saasCfg.apiToken),
      agent_signup_platform_fee_pct: Number(settingsObj.agent_signup_platform_fee_pct || 0),
      agent_withdrawal_fee_pct: Number(settingsObj.agent_withdrawal_fee_pct || 0),
    },
    notify_config: {
      tg_has_token: Boolean(notifyCfg.tgBotToken),
      tg_token_masked: maskSecret(notifyCfg.tgBotToken),
      tg_chat_id: notifyCfg.tgChatId,
      webhook_url: notifyCfg.webhookUrl,
      events: notifyCfg.events,
      low_stock_threshold: notifyCfg.lowStockThreshold,
    },
    mail_config: mailCfg,
    mail_logs: mailLogs,
    groups: raw.groups,
    categories: raw.categories,
    products: raw.products.map((p) => {
      const rec = p as Record<string, unknown>;
      const pid = Number(rec.id);
      return {
        ...rec,
        available_cards: raw.cardMap.get(pid) ?? 0,
        upstream_binding_count: raw.bindingMap.get(pid)?.cnt ?? 0,
        upstream_cached_stock: raw.bindingMap.get(pid)?.up_stock ?? 0,
        restock_waiting: raw.restockMap.get(pid) ?? 0,
        tags: safeJsonParse(String(rec.tags_json || '[]'), []),
        specs: safeJsonParse(String(rec.specs_json || '[]'), []),
        faq: safeJsonParse(String(rec.faq_json || '[]'), []),
        custom_fields: safeJsonParse(String(rec.custom_fields_json || '[]'), []),
        tier_pricing: normalizeTierPricingRules(rec.tier_pricing_json),
        bundle_items: safeJsonParse(String(rec.bundle_items_json || '[]'), []),
      };
    }),
    orders: raw.orders,
    agents: raw.agents,
    withdrawals: raw.withdrawals,
    coupons: raw.coupons,
    cdks: raw.cdks,
    tickets: enrichedTickets,
    agent_tiers: raw.agentTiers.map((t) => ({
      ...t,
      perks: safeJsonParse<string[]>(t.perks_json || '[]', []),
    })),
    announcements: raw.announcements,
    help_articles: raw.helpArticles,
    payment_plugins: raw.paymentPlugins,
    fx_snapshot: fxSnapshot,
  };
}

/** 更新主站运营基础设置（拒绝覆盖敏感前缀键，并在推送直属下级弹窗时记录历史） */
export async function updateSiteSettings(env: Env, body: Record<string, string>) {
  const db = createDb(env.DB);
  let prevPopupVersion = '';
  if (body.downline_popup_version !== undefined) {
    const existing = await getAdminOverviewPrevPopupVersion(db);
    prevPopupVersion = existing;
  }
  for (const [key, value] of Object.entries(body)) {
    if (
      key.startsWith('ai_') ||
      key.startsWith('cf_saas_') ||
      key.startsWith('notify_') ||
      key.startsWith('risk_') ||
      key.startsWith('oauth_') ||
      key === MAIN_DOWNLINE_POPUP_HISTORY_KEY
    ) {
      continue;
    }
    let nextValue = String(value);
    if (key === 'theme_accent') {
      const trimmed = nextValue.trim();
      if (trimmed !== '') {
        const cleanHex = sanitizeHexColor(trimmed);
        if (!cleanHex) {
          throw Errors.validation('主题色格式无效，请使用如 #2D6A57 的 6 位十六进制颜色代码');
        }
        nextValue = cleanHex;
      } else {
        nextValue = '';
      }
    } else if (key === 'brand_logo_url') {
      nextValue = sanitizeSafeMediaUrl(nextValue);
    } else if (key === 'header_links_json') {
      nextValue = sanitizeHeaderLinksJson(nextValue);
    }
    await upsertSiteSettingRepo(db, key, nextValue);
    if (key.startsWith('affiliate_')) {
      await upsertTenantSettingsRepo(db, 0, [[key, nextValue]]);
    }
  }
  if (
    body.downline_popup_version &&
    body.downline_popup_version !== prevPopupVersion &&
    (body.downline_popup_enabled === 'true' || body.downline_popup_title || body.downline_popup_content)
  ) {
    await appendDownlinePopupHistoryRepo(db, MAIN_DOWNLINE_POPUP_HISTORY_KEY, {
      version: String(body.downline_popup_version),
      enabled: body.downline_popup_enabled === 'true',
      frequency: String(body.downline_popup_frequency || 'once_per_day'),
      title: String(body.downline_popup_title || '').trim(),
      content: String(body.downline_popup_content || ''),
    });
  }
  bumpEdgeCacheVersion();
  return { ok: true };
}

async function getAdminOverviewPrevPopupVersion(db: ReturnType<typeof createDb>): Promise<string> {
  const { siteSettings } = await import('../../db/schema/core');
  const { eq } = await import('drizzle-orm');
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'downline_popup_version'))
    .limit(1);
  return row?.value || '';
}

export async function deleteAdminDownlinePopupHistory(env: Env, historyId: string) {
  const db = createDb(env.DB);
  const items = await removeDownlinePopupHistoryRepo(db, MAIN_DOWNLINE_POPUP_HISTORY_KEY, historyId);
  return { ok: true, items };
}

export async function createCategoryGroup(
  env: Env,
  body: { slug: string; name: string; name_en?: string; sort_order?: number }
) {
  const slug =
    body.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '') || `group-${Date.now()}`;
  const id = await createCategoryGroupRepo(createDb(env.DB), {
    slug,
    name: body.name.trim(),
    nameEn: (body.name_en || body.name).trim(),
    sortOrder: Number(body.sort_order ?? 10),
  });
  return { id, ok: true };
}

export async function reorderCategoryGroups(env: Env, orderedIds: number[]) {
  const ids = orderedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  await reorderCategoryGroupsRepo(createDb(env.DB), ids);
  return { ok: true, count: ids.length };
}

export async function updateCategoryGroup(
  env: Env,
  id: number,
  body: { name?: string; name_en?: string; sort_order?: number; is_active?: number }
) {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.name_en !== undefined) patch.nameEn = body.name_en;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.is_active !== undefined) patch.isActive = body.is_active;
  await updateCategoryGroupRepo(createDb(env.DB), id, patch);
  return { ok: true };
}

export async function deleteCategoryGroup(env: Env, id: number) {
  const db = createDb(env.DB);
  const childCount = await countCategoriesInGroupRepo(db, id);
  if (childCount > 0) {
    throw Errors.validation(`该一级大类下仍有关联的 ${childCount} 个二级分类，请先迁移或删除子分类后再操作`);
  }
  await deleteCategoryGroupRepo(db, id);
  return { ok: true };
}

export async function createCategory(
  env: Env,
  body: {
    group_id: number;
    slug?: string;
    name: string;
    name_en?: string;
    icon?: string;
    badge_text?: string;
    schema_type?: string;
    sort_order?: number;
  }
) {
  const slug = (body.slug || `cat-${Date.now()}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const id = await createCategoryRepo(createDb(env.DB), {
    groupId: Number(body.group_id),
    slug,
    name: body.name.trim(),
    nameEn: (body.name_en || body.name).trim(),
    icon: body.icon || 'puzzle',
    badgeText: body.badge_text || '',
    schemaType: body.schema_type || 'custom_extension',
    sortOrder: Number(body.sort_order ?? 10),
  });
  return { id, ok: true };
}

export async function reorderCategories(env: Env, orderedIds: number[]) {
  const ids = orderedIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  await reorderCategoriesRepo(createDb(env.DB), ids);
  return { ok: true, count: ids.length };
}

export async function updateCategory(
  env: Env,
  id: number,
  body: {
    group_id?: number;
    name?: string;
    name_en?: string;
    icon?: string;
    badge_text?: string;
    sort_order?: number;
    is_active?: number;
  }
) {
  const patch: Record<string, unknown> = {};
  if (body.group_id !== undefined) patch.groupId = body.group_id;
  if (body.name !== undefined) patch.name = body.name;
  if (body.name_en !== undefined) patch.nameEn = body.name_en;
  if (body.icon !== undefined) patch.icon = body.icon;
  if (body.badge_text !== undefined) patch.badgeText = body.badge_text;
  if (body.sort_order !== undefined) patch.sortOrder = body.sort_order;
  if (body.is_active !== undefined) patch.isActive = body.is_active;
  await updateCategoryRepo(createDb(env.DB), id, patch);
  return { ok: true };
}

export async function deleteCategory(env: Env, id: number) {
  const db = createDb(env.DB);
  const prodCount = await countProductsInCategoryRepo(db, id);
  if (prodCount > 0) {
    throw Errors.validation(`该分类下仍有关联的 ${prodCount} 件商品，请先迁移或删除商品后再删除分类`);
  }
  await deleteCategoryRepo(db, id);
  return { ok: true };
}
