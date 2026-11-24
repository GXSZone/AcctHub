export type PriceRoundingMode = 'none' | 'integer' | 'point9';

export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Number((Math.round(cents) / 100).toFixed(2));
}

export function roundCurrency(amount: number): number {
  return fromCents(toCents(amount));
}

export function formatYuanPrice(amount: number): string {
  return `¥${amount.toFixed(Number.isInteger(amount) ? 0 : 2)}`;
}

export function discountDisplay(rate: number) {
  return {
    zhFold: Number((rate * 10).toFixed(3)),
    ratePct: Number((rate * 100).toFixed(2)),
    offPct: Number(((1 - rate) * 100).toFixed(2)),
  };
}

export function roundUpCurrency(amount: number): number {
  if (!Number.isFinite(amount) || amount === 0) return 0;
  const val = amount > 0 ? Math.ceil(amount * 100 - 1e-9) / 100 : Math.floor(amount * 100 + 1e-9) / 100;
  return Object.is(val, -0) ? 0 : Number(val.toFixed(2));
}

export function addMoney(a: number, b: number): number {
  return fromCents(toCents(a) + toCents(b));
}

export function subMoney(a: number, b: number): number {
  return fromCents(toCents(a) - toCents(b));
}

export function applyMarkup(basePrice: number, markupPercent: number): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  const pct = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0;
  return roundCurrency(basePrice * (1 + pct / 100));
}

export function applyPriceRounding(price: number, mode: PriceRoundingMode): number {
  // 非法或非正数价格直接返回 0，避免将负数/0/NaN 静默转正
  if (!Number.isFinite(price) || price <= 0) return 0;
  const safe = Math.max(0.01, roundCurrency(price));
  if (mode === 'integer') {
    return Math.max(1, Math.ceil(safe));
  }
  if (mode === 'point9') {
    const floorInt = Math.floor(safe);
    const candidate = Number((floorInt + 0.9).toFixed(2));
    return candidate >= safe ? candidate : Number((floorInt + 1.9).toFixed(2));
  }
  return safe;
}

/**
 * 计算防亏最低安全零售价，确保即使最低折扣档代理拿货也不低于进货成本 `costPrice`
 */
export function calculateMinSafeRetail(costPrice: number, lowestDiscountRate: number): number {
  if (!Number.isFinite(costPrice) || costPrice <= 0) return 0;
  const rawRate = Number(lowestDiscountRate);
  const safeRate = Number.isFinite(rawRate) && rawRate > 0 ? Math.min(1, Math.max(0.1, rawRate)) : 1;
  return roundUpCurrency(costPrice / safeRate);
}

export function evaluateRetailMargin(
  retailPrice: number,
  costPrice: number | null | undefined,
  lowestDiscountRate: number
): {
  lowestAgentPrice: number;
  safeRetailMin: number;
  lossPerUnit: number;
  netMarginPerUnit: number;
  isLoss: boolean;
} {
  const rawRate = Number(lowestDiscountRate);
  const safeRate = Number.isFinite(rawRate) && rawRate > 0 ? Math.min(1, Math.max(0.1, rawRate)) : 1;
  const safeRetail = Number.isFinite(retailPrice) ? retailPrice : 0;
  const lowestAgentPrice = roundCurrency(safeRetail * safeRate);
  const rawCost = Number(costPrice);
  const cost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
  if (cost <= 0) {
    const netMargin = lowestAgentPrice;
    const loss = netMargin < 0 ? roundCurrency(Math.abs(netMargin)) : 0;
    return {
      lowestAgentPrice,
      safeRetailMin: 0,
      lossPerUnit: loss,
      netMarginPerUnit: netMargin,
      isLoss: loss > 0,
    };
  }
  const safeRetailMin = calculateMinSafeRetail(cost, safeRate);
  const netMarginPerUnit = subMoney(lowestAgentPrice, cost);
  const lossPerUnit = netMarginPerUnit < 0 ? roundCurrency(Math.abs(netMarginPerUnit)) : 0;
  return {
    lowestAgentPrice,
    safeRetailMin,
    lossPerUnit,
    netMarginPerUnit,
    isLoss: lossPerUnit > 0,
  };
}
