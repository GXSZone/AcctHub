import { and, eq, sql } from 'drizzle-orm';
import { upstreamSources } from '../../db/schema/index';
import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import type {
  UpstreamPlaceOrderRequest,
  UpstreamPlaceOrderResult,
  UpstreamSourceRow,
} from './upstream.types';

export function assertUpstreamSandboxEnabled(env: Env): void {
  if (!isSandboxEnabled(env)) {
    throw Errors.sandboxDisabled('生产环境已禁止运行上游仿真沙盒，请切换为真实上游渠道');
  }
}

export function buildMockUpstreamRawPayload(): { data: { items: Record<string, unknown>[] } } {
  const minuteBucket = Math.floor(Date.now() / 60_000);
  const jitter = (minuteBucket % 3) - 1;
  return {
    data: {
      items: [
        {
          sku_code: 'UP-CLAUDE-PRO-MULTI',
          item_name: 'Claude Pro 上游直供独享成品号（多规格）',
          group_name: 'Claude 上游专线',
          wholesale_cny: 112,
          qty_left: Math.max(5, 22 + jitter),
          sale_state: 'online',
          intro: '上游直供原邮独享号，支持月卡/季卡多规格同步与秒级直采出卡。',
          specs: [
            { id: '1m', name: '独享月卡 · 30天质保', price: 112, stock: 16 },
            { id: '3m', name: '独享季卡 · 90天质保', price: 308, stock: 8 },
          ],
        },
        {
          sku_code: 'UP-CLAUDE-MAX20',
          item_name: 'Claude Max 20x 官方独享重度开发者号（月卡）',
          group_name: 'Claude 上游专线',
          wholesale_cny: 1080,
          qty_left: Math.max(2, 8 + jitter),
          sale_state: 'online',
          intro: '上游直供企业卡源，适配 Claude Code 重度上下文推理，支持 2FA 辅助登录。',
        },
        {
          sku_code: 'UP-PERPLEXITY-PRO',
          item_name: 'Perplexity Pro 深度研究年卡成品号（美区原邮）',
          group_name: 'AI 搜索与科研',
          wholesale_cny: 68,
          qty_left: Math.max(5, 34 + jitter * 2),
          sale_state: 'online',
          intro: '支持 Sonar / Claude / GPT 多模型联网深度检索，独立账号可改密。',
        },
        {
          sku_code: 'UP-GROK-SUPER',
          item_name: 'SuperGrok / X Premium+ 官方代充月卡',
          group_name: 'Grok / X',
          wholesale_cny: 158,
          qty_left: 0,
          sale_state: 'sold_out',
          intro: '上游当前通道临时售罄，补货后将自动恢复库存。',
        },
        {
          sku_code: 'UP-SPOTIFY-12M',
          item_name: 'Spotify Premium 全球区家庭组年卡（稳定不掉）',
          group_name: '流媒体影音',
          wholesale_cny: 42,
          qty_left: Math.max(5, 26 + jitter),
          sale_state: 'online',
          intro: '支持原号拉入高稳菲律宾/尼日利亚家庭组，全程质保。',
        },
        {
          sku_code: 'UP-INTERNAL-TEST-99',
          item_name: '【测试商品-内部禁用】勿采上游调试 SKU',
          group_name: '测试分组',
          wholesale_cny: 1,
          qty_left: 999,
          sale_state: 'online',
          intro: '用于演示采集黑名单关键词过滤规则自动跳过。',
        },
      ],
    },
  };
}

