import { discountDisplay } from '@shared/domain/money';
import { and, eq, exists, getTableColumns, isNull, notExists, type SQL, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { agents, agentTiers, commissionLedger, rechargeRecords, users } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import {
  accountCanPost,
  commitWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';
import type { AgentUpgradePlan } from './upgrade-plan.service';

/** 代理升级付款、累计金额与收款记录属于同一个资金事件。在线支付以原支付单号为键。 */
export async function postAgentUpgradePayment(
  db: AppDatabase,
  input: {
    refNo: string;
    amount: number;
    tierName: string;
    paymentMethod: string;
    plan: AgentUpgradePlan;
    fromBalance?: boolean;
    expectedTotal?: number;
    guard?: SQL;
    finish?: (owned: SQL) => BatchItem<'sqlite'>;
  }
) {
  const { refNo, amount, tierName, paymentMethod, fromBalance, expectedTotal, guard, plan } = input;
  const { user, agent, newAgent, tier, settlement, changeTier } = plan;
  const userId = user.id;
  if (
    amount <= 0 ||
    !Number.isFinite(amount) ||
    (expectedTotal !== undefined && expectedTotal !== user.totalRecharged)
  ) {
    return { applied: false, amount: null };
  }
  const payer = and(
    eq(users.id, userId),
    eq(users.totalRecharged, user.totalRecharged),
    eq(users.role, user.role)
  );
  const myAgent = db.select({ id: agents.id }).from(agents).where(eq(agents.userId, userId));
  const sameAgent = agent
    ? and(
        eq(agents.id, agent.id),
        eq(agents.status, agent.status),
        agent.tierId === null ? isNull(agents.tierId) : eq(agents.tierId, agent.tierId),
        agent.parentAgentId === null
          ? isNull(agents.parentAgentId)
          : eq(agents.parentAgentId, agent.parentAgentId)
      )
    : undefined;
  const parent = settlement?.parent;
  const activeParent = parent
    ? and(eq(agents.id, parent.id), eq(agents.userId, parent.userId), eq(agents.status, 'active'))
    : undefined;
  return commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('agent-upgrade-payment', refNo),
      amount,
      when: and(
        guard,
        accountCanPost(db, userId, fromBalance ? -amount : amount),
        exists(db.select({ id: users.id }).from(users).where(payer)),
        sameAgent ? exists(db.select({ id: agents.id }).from(agents).where(sameAgent)) : notExists(myAgent),
        activeParent ? exists(db.select({ id: agents.id }).from(agents).where(activeParent)) : undefined,
        settlement ? accountCanPost(db, settlement.parent.userId, settlement.parentIncome) : undefined
      ),
    },
    (owned) => [
      ...(fromBalance
        ? walletPosting(db, owned, {
            userId,
            amount: -amount,
            type: 'agent_upgrade',
            refNo,
            note: `余额开通或升级代理等级「${tierName}」`,
          })
        : []),
      db
        .update(users)
        .set({
          totalRecharged: plan.nextTotalRecharged,
          ...(newAgent && user.role === 'user' ? { role: 'agent' } : {}),
        })
        .where(and(payer, owned)),
      db.insert(rechargeRecords).select(sql`
      select null, ${userId}, ${amount}, ${paymentMethod}, ${tierName}, datetime('now') where ${owned}
    `),
      ...(newAgent && tier
        ? [
            db.insert(agents).select(sql`
        select ${insertColumns(agents, { ...newAgent, tierId: tier.id })} where ${owned}
      `),
            ...(tier.discount_rate <= 0.94
              ? [starterDownlineTier(db, owned, userId, tier.discount_rate)]
              : []),
          ]
        : []),
      ...(agent && changeTier && tier
        ? [db.update(agents).set({ tierId: tier.id }).where(and(sameAgent, owned))]
        : []),
      ...(settlement && settlement.parentIncome > 0
        ? [
            ...walletPosting(db, owned, {
              userId: settlement.parent.userId,
              amount: settlement.parentIncome,
              type: 'commission',
              refNo,
              note: `直属下级分站开通或升级「${tierName}」开户费入账`,
            }),
            db
              .update(agents)
              .set({
                totalCommission: sql`round(${agents.totalCommission} + ${settlement.parentIncome}, 2)`,
              })
              .where(and(activeParent, owned)),
            db.insert(commissionLedger).select(sql`
        select null, ${refNo}, ${settlement.parent.id}, (${myAgent}), 1, 'tier_upgrade_fee', ${settlement.parentIncome},
        ${`直属下级开通或升级「${tierName}」，平台抽成 ${settlement.platformFeePct}%`}, datetime('now') where ${owned}
      `),
          ]
        : []),
      ...(input.finish ? [input.finish(owned)] : []),
    ]
  );
}

function starterDownlineTier(db: AppDatabase, owned: SQL, userId: number, currentDiscount: number) {
  const childDiscount = Number(Math.min(0.96, currentDiscount + 0.06).toFixed(2));
  const perks = JSON.stringify([
    `享 ${discountDisplay(childDiscount).zhFold} 折拿货价，独立品牌分站自由定价`,
    '支持自定义上下架商品、改写图文说明与绑定独立域名',
    '赠送 B2B 批采 API Key，可继续发展下级分站',
  ]);
  return db.insert(agentTiers).select(sql`
    select ${insertColumns(agentTiers, {
      ownerAgentId: agents.id.getSQL(),
      code: 'starter',
      name: '合作分站伙伴',
      minRecharge: 199,
      discountRate: childDiscount,
      maxSubAgents: 50,
      badgeColor: '#D97757',
      perksJson: perks,
    })}
    from ${agents} where ${agents.userId} = ${userId} and ${owned}
  `);
}

/** 补齐 INSERT SELECT 省略字段的 schema 默认值，使批次可按本次事件条件插入。 */
function insertColumns<T extends SQLiteTable>(
  table: T,
  values: { [K in keyof T['$inferInsert']]?: T['$inferInsert'][K] | SQL }
) {
  const columns = Object.entries(getTableColumns(table));
  return sql.join(
    columns.map(
      ([key, column]) =>
        sql`${
          Object.hasOwn(values, key)
            ? (values[key as keyof typeof values] ?? null)
            : (column.default ?? sql`null`)
        }`
    ),
    sql`, `
  );
}
