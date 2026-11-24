import {
  MAX_TOPUP_AMOUNT,
  parseCdkPurchaseConfig,
  parseMinTopupAmount,
  parsePaymentFeeRatePct,
} from '@shared/domain/payment-plugin-settings';
import type { RestockSubscribeInput, StorefrontProductsQuery, ValidateCouponInput } from '@shared/index';
import { type Env, getRegistrationWelcomeCredit, type TenantContext } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { isSiteMailAutoDeliveryReady } from '../../infra/mail';
import { loadAffiliateConfigRepo } from '../account/affiliate.repo';
import { isEmailBlacklisted } from '../auth/auth.repo';
import { listProductOpenGroupBuys } from '../commerce/group-buy.service';
import { listPublicOAuthProviders } from '../oauth/oauth.service';
import { loadCachedFxSnapshot } from '../payment/payment.fx';
import { listEnabledTenantPaymentMethods } from '../payment/tenant-payment.service';
import { sanitizePublicTenant } from '../tenant/tenant.service';
import { getTenantSettingsMapRepo } from '../tenant/tenant-settings.repo';
import { enrichProduct, preloadProductBatchMeta } from './storefront.enricher';
import {
  findActiveCouponByCode,
  findActiveProductByIdOrSlug,
  findCategoryIdBySlug,
  findCategorySummaryById,
  listActiveHelpArticlesRepo,
  listActiveProductsRepo,
  loadAgentHiddenProductIds,
  loadAgentProductOverrides,
  loadAvailableCardCountsBySpec,
  loadHealthyUpstreamStockMapsRepo,
  loadStorefrontBootstrapData,
  mapProductRowToSnake,
  upsertRestockSubscriptionRepo,
} from './storefront.repo';

function assertTenantActive(tenant: TenantContext): void {
  if (tenant.isSuspended) throw Errors.forbidden('当前代理分站已暂停营业');
}

const HIDDEN_PUBLIC_KEYS = new Set([
  'agent_signup_platform_fee_pct',
  'agent_withdrawal_fee_pct',
  'saas_cname_target',
  'neutral_base_domain',
]);
const HIDDEN_PUBLIC_PREFIXES = ['ai_', 'cf_saas_', 'notify_', 'downline_popup_', 'risk_', 'oauth_'];

/** 过滤面向公网前台的站点配置（严格剥离总控密钥与内部运维项） */
function filterPublicSettings(
  rows: Array<{ key: string; value: string }>,
  tenant: TenantContext
): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const r of rows) {
    if (HIDDEN_PUBLIC_KEYS.has(r.key) || HIDDEN_PUBLIC_PREFIXES.some((p) => r.key.startsWith(p))) continue;
    settings[r.key] = r.value;
  }

  // 分站白牌隔离：覆盖品牌、客服、公告条与欢迎弹窗配置
  if (tenant.isSubAgent) {
    if (tenant.brandName) settings.brand_name = tenant.brandName;
    if (tenant.brandTagline) {
      settings.brand_tagline = tenant.brandTagline;
      settings.brand_tagline_en = tenant.brandTagline;
    }
    if (tenant.supportLabel) settings.support_label = tenant.supportLabel;
    if (tenant.supportUrl) settings.support_url = tenant.supportUrl;
    if (tenant.supportNote) settings.support_note = tenant.supportNote;
    Object.assign(settings, {
      support_media_json: tenant.supportMediaJson || '[]',
      support_links_json: tenant.supportLinksJson || '[]',
      announcement_banner: tenant.announcementBanner || '',
      ticker_enabled: tenant.tickerEnabled === false ? 'false' : 'true',
      ticker_mode: tenant.tickerMode || 'vertical',
      ticker_include_notices: tenant.tickerIncludeNotices === false ? 'false' : 'true',
      popup_enabled: tenant.popupEnabled ? 'true' : 'false',
      popup_title: tenant.popupTitle || '',
      popup_content: tenant.popupContent || '',
      popup_frequency: tenant.popupFrequency || 'once_per_day',
      popup_version: `agent_${tenant.agentId}_${tenant.popupVersion || '1'}`,
    });
  }
  return settings;
}

