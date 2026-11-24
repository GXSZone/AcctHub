import { and, eq, or, sql } from 'drizzle-orm';
import { paymentIntents } from '../../db/schema/index';
import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { loadCachedFxSnapshot } from './payment.fx';
import type { UsdtPluginConfig } from './payment.gateway';
import { parsePaymentMinorUnits, parsePaymentTradeNo } from './payment.receipt';

export type UsdtChainProvider = 'usdt_trc20' | 'usdt_bep20' | 'usdt_erc20';

const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_BEP20_CONTRACT = '0x55d398326f99059ff775485246999027b3197955';
const USDT_ERC20_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

export interface UsdtChainTransfer {
  transactionId: string;
  amountAtomic: bigint;
  blockTimestampMs: number;
}

export function usdtAtomicAmount(provider: UsdtChainProvider, amountMinor: number): bigint {
  return BigInt(amountMinor) * 10n ** BigInt(provider === 'usdt_bep20' ? 14 : 2);
}

function parseAtomicTransferValue(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^[0-9]{1,78}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

/** 获取生效中的 USDT/CNY 汇率（开启 auto_fx 时自动使用 Cron 同步的安全实时汇率） */
async function resolveEffectiveUsdtRate(env: Env, cfg: UsdtPluginConfig): Promise<number> {
  const manualRate = Number(cfg.usdt_cny_rate || 0);
  const autoFx = cfg.auto_fx !== false && String(cfg.auto_fx || '').toLowerCase() !== 'false';
  if (autoFx) {
    const snap = await loadCachedFxSnapshot(env);
    if (snap.updated_at && snap.usdt_cny > 0) return snap.usdt_cny;
  }
  return Math.max(1, Number.isFinite(manualRate) && manualRate > 0 ? manualRate : 7.25);
}

/** 分配 20 分钟窗口内全链独享的 4 位小数防撞单 USDT 应付金额（0.0001 ~ 0.0999） */
export async function allocateUniqueUsdtAmount(
  env: Env,
  amountCny: number,
  cfg: UsdtPluginConfig,
  provider: UsdtChainProvider = 'usdt_trc20'
): Promise<{ payAmount: number; walletAddress: string; sandboxSimulated: boolean; rateUsed: number }> {
  const walletAddress = (cfg.wallet_address || '').trim();
  const baseRate = await resolveEffectiveUsdtRate(env, cfg);
  const markup = Math.max(0, Number(cfg.rate_markup || 0.02));
  const effectiveRate = baseRate * (1 - Math.min(0.2, markup));
  const baseUnits = Math.max(10, Math.round((amountCny / effectiveRate) * 100)) * 100;
  if (!Number.isSafeInteger(baseUnits + 999)) throw Errors.validation('无效的 USDT 应付金额');

  const db = createDb(env.DB);
  // L3：同时避开活跃待支付单与最近 2 小时刚过期的 USDT 支付单尾数，防止临界迟到转账串单到新订单
  const activeRows = await db
    .select({ payAmount: paymentIntents.payAmount })
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.provider, provider),
        or(
          eq(paymentIntents.status, 'pending'),
          and(
            eq(paymentIntents.status, 'expired'),
            sql`${paymentIntents.expiresAt} >= datetime('now', '-2 hours')`
          )
        )
      )
    );
  const occupied = new Set(activeRows.map((r) => parsePaymentMinorUnits(r.payAmount, 4)));

  let chosen: number | null = null;
  for (let offset = 1; offset <= 999; offset++) {
    const candidate = baseUnits + offset;
    if (!occupied.has(candidate)) {
      chosen = candidate / 10_000;
      break;
    }
  }
  if (chosen === null) throw Errors.conflict('当前该金额收款通道拥堵，请稍后重试');

  if (!walletAddress) {
    if (typeof __ACCTHUB_SANDBOX__ !== 'undefined' && __ACCTHUB_SANDBOX__ && isSandboxEnabled(env)) {
      const sandboxAddr =
        provider === 'usdt_trc20'
          ? 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
          : '0x000000000000000000000000000000000000dEaD';
      return {
        payAmount: chosen,
        walletAddress: sandboxAddr,
        sandboxSimulated: true,
        rateUsed: effectiveRate,
      };
    }
    throw new Error(`${provider.toUpperCase()} 收款钱包地址尚未配置`);
  }

  return { payAmount: chosen, walletAddress, sandboxSimulated: false, rateUsed: effectiveRate };
}

