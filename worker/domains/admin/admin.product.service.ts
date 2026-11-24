import { upsertProductInputSchema } from '@shared/contracts/catalog.contract';
import { normalizeBundleItems } from '@shared/domain/commerce-modes';
import { discountDisplay } from '@shared/domain/money';
import {
  buildWarrantySummaryTemplate,
  normalizeTierPricingRules,
  normalizeWarrantyType,
} from '@shared/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { drainMailOutbox } from '../../infra/mail.outbox';
import { dispatchOpsNotification } from '../../infra/notify';
import { importInventoryCredentials } from '../catalog/inventory-credentials.repo';
import { findProductById } from '../payment/payment.order.repo';
import {
  createProductRepo,
  deleteProductCardRepo,
  deleteProductWithWarrantySnapshotRepo,
  listProductCardsRepo,
  updateProductRepo,
} from './admin.catalog.repo';
import { checkProductLossAgainstTiers } from './admin.margin';

const productLimitsSchema = upsertProductInputSchema.pick({
  tier_pricing: true,
  seat_total: true,
  seat_used: true,
});

function assertProductLimits(input: Record<string, unknown>) {
  if (input.delivery_type === 'api_key') {
    throw Errors.validation('API Key 商品暂不支持开通，请选择可实际交付的商品类型');
  }
  const result = productLimitsSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw Errors.validation(`${issue.path.join('.')}: ${issue.message}`);
  }
}