/** 获取前台初始化数据（租户品牌、分类分组、商品计数、公告与启用支付通道） */
export async function getStorefrontBootstrap(env: Env, tenant: TenantContext) {
  assertTenantActive(tenant);
  const db = createDb(env.DB);
  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(ownerAgentId > 0 && tenant.capabilities?.allow_private_products);

  const [hiddenIdsSet, data, mailDeliveryEnabled, affCfg, tenantCustomSettings, oauthData, fxSnap] =
    await Promise.all([
      tenant.isSubAgent && tenant.agentId
        ? loadAgentHiddenProductIds(db, tenant.agentId)
        : Promise.resolve(new Set<number>()),
      loadStorefrontBootstrapData(db, ownerAgentId, includePrivate),
      isSiteMailAutoDeliveryReady(env, ownerAgentId),
      loadAffiliateConfigRepo(db, ownerAgentId),
      ownerAgentId > 0
        ? getTenantSettingsMapRepo(db, ownerAgentId, ['header_links_json'])
        : Promise.resolve(new Map<string, string>()),
      listPublicOAuthProviders(env, tenant),
      loadCachedFxSnapshot(env).catch(() => null),
    ]);

  const settings = filterPublicSettings(data.settingsRows, tenant);
  // 分站顶部自定义外链独立隔离，不继承主站配置
  if (ownerAgentId > 0) {
    settings.header_links_json = tenantCustomSettings.get('header_links_json') || '[]';
  }
  // 无论主站或分站，统一以当前站点自身的邀请推广策略覆盖 settings，严禁主站开关泄漏到分站前台
  settings.affiliate_enabled = affCfg.enabled ? '1' : '0';
  settings.affiliate_commission_rate = String(affCfg.commissionRate);
  settings.affiliate_min_order_amount = String(affCfg.minOrderAmount);
  settings.affiliate_max_reward = String(affCfg.maxReward);
  const visibleProducts = data.activeProductsRows.filter((p) => !hiddenIdsSet.has(Number(p.id)));
  const countMap = new Map<number, number>();
  let featuredCount = 0;
  for (const p of visibleProducts) {
    countMap.set(p.categoryId, (countMap.get(p.categoryId) ?? 0) + 1);
    if (p.isFeatured) featuredCount++;
  }

  const groupedCategories = data.groupsRows.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    name_en: g.nameEn,
    sort_order: g.sortOrder,
    is_collapsible: g.isCollapsible,
    is_active: g.isActive,
    created_at: g.createdAt,
    categories: data.categoriesRows
      .filter((cat) => Number(cat.groupId) === Number(g.id))
      .map((cat) => ({
        id: cat.id,
        group_id: cat.groupId,
        parent_id: cat.parentId,
        slug: cat.slug,
        name: cat.name,
        name_en: cat.nameEn,
        icon: cat.icon,
        badge_text: cat.badgeText,
        schema_type: cat.schemaType,
        config_json: cat.configJson,
        sort_order: cat.sortOrder,
        is_active: cat.isActive,
        created_at: cat.createdAt,
        product_count: countMap.get(Number(cat.id)) ?? 0,
      })),
  }));

  const mappedAnnouncements = data.announcementsRows.map((a) => ({
    id: a.id,
    owner_agent_id: a.ownerAgentId,
    audience: a.audience,
    title: a.title,
    title_en: a.titleEn,
    content: a.content,
    content_en: a.contentEn,
    translations_json: a.translationsJson,
    level: a.level,
    is_pinned: a.isPinned,
    is_active: a.isActive,
    created_at: a.createdAt,
  }));

  const tenantOwnPayments =
    ownerAgentId > 0 && tenant.capabilities?.allow_own_payment
      ? await listEnabledTenantPaymentMethods(db, ownerAgentId)
      : [];
  const platformPayments = data.paymentRows.map(({ configJson, ...m }) => ({
    ...m,
    fee_rate_pct: parsePaymentFeeRatePct(configJson),
  }));

  const cdkCfg = parseCdkPurchaseConfig(data.balanceConfigJson);
  const usdCny = Number(fxSnap?.usd_cny || 7.25);
  const safeUsdCny = Number.isFinite(usdCny) && usdCny > 1 ? usdCny : 7.25;
  return {
    tenant: sanitizePublicTenant(tenant),
    settings,
    groups: groupedCategories,
    counts: { featured: featuredCount, all: visibleProducts.length },
    announcements: mappedAnnouncements,
    payment_methods: platformPayments,
    tenant_payment_methods: tenantOwnPayments,
    recharge: {
      min_topup: parseMinTopupAmount(data.balanceConfigJson),
      max_topup: MAX_TOPUP_AMOUNT,
      cdk_purchase_url: cdkCfg.url,
      cdk_purchase_label: cdkCfg.label,
    },
    registration: { welcome_credit: getRegistrationWelcomeCredit(env) },
    mail_delivery_enabled: mailDeliveryEnabled,
    oauth_providers: oauthData.providers,
    fx_rates: {
      base: 'CNY' as const,
      updated_at: fxSnap?.updated_at || new Date().toISOString(),
      rates: {
        CNY: 1,
        USD: Number((1 / safeUsdCny).toFixed(4)),
        HKD: Number((7.8 / safeUsdCny).toFixed(4)),
        JPY: Number((154 / safeUsdCny).toFixed(2)),
        KRW: Number((1380 / safeUsdCny).toFixed(2)),
      },
    },
    security: {
      turnstile_enabled: Boolean((env.TURNSTILE_SECRET || '').trim()),
      turnstile_site_key: env.TURNSTILE_SITE_KEY || '',
    },
  };
}

