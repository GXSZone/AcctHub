import { inArray, sql } from 'drizzle-orm';
import { siteSettings } from '../../db/schema/core';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';

const FX_MIN_RATE = 5.5;
const FX_MAX_RATE = 9.0;
const FX_MAX_CHANGE_PCT = 10;
const FX_DEFAULT_USD_CNY = 6.7;
const FX_DEFAULT_USDT_CNY = 6.72;
const FX_SOURCE_TIMEOUT_MS = 5500;
const FX_PRECISION_GRACE_MS = 350;

export interface LiveFxSnapshot {
  usd_cny: number;
  usdt_cny: number;
  updated_at: string;
  source: string;
}

interface FxCandidate {
  usdCny: number;
  usdtCny: number;
  source: string;
  hasDedicatedUsdt: boolean;
}

/** 校验新抓取的汇率是否在安全边界内，防止外部行情异常导致巨额汇率亏损 */
export function validateFxRateWithinGuard(
  newRate: number,
  prevRate: number | null
): { safe: boolean; reason?: string } {
  if (!Number.isFinite(newRate) || newRate < FX_MIN_RATE || newRate > FX_MAX_RATE) {
    return { safe: false, reason: `汇率 ${newRate} 超出合理安全区间 [${FX_MIN_RATE}, ${FX_MAX_RATE}]` };
  }
  if (prevRate && Number.isFinite(prevRate) && prevRate > 0) {
    const pctDiff = (Math.abs(newRate - prevRate) / prevRate) * 100;
    if (pctDiff > FX_MAX_CHANGE_PCT) {
      return {
        safe: false,
        reason: `单次汇率波动 ${pctDiff.toFixed(2)}% 超过熔断阈值 ${FX_MAX_CHANGE_PCT}%（旧=${prevRate}, 新=${newRate}）`,
      };
    }
  }
  return { safe: true };
}

/** 读取当前持久化缓存的汇率快照 */
export async function loadCachedFxSnapshot(env: Env): Promise<LiveFxSnapshot> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(inArray(siteSettings.key, ['fx_usd_cny', 'fx_usdt_cny', 'fx_updated_at', 'fx_last_source']));

  const map = new Map(rows.map((r) => [r.key, r.value]));
  const usd = Number(map.get('fx_usd_cny') || FX_DEFAULT_USD_CNY);
  const usdt = Number(map.get('fx_usdt_cny') || FX_DEFAULT_USDT_CNY);

  return {
    usd_cny: Number.isFinite(usd) && usd > 0 ? Number(usd.toFixed(4)) : FX_DEFAULT_USD_CNY,
    usdt_cny: Number.isFinite(usdt) && usdt > 0 ? Number(usdt.toFixed(4)) : FX_DEFAULT_USDT_CNY,
    updated_at: map.get('fx_updated_at') || '',
    source: map.get('fx_last_source') || 'default',
  };
}