/** 创建商品（带最低代理折率防亏拦截） */
export async function createAdminProduct(
  env: Env,
  b: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  assertProductLimits(b);
  const slug = String(b.slug || `prod-${Date.now()}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  const basePrice = Number(b.base_price || 29.9);
  const costPrice =
    b.cost_price === null || b.cost_price === '' || b.cost_price === undefined
      ? null
      : Math.max(0, Number(b.cost_price));
  const specs = (
    Array.isArray(b.specs) && b.specs.length > 0
      ? b.specs
      : [{ id: 'default', name: '标准月卡', price: basePrice }]
  ) as ProductSpec[];

  if (!b.allow_below_cost) {
    const { lowestTier, losses } = await checkProductLossAgainstTiers(env, {
      title: String(b.title || '新商品'),
      base_price: basePrice,
      cost_price: costPrice,
      specs,
    });
    if (losses.length > 0 && lowestTier) {
      const top = losses[0];
      return {
        status: 400,
        body: {
          error: `防亏拦截：按最低代理等级「${lowestTier.name}（${discountDisplay(lowestTier.discount_rate).zhFold}折）」拿货价 ¥${top.min_agent_price} 低于成本价 ¥${top.cost_price}（每单亏 ¥${top.loss_amount}），建议售价不低于 ¥${top.min_safe_retail_price}`,
          code: 'BELOW_COST_MARGIN',
          loss_items: losses,
        },
      };
    }
  }

  const warrantyType = normalizeWarrantyType(b.warranty_type);
  const warrantyDays = Math.max(
    0,
    Math.floor(
      Number(b.warranty_days ?? (warrantyType === 'none' ? 0 : warrantyType === 'first_login' ? 24 : 30))
    )
  );
  const warrantySummary =
    String(b.warranty_summary || '').trim() || buildWarrantySummaryTemplate(warrantyType, warrantyDays);

  const id = await createProductRepo(createDb(env.DB), {
    categoryId: Number(b.category_id),
    slug,
    title: String(b.title || '新商品'),
    titleEn: String(b.title_en || b.title || 'New Item'),
    subtitle: String(b.subtitle || ''),
    iconKey: String(b.icon_key || 'sparkles'),
    accentColor: String(b.accent_color || '#D97757'),
    deliveryType: String(b.delivery_type || 'auto'),
    tagsJson: JSON.stringify(Array.isArray(b.tags) ? b.tags : ['自动发货']),
    basePrice,
    originalPrice: b.original_price ? Number(b.original_price) : null,
    costPrice,
    wholesaleDiscount: Number(b.wholesale_discount || 0.82),
    stockMode: String(b.stock_mode || 'cards'),
    manualStock: Number(b.manual_stock ?? 50),
    seatTotal: Number(b.seat_total || 0),
    seatUsed: Number(b.seat_used || 0),
    summaryMarkdown: String(b.summary_markdown || ''),
    detailMarkdown: String(
      b.detail_markdown || '### 商品说明\n付款后自动发卡，质保期内异常随时联系客服处理。'
    ),
    riskNotice: String(b.risk_notice || ''),
    warrantyType,
    warrantyDays,
    warrantySummary,
    specsJson: JSON.stringify(specs),
    tierPricingJson: JSON.stringify(normalizeTierPricingRules(b.tier_pricing)),
    isFeatured: b.is_featured ? 1 : 0,
    isActive: (b.is_active ?? true) ? 1 : 0,
    sortOrder: Number(b.sort_order || 10),
    minQuantity: Math.max(1, Math.min(999, Math.floor(Number(b.min_quantity || 1)))),
    maxQuantity: Math.max(0, Math.min(999, Math.floor(Number(b.max_quantity || 0)))),
    requireLogin: b.require_login ? 1 : 0,
    isHidden: b.is_hidden ? 1 : 0,
    accessPassword: String(b.access_password || '')
      .trim()
      .slice(0, 64),
    flashSalePrice:
      b.flash_sale_price === null || b.flash_sale_price === '' || b.flash_sale_price === undefined
        ? null
        : Math.max(0.01, Number(b.flash_sale_price)),
    flashSaleStartAt: String(b.flash_sale_start_at || '').trim(),
    flashSaleEndAt: String(b.flash_sale_end_at || '').trim(),
    flashSaleLimit: Math.max(0, Math.floor(Number(b.flash_sale_limit || 0))),
    bundleItemsJson: JSON.stringify(normalizeBundleItems(b.bundle_items)),
    groupBuyEnabled: b.group_buy_enabled ? 1 : 0,
    groupBuySize: Math.max(2, Math.min(20, Math.floor(Number(b.group_buy_size || 2)))),
    groupBuyPrice:
      b.group_buy_price === null || b.group_buy_price === '' || b.group_buy_price === undefined
        ? null
        : Math.max(0.01, Number(b.group_buy_price)),
    groupBuyHours: Math.max(1, Math.min(168, Math.floor(Number(b.group_buy_hours || 24)))),
    allowCardSelection: b.allow_card_selection ? 1 : 0,
    cardSelectFee: Math.max(0, Number(b.card_select_fee || 0)),
    memberPrice:
      b.member_price === null || b.member_price === '' || b.member_price === undefined
        ? null
        : Math.max(0.01, Number(b.member_price)),
  });
  return { status: 200, body: { id, ok: true } };
}

/** 更新商品（带防亏拦截） */
export async function updateAdminProduct(
  env: Env,
  id: number,
  b: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  assertProductLimits(b);
  const db = createDb(env.DB);
  const shouldCheckMargin =
    !b.allow_below_cost &&
    (b.base_price !== undefined || b.cost_price !== undefined || Array.isArray(b.specs));
  if (shouldCheckMargin) {
    const existing = await findProductById(db, id);
    if (existing) {
      const nextTitle = b.title !== undefined ? String(b.title) : existing.title;
      const nextBase = b.base_price !== undefined ? Number(b.base_price) : Number(existing.basePrice);
      const nextCost =
        b.cost_price !== undefined
          ? b.cost_price === null || b.cost_price === ''
            ? null
            : Math.max(0, Number(b.cost_price))
          : (existing.costPrice ?? existing.upstreamCost);
      const nextSpecs = Array.isArray(b.specs)
        ? (b.specs as ProductSpec[])
        : safeJsonParse<ProductSpec[]>(existing.specsJson || '[]', []);

      const { lowestTier, losses } = await checkProductLossAgainstTiers(env, {
        title: nextTitle,
        base_price: nextBase,
        cost_price: nextCost,
        specs: nextSpecs,
      });
      if (losses.length > 0 && lowestTier) {
        const top = losses[0];
        return {
          status: 400,
          body: {
            error: `防亏拦截：「${top.spec_name}」在最低代理等级「${lowestTier.name}（${discountDisplay(lowestTier.discount_rate).zhFold}折）」下拿货价 ¥${top.min_agent_price} 低于成本价 ¥${top.cost_price}（每单亏 ¥${top.loss_amount}），建议售价不低于 ¥${top.min_safe_retail_price}`,
            code: 'BELOW_COST_MARGIN',
            loss_items: losses,
          },
        };
      }
    }
  }

  const patch: Record<string, unknown> = {};
  if (b.category_id !== undefined) patch.categoryId = Number(b.category_id);
  if (b.title !== undefined) patch.title = String(b.title);
  if (b.title_en !== undefined) patch.titleEn = String(b.title_en);
  if (b.subtitle !== undefined) patch.subtitle = String(b.subtitle);
  if (b.subtitle_en !== undefined) patch.subtitleEn = String(b.subtitle_en);
  if (b.icon_key !== undefined) patch.iconKey = String(b.icon_key);
  if (b.accent_color !== undefined) patch.accentColor = String(b.accent_color);
  if (b.base_price !== undefined) patch.basePrice = Number(b.base_price);
  if (b.original_price !== undefined) {
    patch.originalPrice =
      b.original_price === null || b.original_price === '' ? null : Number(b.original_price);
  }
  if (b.cost_price !== undefined) {
    patch.costPrice = b.cost_price === null || b.cost_price === '' ? null : Math.max(0, Number(b.cost_price));
  }
  if (b.wholesale_discount !== undefined) patch.wholesaleDiscount = Number(b.wholesale_discount);
  if (b.delivery_type !== undefined) patch.deliveryType = String(b.delivery_type);
  if (b.stock_mode !== undefined) patch.stockMode = String(b.stock_mode);
  if (b.manual_stock !== undefined) patch.manualStock = Number(b.manual_stock);
  if (b.seat_total !== undefined) patch.seatTotal = Number(b.seat_total);
  if (b.seat_used !== undefined) patch.seatUsed = Number(b.seat_used);
  if (Array.isArray(b.tags)) patch.tagsJson = JSON.stringify(b.tags);
  if (b.summary_markdown !== undefined) patch.summaryMarkdown = String(b.summary_markdown);
  if (b.detail_markdown !== undefined) patch.detailMarkdown = String(b.detail_markdown);
  if (b.risk_notice !== undefined) patch.riskNotice = String(b.risk_notice);
  if (b.warranty_type !== undefined) patch.warrantyType = normalizeWarrantyType(b.warranty_type);
  if (b.warranty_days !== undefined)
    patch.warrantyDays = Math.max(0, Math.floor(Number(b.warranty_days) || 0));
  if (b.warranty_summary !== undefined) patch.warrantySummary = String(b.warranty_summary).trim();
  if (Array.isArray(b.faq)) patch.faqJson = JSON.stringify(b.faq);
  if (Array.isArray(b.custom_fields)) patch.customFieldsJson = JSON.stringify(b.custom_fields);
  if (Array.isArray(b.specs)) patch.specsJson = JSON.stringify(b.specs);
  if (b.tier_pricing !== undefined) {
    patch.tierPricingJson = JSON.stringify(normalizeTierPricingRules(b.tier_pricing));
  }
  if (b.is_featured !== undefined) patch.isFeatured = b.is_featured ? 1 : 0;
  if (b.is_active !== undefined) patch.isActive = b.is_active ? 1 : 0;
  if (b.sort_order !== undefined) patch.sortOrder = Number(b.sort_order);
  if (b.min_quantity !== undefined) {
    patch.minQuantity = Math.max(1, Math.min(999, Math.floor(Number(b.min_quantity) || 1)));
  }
  if (b.max_quantity !== undefined) {
    patch.maxQuantity = Math.max(0, Math.min(999, Math.floor(Number(b.max_quantity) || 0)));
  }
  if (b.require_login !== undefined) patch.requireLogin = b.require_login ? 1 : 0;
  if (b.is_hidden !== undefined) patch.isHidden = b.is_hidden ? 1 : 0;
  if (b.access_password !== undefined)
    patch.accessPassword = String(b.access_password || '')
      .trim()
      .slice(0, 64);
  if (b.flash_sale_price !== undefined) {
    patch.flashSalePrice =
      b.flash_sale_price === null || b.flash_sale_price === ''
        ? null
        : Math.max(0.01, Number(b.flash_sale_price));
  }
  if (b.flash_sale_start_at !== undefined)
    patch.flashSaleStartAt = String(b.flash_sale_start_at || '').trim();
  if (b.flash_sale_end_at !== undefined) patch.flashSaleEndAt = String(b.flash_sale_end_at || '').trim();
  if (b.flash_sale_limit !== undefined) {
    patch.flashSaleLimit = Math.max(0, Math.floor(Number(b.flash_sale_limit || 0)));
  }
  if (b.bundle_items !== undefined) {
    patch.bundleItemsJson = JSON.stringify(normalizeBundleItems(b.bundle_items));
  }
  if (b.group_buy_enabled !== undefined) patch.groupBuyEnabled = b.group_buy_enabled ? 1 : 0;
  if (b.group_buy_size !== undefined) {
    patch.groupBuySize = Math.max(2, Math.min(20, Math.floor(Number(b.group_buy_size || 2))));
  }
  if (b.group_buy_price !== undefined) {
    patch.groupBuyPrice =
      b.group_buy_price === null || b.group_buy_price === ''
        ? null
        : Math.max(0.01, Number(b.group_buy_price));
  }
  if (b.group_buy_hours !== undefined) {
    patch.groupBuyHours = Math.max(1, Math.min(168, Math.floor(Number(b.group_buy_hours || 24))));
  }
  if (b.allow_card_selection !== undefined) {
    patch.allowCardSelection = b.allow_card_selection ? 1 : 0;
  }
  if (b.card_select_fee !== undefined) {
    patch.cardSelectFee = Math.max(0, Number(b.card_select_fee || 0));
  }
  if (b.member_price !== undefined) {
    patch.memberPrice =
      b.member_price === null || b.member_price === '' ? null : Math.max(0.01, Number(b.member_price));
  }

  await updateProductRepo(db, id, patch);
  return { status: 200, body: { ok: true } };
}

/** 删除商品并先固化关联历史订单的质保快照 */
export async function deleteAdminProduct(env: Env, id: number) {
  const db = createDb(env.DB);
  const prod = await findProductById(db, id);
  const snapshot = prod
    ? (() => {
        const wType = normalizeWarrantyType(prod.warrantyType);
        const wDays = Math.max(0, Math.floor(Number(prod.warrantyDays ?? (wType === 'none' ? 0 : 30))));
        const wSummary = (prod.warrantySummary || '').trim() || buildWarrantySummaryTemplate(wType, wDays);
        return { type: wType, days: wDays, summary: wSummary };
      })()
    : undefined;
  await deleteProductWithWarrantySnapshotRepo(db, id, snapshot);
  return { ok: true };
}

export async function listAdminProductCards(env: Env, productId: number) {
  const cards = await listProductCardsRepo(createDb(env.DB), productId);
  return {
    cards: await Promise.all(
      cards.map(async (card) => ({
        ...card,
        card_content: await readStoredCredential(env, card.card_content, INVENTORY_CREDENTIAL_SCOPE),
      }))
    ),
  };
}

export async function deleteAdminProductCard(env: Env, cardId: number) {
  await deleteProductCardRepo(createDb(env.DB), cardId);
  return { ok: true };
}

/** 批量导入商品卡密并按订阅者所属站点隔离触发补货到货通知邮件 */
export async function importAdminProductCards(
  env: Env,
  productId: number,
  body: {
    spec_id?: string;
    lines?: string;
    is_loop?: boolean;
    dedupe?: boolean;
    default_select_fee?: number;
  },
  scheduleBackground?: (job: Promise<unknown>) => void
) {
  const specId = (body.spec_id || 'default').trim();
  const lines = (body.lines || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const importResult = await importInventoryCredentials(env, productId, specId, lines, {
    isLoop: Boolean(body.is_loop),
    dedupe: body.dedupe !== false,
    defaultSelectFee: Number(body.default_select_fee || 0),
  });
  const { imported } = importResult;

  if (imported > 0) {
    const prod = await findProductById(createDb(env.DB), productId);
    const prodTitle = prod?.title || `#${productId}`;
    void dispatchOpsNotification(env, 'restock', '商品库存已补充', [
      `商品：${prodTitle}（规格：${specId}）`,
      `本次入库卡密：${imported} 张`,
    ]);
    const job = drainMailOutbox(env).catch(() => undefined);
    if (scheduleBackground) scheduleBackground(job);
    else await job;
  }

  return { ...importResult, ok: true };
}
