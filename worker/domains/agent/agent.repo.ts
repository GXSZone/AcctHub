import { and, asc, desc, eq, like, ne, sql } from 'drizzle-orm';
import {
  agentProductOverrides,
  agentProductPrices,
  agents,
  agentTiers,
  agentWithdrawals,
  commissionLedger,
  mailOutbox,
  orders,
  rechargeRecords,
  tenantDomains,
  users,
} from '../../db/schema/index';
import type { Env } from '../../env';
import type { AppDatabase } from '../../infra/db';
import type { OutboxStatus } from '../../infra/mail.outbox.repo';
import { mapAgentRow, mapAgentRowWithSecret, mapAgentTierRow } from '../auth/auth.repo';

export async function listAgentTiersByOwner(db: AppDatabase, ownerAgentId: number) {
  const rows = await db
    .select()
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, ownerAgentId))
    .orderBy(asc(agentTiers.levelRank), asc(agentTiers.minRecharge));
  return rows.map(mapAgentTierRow);
}

export async function findAgentTierByScope(
  db: AppDatabase,
  ownerAgentId: number,
  opts: { tierId?: number; tierCode?: string }
) {
  if (opts.tierId) {
    const rows = await db
      .select()
      .from(agentTiers)
      .where(and(eq(agentTiers.id, opts.tierId), eq(agentTiers.ownerAgentId, ownerAgentId)))
      .limit(1);
    return rows[0] ? mapAgentTierRow(rows[0]) : null;
  }
  if (opts.tierCode) {
    const rows = await db
      .select()
      .from(agentTiers)
      .where(and(eq(agentTiers.code, opts.tierCode), eq(agentTiers.ownerAgentId, ownerAgentId)))
      .limit(1);
    return rows[0] ? mapAgentTierRow(rows[0]) : null;
  }
  const rows = await db
    .select()
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, ownerAgentId))
    .orderBy(asc(agentTiers.levelRank), asc(agentTiers.minRecharge))
    .limit(1);
  return rows[0] ? mapAgentTierRow(rows[0]) : null;
}

export async function listUserRechargeRecords(db: AppDatabase, userId: number) {
  const rows = await db
    .select()
    .from(rechargeRecords)
    .where(eq(rechargeRecords.userId, userId))
    .orderBy(desc(rechargeRecords.id))
    .limit(20);
  return rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    amount: r.amount,
    payment_method: r.paymentMethod,
    unlocked_tier_name: r.unlockedTierName,
    created_at: r.createdAt,
  }));
}

