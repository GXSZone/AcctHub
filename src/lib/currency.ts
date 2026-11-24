import type { DisplayCurrency, FxDisplayRatesDto } from '@shared/contracts/extensions.contract';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'accthub_display_currency';

const DEFAULT_RATES: Record<DisplayCurrency, number> = {
  CNY: 1,
  USD: 0.1379,
  HKD: 1.0759,
  JPY: 21.24,
  KRW: 190.34,
};

export const CURRENCY_META: Record<DisplayCurrency, { symbol: string; label: string; decimals: number }> = {
  CNY: { symbol: '¥', label: 'CNY', decimals: 2 },
  USD: { symbol: '$', label: 'USD', decimals: 2 },
  HKD: { symbol: 'HK$', label: 'HKD', decimals: 2 },
  JPY: { symbol: '¥', label: 'JPY', decimals: 0 },
  KRW: { symbol: '₩', label: 'KRW', decimals: 0 },
};

let currentCurrency: DisplayCurrency = readInitialCurrency();
let currentRates: Record<DisplayCurrency, number> = { ...DEFAULT_RATES };
let ratesVersion = 0;
let snapshotKey = `${currentCurrency}:${ratesVersion}`;
const listeners = new Set<() => void>();

function readInitialCurrency(): DisplayCurrency {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as DisplayCurrency | null;
    if (saved && saved in CURRENCY_META) return saved;
  } catch {
    // 忽略隐私模式或 SSR
  }
  return 'CNY';
}

function notify() {
  snapshotKey = `${currentCurrency}:${ratesVersion}`;
  for (const fn of listeners) fn();
}

export function setDisplayCurrency(next: DisplayCurrency) {
  if (currentCurrency === next) return;
  currentCurrency = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 忽略
  }
  notify();
}

export function syncFxDisplayRates(dto?: FxDisplayRatesDto | null) {
  if (!dto?.rates) return;
  const nextRates = { ...DEFAULT_RATES, ...dto.rates };
  const changed = (Object.keys(nextRates) as DisplayCurrency[]).some(
    (k) => Math.abs((currentRates[k] ?? 0) - (nextRates[k] ?? 0)) > 1e-6
  );
  if (!changed) return;
  currentRates = nextRates;
  ratesVersion += 1;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React Hook：订阅当前展示币种与人民币折算格式化函数（汇率热更新亦即时广播重绘） */
export function useDisplayCurrency() {
  const snap = useSyncExternalStore(
    subscribe,
    () => snapshotKey,
    () => 'CNY:0'
  );
  const currency = (snap.split(':')[0] as DisplayCurrency) || 'CNY';
  const meta = CURRENCY_META[currency];
  const rate = currentRates[currency] ?? 1;

  /** 紧凑格式：CNY 整数省略小数，外币按币种精度折算 */
  const formatMoney = (cnyAmount: number): string => {
    const num = Number(cnyAmount || 0);
    if (!Number.isFinite(num)) return `${meta.symbol}0`;
    if (currency === 'CNY') {
      return `¥${Number.isInteger(num) ? num : num.toFixed(2)}`;
    }
    const converted = num * rate;
    return `${meta.symbol}${converted.toFixed(meta.decimals)}`;
  };

  /** 固定小数格式：CNY 始终保留两位小数（适配结账明细与实付金额），外币按币种精度折算 */
  const formatMoneyFixed = (cnyAmount: number): string => {
    const num = Number(cnyAmount || 0);
    if (!Number.isFinite(num)) return `${meta.symbol}${(0).toFixed(meta.decimals)}`;
    if (currency === 'CNY') {
      return `¥${num.toFixed(2)}`;
    }
    const converted = num * rate;
    return `${meta.symbol}${converted.toFixed(meta.decimals)}`;
  };

  return {
    currency,
    setCurrency: setDisplayCurrency,
    rate,
    symbol: meta.symbol,
    formatMoney,
    formatMoneyFixed,
  };
}