export async function runSandboxPlaceOrder(
  env: Env,
  source: UpstreamSourceRow,
  req: UpstreamPlaceOrderRequest
): Promise<UpstreamPlaceOrderResult> {
  assertUpstreamSandboxEnabled(env);

  const mode = source.sandbox_mode || 'normal';
  const unitCost = Number(req.unitCostHint || 50);
  const totalCost = Number((unitCost * req.quantity).toFixed(2));
  const currentBal =
    source.cached_balance !== null && source.cached_balance !== undefined
      ? Number(source.cached_balance)
      : 1280;

  if (mode === 'always_fail') {
    return {
      status: 'failed',
      upstreamOrderNo: '',
      cards: [],
      actualCost: 0,
      errorMessage: '[沙盒模拟] 上游通道库存瞬时售罄或接口拒单',
      rawResponse: { sandbox: true, mode, code: 4001, msg: 'Out of stock' },
    };
  }
  if (mode === 'always_timeout') {
    return {
      status: 'timeout_unknown',
      upstreamOrderNo: `SBX-TO-${Date.now().toString().slice(-6)}`,
      cards: [],
      actualCost: totalCost,
      errorMessage: '[沙盒模拟] 请求超时，状态未知，已锁定待查单（不自动切源以防双采）',
      rawResponse: { sandbox: true, mode, timeout: true },
    };
  }
  if (currentBal < totalCost) {
    return {
      status: 'failed',
      upstreamOrderNo: '',
      cards: [],
      actualCost: 0,
      errorMessage: `[沙盒模拟] 上游预存余额不足（需 ¥${totalCost}，余 ¥${currentBal.toFixed(2)}）`,
      rawResponse: { sandbox: true, balance: currentBal, needed: totalCost },
    };
  }

  // 原子条件扣减沙盒预存余额，防止高并发下超扣
  const db = createDb(env.DB);
  const deducted = await db
    .update(upstreamSources)
    .set({
      cachedBalance: sql`round(COALESCE(${upstreamSources.cachedBalance}, 0) - ${totalCost}, 2)`,
      balanceUpdatedAt: sql`datetime('now')`,
    })
    .where(
      and(
        eq(upstreamSources.id, source.id),
        sql`COALESCE(${upstreamSources.cachedBalance}, 0) >= ${totalCost}`
      )
    )
    .returning({ id: upstreamSources.id });
  if (deducted.length !== 1) {
    return {
      status: 'failed',
      upstreamOrderNo: '',
      cards: [],
      actualCost: 0,
      errorMessage: `[沙盒模拟] 上游预存余额并发扣减不足（需 ¥${totalCost}）`,
      rawResponse: { sandbox: true, needed: totalCost },
    };
  }

  const nextBal = Number((currentBal - totalCost).toFixed(2));
  const upNo = `SBX${Date.now().toString().slice(-8)}${Math.floor(100 + Math.random() * 900)}`;

  if (mode === 'always_async') {
    return {
      status: 'pending',
      upstreamOrderNo: upNo,
      cards: [],
      actualCost: totalCost,
      errorMessage: '[沙盒模拟] 上游已接单，等待异步 Webhook 回调或定时查单出卡',
      rawResponse: { sandbox: true, mode, order_no: upNo, status: 'processing', remaining_balance: nextBal },
    };
  }

  const cards: string[] = [];
  for (let i = 0; i < req.quantity; i++) {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    cards.push(
      `[上游直采 ${req.upstreamItemId}${req.upstreamSpecId ? `:${req.upstreamSpecId}` : ''}] acct_${rand.toLowerCase()}@pro-edge.ai | Pass: Edge#${rand} | 2FA: JBSWY3DPEHPK3PXP`
    );
  }
  return {
    status: 'succeeded',
    upstreamOrderNo: upNo,
    cards,
    actualCost: totalCost,
    errorMessage: '',
    rawResponse: { sandbox: true, mode, order_no: upNo, cards, cost: totalCost, remaining_balance: nextBal },
  };
}

export function runSandboxQueryOrder(
  env: Env,
  params: { outTradeNo: string; upstreamOrderNo?: string; upstreamItemId?: string; quantity?: number }
): UpstreamPlaceOrderResult {
  assertUpstreamSandboxEnabled(env);
  const qty = Math.max(1, Number(params.quantity || 1));
  const cards: string[] = [];
  for (let i = 0; i < qty; i++) {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    cards.push(
      `[上游异步出卡 ${params.upstreamItemId || 'SKU'}] async_${rand.toLowerCase()}@pro-edge.ai | Pass: Async#${rand} | Ref: ${params.outTradeNo}`
    );
  }
  return {
    status: 'succeeded',
    upstreamOrderNo: params.upstreamOrderNo || `SBX-POLL-${Date.now().toString().slice(-6)}`,
    cards,
    actualCost: 0,
    errorMessage: '',
    rawResponse: { sandbox: true, polled: true, cards },
  };
}
