import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import type { AdminMembersQuery, UserAccountStatus } from '@shared/index';
import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import {
  agents,
  orders,
  promoTransactions,
  rechargeRecords,
  userLoginLogs,
  userSessions,
  users,
  walletTransactions,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

/** 分页查询全站会员列表及关联分站、代理身份与消费统计（100% Drizzle ORM） */
export async function queryAdminMembersRepo(db: AppDatabase, query: AdminMembersQuery) {
  const q = (query.q || '').trim().toLowerCase();
  const roleCond = query.role !== 'all' ? eq(users.role, query.role) : undefined;
  const statusCond = query.status !== 'all' ? eq(users.status, query.status) : undefined;
  const searchCond = q
    ? or(like(sql`lower(${users.email})`, `%${q}%`), like(sql`lower(${users.displayName})`, `%${q}%`))
    : undefined;
  const whereCond = and(roleCond, statusCond, searchCond);
  const offset = (query.page - 1) * query.page_size;

  const [rows, countRows, summaryRows] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        statusNote: users.statusNote,
        siteAgentId: users.siteAgentId,
        balance: users.balance,
        promoBalance: users.promoBalance,
        totalRecharged: users.totalRecharged,
        createdAt: users.createdAt,
        agentId: agents.id,
        agentSlug: agents.slug,
        agentBrand: agents.brandName,
        agentStatus: agents.status,
      })
      .from(users)
      .leftJoin(agents, eq(agents.userId, users.id))
      .where(whereCond)
      .orderBy(desc(users.id))
      .limit(query.page_size)
      .offset(offset),
    db.select({ total: sql<number>`count(*)` }).from(users).where(whereCond),
    db
      .select({
        totalUsers: sql<number>`count(*)`,
        agentUsers: sql<number>`COUNT(CASE WHEN ${users.role} = 'agent' THEN 1 END)`,
        normalUsers: sql<number>`COUNT(CASE WHEN ${users.role} = 'user' THEN 1 END)`,
        totalBalance: sql<number>`COALESCE(ROUND(SUM(${users.balance}), 2), 0)`,
        totalPromoBalance: sql<number>`COALESCE(ROUND(SUM(${users.promoBalance}), 2), 0)`,
      })
      .from(users),
  ]);

  const userIds = rows.map((r) => r.id);
  const siteAgentIds = [...new Set(rows.map((r) => r.siteAgentId).filter((id) => id > 0))];

  const [orderStatsRows, siteRows] = await Promise.all([
    userIds.length > 0
      ? db
          .select({
            userId: orders.userId,
            orderCount: sql<number>`count(*)`,
            totalSpent: sql<number>`COALESCE(ROUND(SUM(${orders.totalAmount}), 2), 0)`,
          })
          .from(orders)
          .where(and(inArray(orders.userId, userIds), inArray(orders.status, RECOGNIZED_ORDER_STATUSES)))
          .groupBy(orders.userId)
      : Promise.resolve([]),
    siteAgentIds.length > 0
      ? db
          .select({ id: agents.id, slug: agents.slug, brandName: agents.brandName })
          .from(agents)
          .where(inArray(agents.id, siteAgentIds))
      : Promise.resolve([]),
  ]);

  const orderStatMap = new Map(
    orderStatsRows.map((o) => [
      Number(o.userId),
      { orderCount: Number(o.orderCount || 0), totalSpent: Number(o.totalSpent || 0) },
    ])
  );
  const siteMap = new Map(siteRows.map((s) => [s.id, { slug: s.slug, brand: s.brandName }]));

  const items = rows.map((r) => {
    const stat = orderStatMap.get(r.id);
    const site = r.siteAgentId > 0 ? siteMap.get(r.siteAgentId) : null;
    return {
      id: r.id,
      email: r.email,
      display_name: r.displayName,
      role: r.role,
      status: r.status || 'active',
      status_note: r.statusNote || '',
      site_agent_id: r.siteAgentId,
      site_slug: site?.slug ?? null,
      site_brand: site?.brand ?? null,
      agent_id: r.agentId ?? null,
      agent_slug: r.agentSlug ?? null,
      agent_brand: r.agentBrand ?? null,
      agent_status: r.agentStatus ?? null,
      balance: Number(r.balance || 0),
      promo_balance: Number(r.promoBalance || 0),
      total_recharged: Number(r.totalRecharged || 0),
      order_count: stat?.orderCount ?? 0,
      total_spent: stat?.totalSpent ?? 0,
      created_at: r.createdAt,
    };
  });

  const sum = summaryRows[0];
  return {
    items,
    total: Number(countRows[0]?.total || 0),
    page: query.page,
    page_size: query.page_size,
    summary: {
      total_users: Number(sum?.totalUsers || 0),
      agent_users: Number(sum?.agentUsers || 0),
      normal_users: Number(sum?.normalUsers || 0),
      total_balance: Number(sum?.totalBalance || 0),
      total_promo_balance: Number(sum?.totalPromoBalance || 0),
    },
  };
}

/** 强制撤销指定会员的全部活跃登录会话并递增 sessionVersion */
export async function revokeMemberSessionsRepo(db: AppDatabase, userId: number): Promise<void> {
  await db.batch([
    db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId)),
    db.delete(userSessions).where(eq(userSessions.userId, userId)),
  ]);
}

/** 原子更新会员风控状态（冻结或拉黑时同步递增 sessionVersion 并立即清空全部活跃会话） */
export async function updateMemberStatusRepo(
  db: AppDatabase,
  userId: number,
  status: UserAccountStatus,
  statusNote: string
): Promise<void> {
  if (status === 'active') {
    await db.update(users).set({ status, statusNote }).where(eq(users.id, userId));
    return;
  }
  await db.batch([
    db
      .update(users)
      .set({ status, statusNote, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId)),
    db.delete(userSessions).where(eq(userSessions.userId, userId)),
  ]);
}

/** 检查会员是否存在不可物理删除的财务/订单/代理关联记录（保障全站资金守恒不被破坏） */
export async function countMemberFinancialBindingsRepo(db: AppDatabase, userId: number) {
  const [ordRows, wtRows, ptRows, rchRows, agRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(orders).where(eq(orders.userId, userId)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId)),
    db
      .select({ c: sql<number>`count(*)` })
      .from(promoTransactions)
      .where(eq(promoTransactions.userId, userId)),
    db.select({ c: sql<number>`count(*)` }).from(rechargeRecords).where(eq(rechargeRecords.userId, userId)),
    db.select({ c: sql<number>`count(*)` }).from(agents).where(eq(agents.userId, userId)),
  ]);
  return {
    orders: Number(ordRows[0]?.c || 0),
    walletTx: Number(wtRows[0]?.c || 0),
    promoTx: Number(ptRows[0]?.c || 0),
    recharges: Number(rchRows[0]?.c || 0),
    agents: Number(agRows[0]?.c || 0),
  };
}

/** 物理删除无财务关联的空/测试注册会员账号 */
export async function deleteCleanMemberRepo(db: AppDatabase, userId: number): Promise<void> {
  await db.batch([
    db.delete(userSessions).where(eq(userSessions.userId, userId)),
    db.delete(userLoginLogs).where(eq(userLoginLogs.userId, userId)),
    db.delete(users).where(eq(users.id, userId)),
  ]);
}
