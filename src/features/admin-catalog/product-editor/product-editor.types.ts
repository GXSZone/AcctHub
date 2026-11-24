/**
 * 商品编辑器共享类型定义与多级代理防亏毛利实时测算工具
 */

import { type BundleItemDto, type ProductTierPricingRule, roundUpCurrency as roundUp2 } from '@shared/index';
import { fmt } from '../../../i18n';
import type { AdminProductEditorDict } from '../../../i18n/namespaces/admin-product-editor';
import type { ProductCustomField, ProductFaq, ProductSpec, WarrantyType } from '../../../types';

export interface EditableProduct {
  id: number | null;
  category_id: number;
  slug: string;
  title: string;
  title_en: string;
  subtitle: string;
  subtitle_en: string;
  icon_key: string;
  accent_color: string;
  delivery_type: string;
  tags: string[];
  base_price: number;
  original_price: number | null;
  cost_price: number | null;
  allow_below_cost?: boolean;
  stock_mode: string;
  manual_stock: number;
  seat_total: number;
  seat_used: number;
  summary_markdown: string;
  detail_markdown: string;
  risk_notice: string;
  warranty_type: WarrantyType;
  warranty_days: number;
  warranty_summary: string;
  faq: ProductFaq[];
  custom_fields: ProductCustomField[];
  specs: ProductSpec[];
  tier_pricing?: ProductTierPricingRule[];
  is_featured: number;
  is_active: number;
  sort_order: number;
  min_quantity?: number;
  max_quantity?: number;
  require_login?: boolean;
  is_hidden?: boolean | number;
  access_password?: string;
  flash_sale_price?: number | null;
  flash_sale_start_at?: string;
  flash_sale_end_at?: string;
  flash_sale_limit?: number;
  bundle_items?: BundleItemDto[];
  group_buy_enabled?: boolean | number;
  group_buy_size?: number;
  group_buy_price?: number | null;
  group_buy_hours?: number;
  allow_card_selection?: boolean | number;
  card_select_fee?: number;
  member_price?: number | null;
}

export interface ProductMarginIssue {
  label: string;
  sell: number;
  cost: number;
  agentPrice: number;
  loss: number;
  safeSell: number;
}

export interface ProductMarginCheck {
  baseAgentPrice: number;
  baseLoss: number;
  baseSafeRetail: number;
  issues: ProductMarginIssue[];
}

export function computeProductMarginCheck(
  draft: EditableProduct | null,
  lowestTier: { name: string; discount_rate: number },
  dict: AdminProductEditorDict
): ProductMarginCheck {
  if (!draft) {
    return { baseAgentPrice: 0, baseLoss: 0, baseSafeRetail: 0, issues: [] };
  }
  const d = Math.max(0.05, Number(lowestTier.discount_rate || 0.72));
  const issues: ProductMarginIssue[] = [];
  const baseCost = Number(draft.cost_price || 0);
  const baseAgentPrice = Number((Number(draft.base_price || 0) * d).toFixed(2));
  const baseLoss =
    baseCost > 0 && baseAgentPrice + 0.001 < baseCost ? Number((baseCost - baseAgentPrice).toFixed(2)) : 0;
  const baseSafeRetail = baseCost > 0 ? roundUp2(baseCost / d) : 0;

  if (baseLoss > 0) {
    issues.push({
      label: dict.peIssueBasePriceLabel,
      sell: Number(draft.base_price || 0),
      cost: baseCost,
      agentPrice: baseAgentPrice,
      loss: baseLoss,
      safeSell: baseSafeRetail,
    });
  }

  draft.specs.forEach((s, idx) => {
    const sc =
      s.cost_price !== undefined && s.cost_price !== null && Number(s.cost_price) > 0
        ? Number(s.cost_price)
        : idx === 0 && draft.specs.length === 1
          ? baseCost
          : 0;
    if (sc <= 0) return;
    const ap = Number((Number(s.price || 0) * d).toFixed(2));
    if (ap + 0.001 < sc) {
      issues.push({
        label: fmt(dict.peIssueSpecLabel, { name: s.name || s.id }),
        sell: Number(s.price || 0),
        cost: sc,
        agentPrice: ap,
        loss: Number((sc - ap).toFixed(2)),
        safeSell: roundUp2(sc / d),
      });
    }
  });

  return { baseAgentPrice, baseLoss, baseSafeRetail, issues };
}