export async function loadAgentWorkbenchData(db: AppDatabase, agentId: number) {
  const [recentOrdersRaw, directSubsRaw, allDownlinesCountRows, ledgerRaw, myTiers, withdrawalsRaw] =
    await Promise.all([
      db
        .select({
          id: orders.id,
          order_no: orders.orderNo,
          public_order_no: orders.publicOrderNo,
          user_id: orders.userId,
          agent_id: orders.agentId,
          tenant_slug: orders.tenantSlug,
          contact_email: orders.contactEmail,
          product_id: orders.productId,
          product_title: orders.productTitle,
          spec_id: orders.specId,
          spec_name: orders.specName,
          quantity: orders.quantity,
          unit_price: orders.unitPrice,
          total_amount: orders.totalAmount,
          discount_amount: orders.discountAmount,
          coupon_code: orders.couponCode,
          coupon_discount: orders.couponDiscount,
          commission_amount: orders.commissionAmount,
          payment_method: orders.paymentMethod,
          channel: orders.channel,
          status: orders.status,
          mail_status: sql<OutboxStatus | null>`(
            select ${mailOutbox.status} from ${mailOutbox}
            where ${mailOutbox.orderId} = ${orders.id}
              and ${mailOutbox.ownerAgentId} = ${orders.agentId}
              and ${mailOutbox.scene} in ('order_delivery', 'order_resend')
            order by ${mailOutbox.id} desc limit 1
          )`,
          created_at: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.agentId, agentId))
        .orderBy(desc(orders.id))
        .limit(30),
      db
        .select({
          id: agents.id,
          parent_agent_id: agents.parentAgentId,
          depth: agents.depth,
          slug: agents.slug,
          brand_name: agents.brandName,
          primary_domain: sql<string | null>`(
            SELECT ${tenantDomains.hostname} FROM ${tenantDomains}
            WHERE ${tenantDomains.agentId} = ${agents.id} AND ${tenantDomains.status} = 'active'
            ORDER BY ${tenantDomains.isPrimary} DESC, ${tenantDomains.id} ASC LIMIT 1
          )`,
          status: agents.status,
          tier_id: agents.tierId,
          total_revenue: agents.totalRevenue,
          total_commission: agents.totalCommission,
          created_at: agents.createdAt,
          owner_email: users.email,
          total_recharged: users.totalRecharged,
          tier_name: agentTiers.name,
          discount_rate: agentTiers.discountRate,
          sub_count: sql<number>`(SELECT COUNT(*) FROM agents d WHERE d.ancestor_path LIKE '%/' || ${agents.id} || '/%')`,
        })
        .from(agents)
        .innerJoin(users, eq(users.id, agents.userId))
        .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
        .where(eq(agents.parentAgentId, agentId))
        .orderBy(desc(agents.id))
        .limit(100),
      db
        .select({ c: sql<number>`count(*)` })
        .from(agents)
        .where(like(agents.ancestorPath, `%/${agentId}/%`)),
      db
        .select({
          id: commissionLedger.id,
          order_no: commissionLedger.orderNo,
          beneficiary_agent_id: commissionLedger.beneficiaryAgentId,
          source_agent_id: commissionLedger.sourceAgentId,
          hop_distance: commissionLedger.hopDistance,
          reward_type: commissionLedger.rewardType,
          amount: commissionLedger.amount,
          note: commissionLedger.note,
          created_at: commissionLedger.createdAt,
          source_slug: agents.slug,
          source_brand: agents.brandName,
        })
        .from(commissionLedger)
        .leftJoin(agents, eq(agents.id, commissionLedger.sourceAgentId))
        .where(eq(commissionLedger.beneficiaryAgentId, agentId))
        .orderBy(desc(commissionLedger.id))
        .limit(40),
      listAgentTiersByOwner(db, agentId),
      db
        .select()
        .from(agentWithdrawals)
        .where(eq(agentWithdrawals.agentId, agentId))
        .orderBy(desc(agentWithdrawals.id))
        .limit(30),
    ]);

  return {
    recentOrders: recentOrdersRaw,
    directSubs: directSubsRaw,
    totalDownlineCount: Number(allDownlinesCountRows[0]?.c ?? directSubsRaw.length),
    ledger: ledgerRaw,
    myTiers,
    withdrawals: withdrawalsRaw.map(mapWithdrawalRow),
  };
}

export function mapWithdrawalRow(w: typeof agentWithdrawals.$inferSelect) {
  const amount = Number(w.amount || 0);
  const feeAmount = Number(w.feeAmount || 0);
  const netAmount = w.netAmount > 0 ? Number(w.netAmount) : Number((amount - feeAmount).toFixed(2));
  return {
    id: w.id,
    agent_id: w.agentId,
    user_id: w.userId,
    amount,
    fee_rate: Number(w.feeRate || 0),
    fee_amount: feeAmount,
    net_amount: netAmount,
    channel: w.channel,
    account_info: w.accountInfo,
    account_name: w.accountName,
    status: w.status,
    admin_note: w.adminNote,
    created_at: w.createdAt,
    processed_at: w.processedAt,
  };
}

/** 读取主站配置的代理提现手续费比例（0–30%，默认 0%） */
export async function readAgentWithdrawalFeePct(db: AppDatabase): Promise<number> {
  const { siteSettings } = await import('../../db/schema/index');
  const row = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'agent_withdrawal_fee_pct'))
    .get();
  const pct = Number(row?.value ?? 0);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Number(Math.min(30, pct).toFixed(2));
}

