import { discountDisplay } from '@shared/domain/money';
import { eq, type SQL } from 'drizzle-orm';
import { agents, agentTiers, siteSettings } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { readWalletEvent, walletEventKey } from '../account/wallet-event.repo';
import {
  type CommissionPosting,
  listPostedCommissions,
  postAgentCommissions,
} from './settlement-posting.repo';

export interface AgentLineageNode {
  id: number;
  user_id: number;
  slug: string;
  brand_name: string;
  parent_agent_id: number | null;
  ancestor_path: string;
  discount_rate: number;
  status: string;
}

/**
 * 加载代理节点及其相对主站原价的生效拿货折率（100% Drizzle ORM）。
 * 关联查询父代理折率，动态强制 effectiveRate >= parentRate，防止上下级折率倒挂。
 */
export async function getAgentLineageNode(env: Env, agentId: number): Promise<AgentLineageNode | null> {
  const db = createDb(env.DB);
  const rows = await db
    .select({
      id: agents.id,
      userId: agents.userId,
      slug: agents.slug,
      brandName: agents.brandName,
      parentAgentId: agents.parentAgentId,
      ancestorPath: agents.ancestorPath,
      status: agents.status,
      tierId: agents.tierId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  let selfRate = 0.9;
  if (row.tierId) {
    const tRows = await db
      .select({ discountRate: agentTiers.discountRate })
      .from(agentTiers)
      .where(eq(agentTiers.id, row.tierId))
      .limit(1);
    if (tRows[0]) selfRate = Number(tRows[0].discountRate ?? 0.9);
  }

  let parentRate = 0;
  if (row.parentAgentId) {
    const pRows = await db
      .select({ tierId: agents.tierId })
      .from(agents)
      .where(eq(agents.id, row.parentAgentId))
      .limit(1);
    if (pRows[0]?.tierId) {
      const ptRows = await db
        .select({ discountRate: agentTiers.discountRate })
        .from(agentTiers)
        .where(eq(agentTiers.id, pRows[0].tierId))
        .limit(1);
      if (ptRows[0]) parentRate = Number(ptRows[0].discountRate ?? 0);
    }
  }

  return {
    id: row.id,
    user_id: row.userId,
    slug: row.slug,
    brand_name: row.brandName,
    parent_agent_id: row.parentAgentId,
    ancestor_path: row.ancestorPath,
    status: row.status,
    discount_rate: Math.max(selfRate, parentRate),
  };
}

function parseAncestorIds(ancestorPath: string, excludeAgentId: number): number[] {
  const seen = new Set<number>();
  return String(ancestorPath || '/')
    .split('/')
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => {
      if (!Number.isFinite(n) || n <= 0 || n === excludeAgentId || seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .reverse();
}

/**
 * 实时递归结算整条代理供应链分润（100% Drizzle ORM）：
 * 1) 资金守恒约束：订单用券导致实付降低时按实付比例缩减分润基数，且全链总派发不超过买家实付总额；
 * 2) 封禁防越级吞并：若中间某级代理处于非 active 状态，冻结其极差留归平台并照常下推折率水位。
 */
export async function settleRecursiveOrderProfits(params: {
  env: Env;
  orderNo: string;
  sellingAgentId: number;
  baseMainTotal: number;
  totalAmount: number;
  mode: 'retail' | 'b2b_api';
  guard?: SQL;
}): Promise<{ sellerProfit: number; totalSettledToChain: number }> {
  const { env, orderNo, sellingAgentId, baseMainTotal, totalAmount, mode } = params;
  const db = createDb(env.DB);
  const existing = await readWalletEvent(db, walletEventKey('order-commissions', orderNo));
  const previous = await listPostedCommissions(db, orderNo);
  const sellerPaid = previous.find(
    (entry) => entry.rewardType === 'direct_sale' && entry.beneficiaryAgentId === sellingAgentId
  );
  if (existing) return { sellerProfit: sellerPaid?.amount ?? 0, totalSettledToChain: existing.amount };

  const seller = await getAgentLineageNode(env, sellingAgentId);
  if (!seller) return { sellerProfit: 0, totalSettledToChain: 0 };

  const postings: CommissionPosting[] = [];
  const posted = new Map(
    previous.map((entry) => [`${entry.beneficiaryAgentId}:${entry.rewardType}`, entry.amount])
  );
  const sellerDiscountRate = Number(seller.discount_rate);
  const sellerCostTotal = Number((baseMainTotal * sellerDiscountRate).toFixed(2));
  let sellerProfit = 0;
  let totalSettledToChain = 0;

  if (mode === 'retail' && seller.status === 'active') {
    sellerProfit = sellerPaid?.amount ?? Math.max(0, Number((totalAmount - sellerCostTotal).toFixed(2)));
    totalSettledToChain = sellerProfit;
    if (!sellerPaid)
      postings.push({
        orderNo,
        userId: seller.user_id,
        beneficiaryAgentId: seller.id,
        sourceAgentId: seller.id,
        hopDistance: 0,
        rewardType: 'direct_sale',
        amount: sellerProfit,
        revenue: totalAmount,
        walletNote: `分站零售订单利润入账（${orderNo}）`,
        note: `直营分站利润实时入账（卖价 ¥${totalAmount.toFixed(2)} − ${discountDisplay(sellerDiscountRate).zhFold}折拿货底价 ¥${sellerCostTotal.toFixed(2)}）`,
      });
  }

  const effectiveBaseTotal =
    sellerCostTotal > 0 && totalAmount < sellerCostTotal
      ? Number((baseMainTotal * (totalAmount / sellerCostTotal)).toFixed(2))
      : baseMainTotal;

  let ancestorIds = parseAncestorIds(seller.ancestor_path, seller.id);
  // 防御性兜底：若历史记录缺失 ancestor_path 但存在 parent_agent_id，则按父指针向上回溯（防环，最多 16 跳）
  if (ancestorIds.length === 0 && seller.parent_agent_id) {
    const fallback: number[] = [];
    const visited = new Set<number>([seller.id]);
    let curParentId: number | null = seller.parent_agent_id;
    while (curParentId && !visited.has(curParentId) && fallback.length < 16) {
      visited.add(curParentId);
      fallback.push(curParentId);
      const pNode = await getAgentLineageNode(env, curParentId);
      curParentId = pNode?.parent_agent_id ?? null;
    }
    ancestorIds = fallback;
  }
  let childCostRate = sellerDiscountRate;

  for (let i = 0; i < ancestorIds.length; i++) {
    const ancId = ancestorIds[i];
    const hop = i + 1;
    const anc = await getAgentLineageNode(env, ancId);
    if (!anc) continue;

    if (anc.status !== 'active') {
      if (anc.discount_rate < childCostRate) {
        childCostRate = anc.discount_rate;
      }
      continue;
    }

    if (anc.discount_rate < childCostRate - 0.0001) {
      const spreadRate = Number((childCostRate - anc.discount_rate).toFixed(4));
      const rawSpreadAmt = Number((effectiveBaseTotal * spreadRate).toFixed(2));
      const maxRemainingPool = Math.max(0, Number((totalAmount - totalSettledToChain).toFixed(2)));
      const rewardType = mode === 'b2b_api' ? 'b2b_wholesale_spread' : 'differential_override';
      const previousReward = posted.get(`${anc.id}:${rewardType}`);
      const spreadAmt = previousReward ?? Math.min(rawSpreadAmt, maxRemainingPool);
      childCostRate = anc.discount_rate;

      if (spreadAmt > 0) {
        const label = mode === 'b2b_api' ? '下级 API 批采差价' : `第 ${hop} 级下线分站差价`;
        if (previousReward === undefined)
          postings.push({
            orderNo,
            userId: anc.user_id,
            beneficiaryAgentId: anc.id,
            sourceAgentId: seller.id,
            hopDistance: hop,
            rewardType,
            amount: spreadAmt,
            revenue: 0,
            walletNote: `下级供货极差利润入账（${orderNo}）`,
            note: `${label}实时入账（${discountDisplay(anc.discount_rate).zhFold}折供货差 ${Number((spreadRate * 100).toFixed(2))}%）`,
          });

        totalSettledToChain = Number((totalSettledToChain + spreadAmt).toFixed(2));
      }
    }
  }

  const result = await postAgentCommissions(db, {
    orderNo,
    postings,
    amount: totalSettledToChain,
    guard: params.guard,
  });
  if (!result.applied) {
    if (result.amount === null) throw new Error(`订单分润未提交（${orderNo}）`);
    const committed = await listPostedCommissions(db, orderNo);
    sellerProfit =
      committed.find(
        (entry) => entry.rewardType === 'direct_sale' && entry.beneficiaryAgentId === sellingAgentId
      )?.amount ?? 0;
  }
  return { sellerProfit, totalSettledToChain: result.amount ?? 0 };
}

/** 结算下级代理开户/晋级费用至直属上级代理钱包余额（仅限 status === 'active' 的正常上级，支持幂等 refNo） */
export async function settleTierUpgradeFeeToParent(params: {
  env: Env;
  parentAgentId: number;
  childAgentId: number;
  feeAmount: number;
  tierName: string;
  childSlug: string;
  ledgerRefNo: string;
  guard?: SQL;
}): Promise<{ parentIncome: number; platformCut: number; platformFeePct: number }> {
  const { env, parentAgentId, childAgentId, feeAmount, tierName, childSlug, ledgerRefNo } = params;
  const parent = await getAgentLineageNode(env, parentAgentId);
  if (parent?.status !== 'active' || feeAmount <= 0) {
    return { parentIncome: 0, platformCut: 0, platformFeePct: 0 };
  }

  const db = createDb(env.DB);
  const feeRows = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'agent_signup_platform_fee_pct'))
    .limit(1);
  const platformFeePct = Math.min(80, Math.max(0, Number(feeRows[0]?.value ?? 0) || 0));
  const platformCut = Number(((feeAmount * platformFeePct) / 100).toFixed(2));
  const parentIncome = Math.max(0, Number((feeAmount - platformCut).toFixed(2)));

  const note =
    platformFeePct > 0
      ? `直属下级分站「@${childSlug}」开通/升级「${tierName}」开户费（实付 ¥${feeAmount.toFixed(2)}，平台抽成 ${platformFeePct}%，到账 ¥${parentIncome.toFixed(2)}）`
      : `直属下级分站「@${childSlug}」开通/升级「${tierName}」开户费 100% 实时入账`;

  const prior = (await listPostedCommissions(db, ledgerRefNo)).find(
    (entry) => entry.rewardType === 'tier_upgrade_fee'
  );
  const result = prior
    ? { amount: prior.amount }
    : await postAgentCommissions(db, {
        orderNo: ledgerRefNo,
        amount: parentIncome,
        upgrade: true,
        guard: params.guard,
        postings: [
          {
            orderNo: ledgerRefNo,
            userId: parent.user_id,
            beneficiaryAgentId: parent.id,
            sourceAgentId: childAgentId,
            hopDistance: 1,
            rewardType: 'tier_upgrade_fee',
            amount: parentIncome,
            revenue: 0,
            walletNote: `直属下级分站「@${childSlug}」开通/升级「${tierName}」开户费入账`,
            note,
          },
        ],
      });

  if (result.amount === null) throw new Error(`代理升级分润未提交（${ledgerRefNo}）`);
  return {
    parentIncome: result.amount,
    platformCut: Number((feeAmount - result.amount).toFixed(2)),
    platformFeePct,
  };
}

/** 统一分发平台代收订单的分润结算（私有商品强制分站直收，严禁进入主站资金流水与钱包结算） */
export async function settleOrderProfitDispatch(params: {
  env: Env;
  orderNo: string;
  productOwnerAgentId: number;
  buyerWholesaleAgentId: number;
  sellingAgentId: number;
  baseMainTotal: number;
  totalAmount: number;
  guard?: SQL;
}): Promise<number> {
  // 反洗钱合规红线：分站私有商品资金不经主站收款账户，绝不向平台钱包或代理余额入账
  if (params.productOwnerAgentId > 0) {
    return 0;
  }
  if (params.buyerWholesaleAgentId > 0) {
    const settled = await settleRecursiveOrderProfits({
      env: params.env,
      orderNo: params.orderNo,
      sellingAgentId: params.buyerWholesaleAgentId,
      baseMainTotal: params.baseMainTotal,
      totalAmount: params.totalAmount,
      mode: 'b2b_api',
      guard: params.guard,
    });
    return settled.totalSettledToChain;
  }
  if (params.sellingAgentId > 0) {
    const settled = await settleRecursiveOrderProfits({
      env: params.env,
      orderNo: params.orderNo,
      sellingAgentId: params.sellingAgentId,
      baseMainTotal: params.baseMainTotal,
      totalAmount: params.totalAmount,
      mode: 'retail',
      guard: params.guard,
    });
    return settled.totalSettledToChain;
  }
  return 0;
}
