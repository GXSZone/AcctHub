import { roundCurrency } from './money';

export interface BundleItemRule {
  product_id: number;
  spec_id: string;
  quantity: number;
  title?: string;
}

export type FlashSaleStatus = 'none' | 'upcoming' | 'active' | 'sold_out' | 'ended';

export interface FlashSaleSnapshot {
  enabled: boolean;
  status: FlashSaleStatus;
  price: number | null;
  start_at: string;
  end_at: string;
  limit: number;
  sold: number;
  remaining: number | null;
}

export interface GroupBuyConfigSnapshot {
  enabled: boolean;
  size: number;
  price: number | null;
  hours: number;
}

/** 清洗并归一化组合套餐子商品列表 */
export function normalizeBundleItems(raw: unknown): BundleItemRule[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const dedup = new Map<string, BundleItemRule>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const pid = Math.floor(Number(rec.product_id || 0));
    const specId = String(rec.spec_id || 'default').trim() || 'default';
    const qty = Math.max(1, Math.min(20, Math.floor(Number(rec.quantity || 1))));
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const key = `${pid}:${specId}`;
    const existing = dedup.get(key);
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + qty);
    } else {
      dedup.set(key, {
        product_id: pid,
        spec_id: specId,
        quantity: qty,
        ...(typeof rec.title === 'string' && rec.title.trim() ? { title: rec.title.trim() } : {}),
      });
    }
    if (dedup.size >= 10) break;
  }
  return Array.from(dedup.values());
}

/** 评估商品当前限时秒杀状态与剩余名额 */
export function evaluateFlashSale(
  input: {
    flashSalePrice?: number | null;
    flashSaleStartAt?: string | null;
    flashSaleEndAt?: string | null;
    flashSaleLimit?: number | null;
    flashSaleSold?: number | null;
  },
  nowMs = Date.now()
): FlashSaleSnapshot {
  const price =
    input.flashSalePrice !== null &&
    input.flashSalePrice !== undefined &&
    Number.isFinite(Number(input.flashSalePrice)) &&
    Number(input.flashSalePrice) > 0
      ? roundCurrency(Number(input.flashSalePrice))
      : null;
  const startAt = String(input.flashSaleStartAt || '').trim();
  const endAt = String(input.flashSaleEndAt || '').trim();
  const limit = Math.max(0, Math.floor(Number(input.flashSaleLimit || 0)));
  const sold = Math.max(0, Math.floor(Number(input.flashSaleSold || 0)));
  const remaining = limit > 0 ? Math.max(0, limit - sold) : null;

  if (!price || !endAt) {
    return { enabled: false, status: 'none', price: null, start_at: '', end_at: '', limit, sold, remaining };
  }

  const startMs = startAt ? Date.parse(startAt) : 0;
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(endMs)) {
    return { enabled: false, status: 'none', price: null, start_at: '', end_at: '', limit, sold, remaining };
  }

  let status: FlashSaleStatus = 'active';
  if (Number.isFinite(startMs) && startMs > 0 && nowMs < startMs) {
    status = 'upcoming';
  } else if (nowMs >= endMs) {
    status = 'ended';
  } else if (limit > 0 && sold >= limit) {
    status = 'sold_out';
  }

  return {
    enabled: status === 'upcoming' || status === 'active' || status === 'sold_out',
    status,
    price,
    start_at: startAt,
    end_at: endAt,
    limit,
    sold,
    remaining,
  };
}

/** 计算指定规格在秒杀价下的折算单价（单规格直用秒杀价，多规格按基础价比例缩放且不高于原价） */
export function resolveFlashSaleSpecUnitPrice(params: {
  baseProductPrice: number;
  specRetailPrice: number;
  flashSalePrice: number;
  specsCount: number;
}): number {
  const { baseProductPrice, specRetailPrice, flashSalePrice, specsCount } = params;
  if (specsCount <= 1 || baseProductPrice <= 0) {
    return roundCurrency(Math.min(specRetailPrice, Math.max(0.01, flashSalePrice)));
  }
  const ratio = Math.min(1, Math.max(0.05, flashSalePrice / baseProductPrice));
  return roundCurrency(Math.min(specRetailPrice, Math.max(0.01, specRetailPrice * ratio)));
}

/** 评估已交付订阅订单是否即将到期或已过期（供续费提醒与一键复购共用） */
export function evaluateSubscriptionRenewalHint(
  deliveredAt: string | null | undefined,
  warrantyType: string | null | undefined,
  warrantyDays: number | null | undefined,
  nowMs = Date.now()
): {
  eligible: boolean;
  expiresAt: string | null;
  remainingDays: number | null;
  state: 'none' | 'active' | 'expiring_soon' | 'expired';
} {
  const days = Math.max(0, Math.floor(Number(warrantyDays || 0)));
  if (!deliveredAt || days <= 0 || warrantyType === 'none' || warrantyType === 'first_login') {
    return { eligible: false, expiresAt: null, remainingDays: null, state: 'none' };
  }
  const normalized = deliveredAt.includes('T') ? deliveredAt : `${deliveredAt.replace(' ', 'T')}Z`;
  const startMs = Date.parse(normalized);
  if (!Number.isFinite(startMs)) {
    return { eligible: false, expiresAt: null, remainingDays: null, state: 'none' };
  }
  const expiresMs = startMs + days * 86_400_000;
  const diffDays = Math.ceil((expiresMs - nowMs) / 86_400_000);
  const state = diffDays <= 0 ? 'expired' : diffDays <= 7 ? 'expiring_soon' : 'active';
  return {
    eligible: true,
    expiresAt: new Date(expiresMs).toISOString(),
    remainingDays: diffDays,
    state,
  };
}