/** 按分类/关键字/标签查询前台在售商品列表 */
export async function listStorefrontProducts(
  env: Env,
  tenant: TenantContext,
  query: StorefrontProductsQuery
) {
  assertTenantActive(tenant);
  const db = createDb(env.DB);
  const category = query.category || 'featured';
  const q = (query.q || '').trim().toLowerCase();
  const tag = (query.tag || '').trim();

  let categoryId: number | undefined;
  if (category !== 'featured' && category !== 'all') {
    const foundId = await findCategoryIdBySlug(db, category);
    if (foundId !== null) categoryId = foundId;
  }

  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(ownerAgentId > 0 && tenant.capabilities?.allow_private_products);
  const [rawRows, preloaded] = await Promise.all([
    listActiveProductsRepo(db, {
      featuredOnly: category === 'featured',
      categoryId,
      ownerAgentId,
      includePrivate,
    }),
    preloadProductBatchMeta(env, tenant),
  ]);

  const visibleRaw = rawRows.filter((row) => {
    const ov = preloaded.overridesByProduct.get(Number(row.id));
    return ov?.is_listed !== 0;
  });

  let items = await Promise.all(
    visibleRaw.map((row) =>
      enrichProduct(env, mapProductRowToSnake(row), tenant, preloaded.baseAgentDiscount, preloaded)
    )
  );

  if (q) {
    items = items.filter((item) => {
      const hay =
        `${item.title} ${item.title_en} ${item.subtitle} ${item.tags.join(' ')} ${item.slug}`.toLowerCase();
      return hay.includes(q);
    });
  }
  if (tag) {
    items = items.filter((item) => item.tags.includes(tag));
  }

  return { tenant: sanitizePublicTenant(tenant), items };
}

