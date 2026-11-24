import { and, desc, eq, or, sql } from 'drizzle-orm';
import { orders, users } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import type { ActiveAgentContext } from './agent.guard';

/** 分站独立订单检索（严格按 agent_id = ctx.agent.id 租户隔离） */
export async function searchAgentOrders(
  env: Env,
  ctx: ActiveAgentContext,
  query: { q: string; status: string; page: number; limit: number }
) {
  const db = createDb(env.DB);
  const conds = [eq(orders.agentId, ctx.agent.id)];
  if (query.q) {
    const pat = `%${query.q.toLowerCase()}%`;
    const searchCond = or(
      sql`lower(${orders.orderNo}) LIKE ${pat}`,
      sql`lower(${orders.publicOrderNo}) LIKE ${pat}`,
      sql`lower(${orders.contactEmail}) LIKE ${pat}`,
      sql`lower(${orders.productTitle}) LIKE ${pat}`
    );
    if (searchCond) conds.push(searchCond);
  }
  if (query.status && query.status !== 'all') {
    conds.push(eq(orders.status, query.status));
  }

  const whereClause = and(...conds);
  const offset = (query.page - 1) * query.limit;
  const [countRows, rows] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(orders).where(whereClause),
    db.select().from(orders).where(whereClause).orderBy(desc(orders.id)).limit(query.limit).offset(offset),
  ]);

  return {
    total: Number(countRows[0]?.c || 0),
    page: query.page,
    limit: query.limit,
    items: rows.map((o) => ({
      id: o.id,
      order_no: o.orderNo,
      public_order_no: o.publicOrderNo,
      product_title: o.productTitle,
      spec_name: o.specName,
      quantity: o.quantity,
      total_amount: o.totalAmount,
      payment_fee_amount: Number(o.paymentFeeAmount || 0),
      commission_amount: o.commissionAmount,
      contact_email: o.contactEmail,
      payment_method: o.paymentMethod,
      settlement_mode: o.settlementMode,
      status: o.status,
      is_private_product: Number(o.productOwnerAgentId || 0) === ctx.agent.id,
      created_at: o.createdAt,
    })),
  };
}

/** 分站本店注册会员列表（只读，严格按 site_agent_id = ctx.agent.id 隔离） */
export async function listAgentStoreMembers(
  env: Env,
  ctx: ActiveAgentContext,
  query: { q: string; page: number; limit: number }
) {
  const db = createDb(env.DB);
  const conds = [eq(users.siteAgentId, ctx.agent.id)];
  if (query.q) {
    const pat = `%${query.q.toLowerCase()}%`;
    const searchCond = or(
      sql`lower(${users.email}) LIKE ${pat}`,
      sql`lower(${users.displayName}) LIKE ${pat}`
    );
    if (searchCond) conds.push(searchCond);
  }
  const whereClause = and(...conds);
  const offset = (query.page - 1) * query.limit;

  const [countRows, memberRows, orderStats] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(users).where(whereClause),
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.id))
      .limit(query.limit)
      .offset(offset),
    db
      .select({
        userId: orders.userId,
        orderCount: sql<number>`count(*)`,
        totalSpent: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN ('paid','delivered','upstream_pending') THEN ${orders.totalAmount} ELSE 0 END), 0)`,
      })
      .from(orders)
      .where(eq(orders.agentId, ctx.agent.id))
      .groupBy(orders.userId),
  ]);

  const statMap = new Map(
    orderStats
      .filter((s) => s.userId !== null)
      .map((s) => [Number(s.userId), { count: Number(s.orderCount || 0), spent: Number(s.totalSpent || 0) }])
  );

  return {
    total: Number(countRows[0]?.c || 0),
    page: query.page,
    limit: query.limit,
    items: memberRows.map((m) => {
      const st = statMap.get(m.id);
      return {
        id: m.id,
        email: m.email,
        display_name: m.displayName,
        status: m.status || 'active',
        order_count: st?.count ?? 0,
        total_spent: Number((st?.spent ?? 0).toFixed(2)),
        created_at: m.createdAt,
      };
    }),
  };
}