async function fetchJsonWithTimeout<T>(url: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      // 忽略异常环境下的中止报错
    }
  }, FX_SOURCE_TIMEOUT_MS);

  try {
    const resp = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'AcctHub-FX/2.0' },
    });
    if (!resp.ok) throw new Error(`FX HTTP ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function queryOpenErApi(fetchImpl: typeof fetch): Promise<FxCandidate> {
  const json = await fetchJsonWithTimeout<{ rates?: { CNY?: number } }>(
    'https://open.er-api.com/v6/latest/USD',
    fetchImpl
  );
  const cny = Number(json.rates?.CNY || 0);
  if (!Number.isFinite(cny) || cny <= 0) throw new Error('open.er-api 汇率无效');
  const fixed = Number(cny.toFixed(4));
  return { usdCny: fixed, usdtCny: fixed, source: 'open-er-api', hasDedicatedUsdt: false };
}

async function queryExchangeRateApi(fetchImpl: typeof fetch): Promise<FxCandidate> {
  const json = await fetchJsonWithTimeout<{ rates?: { CNY?: number } }>(
    'https://api.exchangerate-api.com/v4/latest/USD',
    fetchImpl
  );
  const cny = Number(json.rates?.CNY || 0);
  if (!Number.isFinite(cny) || cny <= 0) throw new Error('exchangerate-api 汇率无效');
  const fixed = Number(cny.toFixed(4));
  return { usdCny: fixed, usdtCny: fixed, source: 'exchangerate-api', hasDedicatedUsdt: false };
}

async function queryJsDelivrFx(fetchImpl: typeof fetch): Promise<FxCandidate> {
  const json = await fetchJsonWithTimeout<{ usd?: { cny?: number; usdt?: number } }>(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    fetchImpl
  );
  const usdCny = Number(json.usd?.cny || 0);
  if (!Number.isFinite(usdCny) || usdCny <= 0) throw new Error('jsdelivr 汇率无效');
  const usdPerUsdt = Number(json.usd?.usdt || 0);
  const usdtCny =
    Number.isFinite(usdPerUsdt) && usdPerUsdt > 0.8 && usdPerUsdt < 1.2 ? usdCny / usdPerUsdt : usdCny;
  return {
    usdCny: Number(usdCny.toFixed(4)),
    usdtCny: Number(usdtCny.toFixed(4)),
    source: 'jsdelivr-fx',
    hasDedicatedUsdt: usdPerUsdt > 0,
  };
}

async function queryCoinGecko(fetchImpl: typeof fetch): Promise<FxCandidate> {
  const json = await fetchJsonWithTimeout<{ tether?: { cny?: number }; 'usd-coin'?: { cny?: number } }>(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether,usd-coin&vs_currencies=cny',
    fetchImpl
  );
  const usdtCny = Number(json.tether?.cny || 0);
  const usdCny = Number(json['usd-coin']?.cny || usdtCny || 0);
  if (!Number.isFinite(usdtCny) || usdtCny <= 0 || !Number.isFinite(usdCny) || usdCny <= 0) {
    throw new Error('CoinGecko 汇率无效');
  }
  return {
    usdCny: Number(usdCny.toFixed(4)),
    usdtCny: Number(usdtCny.toFixed(4)),
    source: 'coingecko',
    hasDedicatedUsdt: true,
  };
}

async function queryCoinbase(fetchImpl: typeof fetch): Promise<FxCandidate> {
  const json = await fetchJsonWithTimeout<{ data?: { rates?: { CNY?: string } } }>(
    'https://api.coinbase.com/v2/exchange-rates?currency=USDT',
    fetchImpl
  );
  const cny = Number(json.data?.rates?.CNY || 0);
  if (!Number.isFinite(cny) || cny <= 0) throw new Error('Coinbase 汇率无效');
  const fixed = Number(cny.toFixed(4));
  return { usdCny: fixed, usdtCny: fixed, source: 'coinbase', hasDedicatedUsdt: true };
}

/** 并发拉取多路公开汇率数据源，兼顾国内直连速度与 USDT/USD 精度 */
export async function fetchLiveRatesFromPublicApis(
  fetchImpl: typeof fetch = fetch
): Promise<{ usdCny: number; usdtCny: number; source: string }> {
  const tasks = [
    queryOpenErApi(fetchImpl),
    queryExchangeRateApi(fetchImpl),
    queryJsDelivrFx(fetchImpl),
    queryCoinGecko(fetchImpl),
    queryCoinbase(fetchImpl),
  ];

  return new Promise((resolve, reject) => {
    let settledCount = 0;
    let resolved = false;
    let fallbackCandidate: FxCandidate | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const errors: string[] = [];

    const finish = (candidate: FxCandidate) => {
      if (resolved) return;
      resolved = true;
      if (graceTimer) clearTimeout(graceTimer);
      resolve({ usdCny: candidate.usdCny, usdtCny: candidate.usdtCny, source: candidate.source });
    };

    for (const task of tasks) {
      task
        .then((candidate) => {
          if (resolved) return;
          if (candidate.hasDedicatedUsdt) {
            finish(candidate);
            return;
          }
          if (!fallbackCandidate) {
            fallbackCandidate = candidate;
            graceTimer = setTimeout(() => {
              if (fallbackCandidate) finish(fallbackCandidate);
            }, FX_PRECISION_GRACE_MS);
          }
        })
        .catch((err) => {
          errors.push(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          settledCount += 1;
          if (!resolved && settledCount >= tasks.length) {
            if (graceTimer) clearTimeout(graceTimer);
            if (fallbackCandidate) {
              finish(fallbackCandidate);
            } else {
              reject(new Error(errors[0] || '所有实时汇率数据源均请求失败'));
            }
          }
        });
    }
  });
}

/** 同步实时 USD/CNY 与 USDT/CNY 汇率（带 15 分钟 Cron 节流 + ±10% 异常波动熔断） */
export async function syncLiveExchangeRates(
  env: Env,
  opts?: { force?: boolean; customRates?: { usdCny: number; usdtCny: number; source?: string } }
): Promise<{ ok: boolean; skipped?: boolean; snapshot: LiveFxSnapshot; guardMessage?: string }> {
  const current = await loadCachedFxSnapshot(env);

  if (!opts?.force && !opts?.customRates) {
    if ((env.APP_ENV || '').toLowerCase() === 'test') {
      return { ok: true, skipped: true, snapshot: current };
    }
    if (current.updated_at) {
      const lastMs = Date.parse(`${current.updated_at.replace(' ', 'T')}Z`);
      if (Number.isFinite(lastMs) && Date.now() - lastMs < 15 * 60 * 1000) {
        return { ok: true, skipped: true, snapshot: current };
      }
    }
  }

  const prevUsd = current.updated_at ? current.usd_cny : null;
  const prevUsdt = current.updated_at ? current.usdt_cny : null;

  let fetched: { usdCny: number; usdtCny: number; source: string };
  if (opts?.customRates) {
    fetched = {
      usdCny: opts.customRates.usdCny,
      usdtCny: opts.customRates.usdtCny,
      source: opts.customRates.source || 'injected',
    };
  } else {
    try {
      fetched = await fetchLiveRatesFromPublicApis();
    } catch (err) {
      return {
        ok: false,
        snapshot: current,
        guardMessage: err instanceof Error ? err.message : '汇率抓取失败，保留上次缓存',
      };
    }
  }

  const usdGuard = validateFxRateWithinGuard(fetched.usdCny, prevUsd);
  const usdtGuard = validateFxRateWithinGuard(fetched.usdtCny, prevUsdt);
  if (!usdGuard.safe || !usdtGuard.safe) {
    return {
      ok: false,
      snapshot: current,
      guardMessage: usdGuard.reason || usdtGuard.reason || '触发汇率熔断保护',
    };
  }

  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const db = createDb(env.DB);
  const entries: Array<[string, string]> = [
    ['fx_usd_cny', fetched.usdCny.toFixed(4)],
    ['fx_usdt_cny', fetched.usdtCny.toFixed(4)],
    ['fx_updated_at', nowStr],
    ['fx_last_source', fetched.source],
  ];

  for (const [key, value] of entries) {
    await db
      .insert(siteSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: { value, updatedAt: sql`datetime('now')` },
      });
  }

  return {
    ok: true,
    snapshot: {
      usd_cny: fetched.usdCny,
      usdt_cny: fetched.usdtCny,
      updated_at: nowStr,
      source: fetched.source,
    },
  };
}