/** 获取单个商品详情与分规格实时库存（支持隐藏口令商品密码解锁保护与进行中拼团列表） */
export async function getStorefrontProductDetail(
  env: Env,
  tenant: TenantContext,
  idOrSlug: string,
  accessCode = ''
) {
  assertTenantActive(tenant);
  const db = createDb(env.DB);
  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(ownerAgentId > 0 && tenant.capabilities?.allow_private_products);
  const row = await findActiveProductByIdOrSlug(db, idOrSlug, ownerAgentId, includePrivate);
  if (!row) {
    throw Errors.notFound('商品不存在或已下架');
  }

  if (tenant.isSubAgent && tenant.agentId) {
    const overrides = await loadAgentProductOverrides(db, tenant.agentId, row.id);
    if (overrides[0] && overrides[0].is_listed === 0) {
      throw Errors.notFound('该商品在当前店铺已下架');
    }
  }

  const product = await enrichProduct(env, mapProductRowToSnake(row), tenant);
  const requiredPwd = (row.accessPassword || '').trim();
  const accessLocked = Boolean(requiredPwd) && accessCode.trim() !== requiredPwd;

  const [cat, localBySpec, upMaps, groupBuyData] = await Promise.all([
    findCategorySummaryById(db, product.category_id),
    product.stock_mode === 'cards' && product.bundle_items.length === 0
      ? loadAvailableCardCountsBySpec(db, product.id)
      : Promise.resolve(new Map<string, number>()),
    loadHealthyUpstreamStockMapsRepo(db, env),
    !accessLocked && product.group_buy.enabled
      ? listProductOpenGroupBuys(env, tenant, String(product.id))
      : Promise.resolve({ sessions: [] }),
  ]);

  const specStock: Record<string, number> = {};
  const specList = product.specs.length > 0 ? product.specs : [{ id: 'default' }];
  for (const s of specList) {
    if (product.bundle_items.length > 0) {
      specStock[s.id] = product.available_stock;
      continue;
    }
    const localCnt =
      product.stock_mode === 'cards'
        ? (localBySpec.get(s.id) ?? (specList.length <= 1 ? (localBySpec.get('default') ?? 0) : 0))
        : product.available_stock;
    const upCnt =
      upMaps.byProductSpec.get(`${product.id}:${s.id}`) ??
      upMaps.byProductSpec.get(`${product.id}:default`) ??
      upMaps.byProductSpec.get(`${product.id}:upstream_std`) ??
      0;
    if (upMaps.upstreamOnlyProducts.has(product.id)) {
      specStock[s.id] = upCnt;
    } else if (product.stock_mode === 'cards') {
      specStock[s.id] = localCnt + upCnt;
    } else if (upCnt > 0) {
      specStock[s.id] = Math.max(localCnt, upCnt);
    }
  }

  return {
    tenant: sanitizePublicTenant(tenant),
    access_locked: accessLocked,
    open_group_buys: groupBuyData.sessions,
    product: accessLocked
      ? {
          ...product,
          summary_markdown: '',
          detail_markdown: '',
          risk_notice: '',
          faq: [],
          custom_fields: [],
          bundle_items: [],
          category: cat,
          spec_stock: {},
        }
      : {
          ...product,
          category: cat,
          spec_stock: specStock,
        },
  };
}

/** 智能导购意图匹配推荐 */
export async function matchConciergeProducts(env: Env, tenant: TenantContext, prompt: string) {
  assertTenantActive(tenant);
  const db = createDb(env.DB);
  const lower = prompt.toLowerCase();

  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(ownerAgentId > 0 && tenant.capabilities?.allow_private_products);
  const [rawRows, preloaded] = await Promise.all([
    listActiveProductsRepo(db, { orderBySalesOnly: true, ownerAgentId, includePrivate }),
    preloadProductBatchMeta(env, tenant),
  ]);

  const visibleRaw = rawRows.filter((row) => {
    const ov = preloaded.overridesByProduct.get(Number(row.id));
    return ov?.is_listed !== 0;
  });

  const all = await Promise.all(
    visibleRaw.map((r) =>
      enrichProduct(env, mapProductRowToSnake(r), tenant, preloaded.baseAgentDiscount, preloaded)
    )
  );

  const scored = all.map((p) => {
    let score = 0;
    const text = `${p.title} ${p.subtitle} ${p.tags.join(' ')} ${p.slug}`.toLowerCase();
    const rules: Array<[RegExp, boolean, number]> = [
      [
        /代码|编程|开发|cursor|claude|code|ide/,
        text.includes('claude') || text.includes('cursor') || text.includes('api'),
        5,
      ],
      [
        /画图|设计|视频|midjourney|创意|veo|gemini/,
        text.includes('midjourney') || text.includes('gemini') || text.includes('设计'),
        5,
      ],
      [/api|中转|key|token|额度|算力/, text.includes('api') || p.delivery_type === 'api_key', 6],
      [/看剧|电影|流媒体|netflix|音乐|娱乐|4k/, text.includes('netflix') || text.includes('4k'), 6],
      [
        /团队|企业|公司|批量|代充/,
        text.includes('企业') || text.includes('team') || text.includes('批量'),
        5,
      ],
      [/便宜|省钱|拼车|车位|合租/, p.stock_mode === 'seats' || p.price <= 60, 4],
    ];
    for (const [re, hit, pts] of rules) if (re.test(lower) && hit) score += pts;
    for (const token of lower.split(/[\s,，+、]+/).filter((t) => t.length >= 2)) {
      if (text.includes(token)) score += 3;
    }
    return { p, score };
  });

  const matched = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.p);

  const recommended = matched.length > 0 ? matched : all.filter((p) => p.is_featured).slice(0, 3);
  const totalBundle = recommended.reduce((sum, item) => sum + item.price, 0);

  return {
    prompt,
    reasoning:
      matched.length > 0
        ? `已根据你的意图「${prompt}」从实时库存中精选 ${recommended.length} 项高匹配席位，覆盖即用性与风控稳定性，合计约 ¥${totalBundle.toFixed(1)}。`
        : `为你精选了当前最受欢迎的 ${recommended.length} 项主力席位，点击任一项即可进入详情页查看完整规格与风控指引。`,
    items: recommended,
  };
}