/** 按链类型抓取近期已确认的 USDT 转入流水，用于链上自动核单（接口异常显式抛错以便告警，绝不静默吞没） */
export async function fetchRecentUsdtChainTransfers(
  provider: UsdtChainProvider,
  cfg: UsdtPluginConfig,
  minTimestampMs: number
): Promise<UsdtChainTransfer[]> {
  const wallet = (cfg.wallet_address || '').trim();
  if (!wallet) return [];

  if (provider === 'usdt_trc20') {
    const url = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(wallet)}/transactions/trc20?only_confirmed=true&only_to=true&limit=100&contract_address=${USDT_TRC20_CONTRACT}&min_timestamp=${Math.max(0, Math.floor(minTimestampMs))}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cfg.trongrid_api_key?.trim()) headers['TRON-PRO-API-KEY'] = cfg.trongrid_api_key.trim();

    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) {
      throw new Error(`TronGrid API HTTP ${resp.status}`);
    }
    const json = (await resp.json()) as {
      success?: boolean;
      error?: string;
      data?: Array<{
        transaction_id?: string;
        value?: string;
        block_timestamp?: number;
        to?: string;
        type?: string;
        token_info?: { decimals?: number; address?: string };
      }>;
    };
    if (json.success === false || !Array.isArray(json.data)) {
      throw new Error(json.error || 'TronGrid 返回非预期响应结构');
    }
    const out: UsdtChainTransfer[] = [];
    for (const item of json.data) {
      const amountAtomic = parseAtomicTransferValue(item.value);
      const transactionId = parsePaymentTradeNo(item.transaction_id)?.toLowerCase();
      const timestamp = item.block_timestamp;
      if (
        amountAtomic === null ||
        !transactionId ||
        item.type !== 'Transfer' ||
        item.to !== wallet ||
        item.token_info?.address !== USDT_TRC20_CONTRACT ||
        item.token_info.decimals !== 6 ||
        typeof timestamp !== 'number' ||
        !Number.isSafeInteger(timestamp) ||
        timestamp < minTimestampMs
      )
        continue;
      out.push({
        transactionId,
        amountAtomic,
        blockTimestampMs: timestamp,
      });
    }
    return out;
  }

  // EVM 链（BSC BEP20 / Ethereum ERC20）通过 Etherscan/BscScan 兼容接口检索确认交易
  const isBsc = provider === 'usdt_bep20';
  const contract = isBsc ? USDT_BEP20_CONTRACT : USDT_ERC20_CONTRACT;
  const chainId = isBsc ? '56' : '1';
  const apiKey = (cfg.explorer_api_key || '').trim();
  const baseApi = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=tokentx&contractaddress=${contract}&address=${encodeURIComponent(wallet)}&page=1&offset=100&sort=desc${apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : ''}`;

  const resp = await fetch(baseApi, { signal: AbortSignal.timeout(8_000) });
  if (!resp.ok) {
    throw new Error(`${provider.toUpperCase()} 区块浏览器 API HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    status?: string;
    message?: string;
    result?: unknown;
  };
  if (!Array.isArray(json.result)) {
    const errText =
      typeof json.result === 'string' && json.result
        ? json.result
        : json.message || '区块浏览器返回非数组结果';
    throw new Error(`${provider.toUpperCase()} API 异常：${errText}`);
  }
  const walletLower = wallet.toLowerCase();
  const out: UsdtChainTransfer[] = [];
  for (const rawTx of json.result) {
    const tx = rawTx as {
      hash?: string;
      to?: string;
      value?: string;
      timeStamp?: string;
      tokenDecimal?: string;
      contractAddress?: string;
      confirmations?: string;
    };
    const transactionId = parsePaymentTradeNo(tx.hash)?.toLowerCase();
    if (
      tx.to?.toLowerCase() !== walletLower ||
      tx.contractAddress?.toLowerCase() !== contract ||
      !transactionId ||
      tx.tokenDecimal !== (isBsc ? '18' : '6')
    )
      continue;
    const confirmations = Number(tx.confirmations);
    if (!Number.isSafeInteger(confirmations) || confirmations < 3) continue;
    const tsMs = Number(tx.timeStamp || 0) * 1000;
    if (!Number.isSafeInteger(tsMs) || tsMs < minTimestampMs) continue;
    const amountAtomic = parseAtomicTransferValue(tx.value);
    if (amountAtomic === null) continue;
    out.push({
      transactionId,
      amountAtomic,
      blockTimestampMs: tsMs,
    });
  }
  return out;
}