/** CAS 原子累加用户累计充值额，防止并发重复升级向上级刷开户分润 */
export async function bumpUserTotalRechargedCas(
  db: AppDatabase,
  userId: number,
  amount: number,
  expectedCurrentPaid: number
): Promise<boolean> {
  const updated = await db
    .update(users)
    .set({ totalRecharged: sql`round(COALESCE(${users.totalRecharged}, 0) + ${amount}, 2)` })
    .where(
      and(eq(users.id, userId), sql`round(COALESCE(${users.totalRecharged}, 0), 2) = ${expectedCurrentPaid}`)
    )
    .returning({ id: users.id });
  return updated.length === 1;
}

export async function findAgentByIdMapped(db: AppDatabase, agentId: number, env?: Env) {
  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!rows[0]) return null;
  return env ? mapAgentRowWithSecret(env, rows[0]) : mapAgentRow(rows[0]);
}

export async function existsOtherAgentWithSlug(
  db: AppDatabase,
  slug: string,
  excludeAgentId?: number
): Promise<boolean> {
  const cond = excludeAgentId
    ? and(sql`lower(${agents.slug}) = ${slug.toLowerCase()}`, ne(agents.id, excludeAgentId))
    : sql`lower(${agents.slug}) = ${slug.toLowerCase()}`;
  const rows = await db.select({ id: agents.id }).from(agents).where(cond).limit(1);
  return rows.length > 0;
}

export async function updateAgentBrandRecord(
  db: AppDatabase,
  agentId: number,
  data: Partial<typeof agents.$inferInsert>
): Promise<void> {
  await db.update(agents).set(data).where(eq(agents.id, agentId));
}

export async function upsertAgentProductPriceRepo(
  db: AppDatabase,
  agentId: number,
  productId: number,
  specId: string,
  customPrice: number
): Promise<void> {
  await db
    .insert(agentProductPrices)
    .values({ agentId, productId, specId, customPrice })
    .onConflictDoUpdate({
      target: [agentProductPrices.agentId, agentProductPrices.productId, agentProductPrices.specId],
      set: { customPrice, updatedAt: sql`datetime('now')` },
    });
}

export async function deleteAgentProductPriceRepo(
  db: AppDatabase,
  agentId: number,
  productId?: number,
  specId?: string
): Promise<void> {
  if (productId !== undefined && specId !== undefined) {
    await db
      .delete(agentProductPrices)
      .where(
        and(
          eq(agentProductPrices.agentId, agentId),
          eq(agentProductPrices.productId, productId),
          eq(agentProductPrices.specId, specId)
        )
      );
    return;
  }
  await db.delete(agentProductPrices).where(eq(agentProductPrices.agentId, agentId));
}

export async function upsertAgentProductOverrideRepo(
  db: AppDatabase,
  input: {
    agentId: number;
    productId: number;
    isListed: number;
    customTitle: string | null;
    customSubtitle: string | null;
    customDetailMarkdown: string | null;
    customRiskNotice: string | null;
  }
): Promise<void> {
  await db
    .insert(agentProductOverrides)
    .values(input)
    .onConflictDoUpdate({
      target: [agentProductOverrides.agentId, agentProductOverrides.productId],
      set: {
        isListed: input.isListed,
        customTitle: input.customTitle,
        customSubtitle: input.customSubtitle,
        customDetailMarkdown: input.customDetailMarkdown,
        customRiskNotice: input.customRiskNotice,
        updatedAt: sql`datetime('now')`,
      },
    });
}

export async function resetAgentProductContentOverrideRepo(
  db: AppDatabase,
  agentId: number,
  productId: number
): Promise<void> {
  await db
    .update(agentProductOverrides)
    .set({
      customTitle: null,
      customSubtitle: null,
      customDetailMarkdown: null,
      customRiskNotice: null,
      updatedAt: sql`datetime('now')`,
    })
    .where(and(eq(agentProductOverrides.agentId, agentId), eq(agentProductOverrides.productId, productId)));
}