/** 查询当前站点启用中的帮助中心文档（分站按 inherit_platform_help 决定是否继承平台通用文章） */
export async function listHelpArticles(env: Env, tenant: TenantContext) {
  const db = createDb(env.DB);
  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const inheritPlatform = tenant.capabilities?.inherit_platform_help !== false;
  const articles = await listActiveHelpArticlesRepo(db, ownerAgentId, inheritPlatform);
  return { articles };
}

/** 结账页优惠券预校验与折后试算（严格按当前租户隔离） */
export async function validateCheckoutCoupon(env: Env, tenant: TenantContext, input: ValidateCouponInput) {
  const db = createDb(env.DB);
  const code = input.code.trim().toUpperCase();
  const subtotal = Number(input.subtotal || 0);
  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;

  const coupon = await findActiveCouponByCode(db, code, ownerAgentId);
  if (!coupon) throw Errors.notFound('优惠券不存在或已失效');
  if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
    throw Errors.validation('该优惠券已被领完');
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
    throw Errors.validation('该优惠券已过期');
  }
  if (subtotal > 0 && subtotal < coupon.minOrderAmount) {
    throw Errors.validation(`需满 ¥${coupon.minOrderAmount} 才可使用此优惠券`);
  }

  const discount =
    coupon.discountType === 'percent'
      ? Number(((subtotal * Math.min(90, Math.max(1, Number(coupon.discountValue || 0)))) / 100).toFixed(2))
      : Number(Math.min(subtotal, Math.max(0, Number(coupon.discountValue || 0))).toFixed(2));

  return {
    ok: true,
    coupon: {
      code: coupon.code,
      name: coupon.name,
      discount_type: coupon.discountType,
      discount_value: coupon.discountValue,
      min_order_amount: coupon.minOrderAmount,
    },
    discount_amount: discount,
    final_amount: Math.max(0.01, Number((subtotal - discount).toFixed(2))),
  };
}

/** 登记缺货商品到货提醒订阅 */
export async function subscribeRestockAlert(env: Env, tenant: TenantContext, input: RestockSubscribeInput) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, input.email)) {
    throw Errors.forbidden('该邮箱已被列入平台黑名单，无法登记到货提醒');
  }
  const siteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(siteAgentId > 0 && tenant.capabilities?.allow_private_products);
  const prod = await findActiveProductByIdOrSlug(db, String(input.product_id), siteAgentId, includePrivate);
  if (!prod) throw Errors.notFound('商品不存在');
  await upsertRestockSubscriptionRepo(db, {
    siteAgentId,
    productId: prod.id,
    specId: input.spec_id,
    email: input.email.toLowerCase(),
  });
  return { ok: true, message: `已为「${prod.title}」登记到货提醒，补货后将第一时间通知您！` };
}
