import { RECOGNIZED_ORDER_STATUSES } from '@shared/domain/order-finance';
import { paymentPluginPublicFields, paymentPluginSecretFields } from '@shared/domain/payment-plugin-settings';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  agents,
  agentTiers,
  agentWithdrawals,
  announcements,
  categories,
  categoryGroups,
  coupons,
  helpArticles,
  mailOutbox,
  orders,
  paymentPlugins,
  productCards,
  products,
  productUpstreamBindings,
  rechargeCdks,
  rechargeRecords,
  restockSubscriptions,
  siteSettings,
  supportTickets,
  tenantDomains,
  ticketMessages,
  upstreamSources,
  users,
} from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { mapAgentRow, mapAgentTierRow } from '../auth/auth.repo';
import { mapProductRowToSnake } from '../storefront/storefront.repo';

/** 批量并行加载运营总控后台全量概览数据（100% Drizzle ORM + 并行 groupBy 消除相关子查询） */
export async function loadAdminOverviewRaw(db: AppDatabase) {
  const [
    settingsRows,
    groupRows,
    categoryRows,
    productRows,
    orderRows,
    agentRows,
    agentTierRows,
    announcementRows,
    helpArticleRows,
    paymentPluginRows,
    withdrawalRows,
    couponRows,
    cdkRows,
    ticketRows,
    ticketMsgCountRows,
    restockRows,
    cardCountRows,
    bindingCountRows,
    statsRows,
    upgradeStatsRows,
    upExcRows,
  ] = await Promise.all([
    db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings),
    db.select().from(categoryGroups).orderBy(asc(categoryGroups.sortOrder), asc(categoryGroups.id)),
    db
      .select()
      .from(categories)
      .where(eq(categories.ownerAgentId, 0))
      .orderBy(asc(categories.groupId), asc(categories.sortOrder), asc(categories.id)),
    db
      .select()
      .from(products)
      .where(eq(products.ownerAgentId, 0))
      .orderBy(asc(products.sortOrder), asc(products.id)),
    db
      .select({
        order: orders,
        upstreamSourceName: upstreamSources.name,
        mailStatus: sql<'pending' | 'sent' | 'disabled' | 'failed' | null>`(
          select ${mailOutbox.status} from ${mailOutbox}
          where ${mailOutbox.orderId} = ${orders.id} and ${mailOutbox.scene} in ('order_delivery', 'order_resend')
          order by ${mailOutbox.id} desc limit 1
        )`,
      })
      .from(orders)
      .leftJoin(upstreamSources, eq(upstreamSources.id, orders.upstreamSourceId))
      .orderBy(desc(orders.id))
      .limit(100),
    db
      .select({
        agent: agents,
        ownerEmail: users.email,
        ownerBalance: users.balance,
        totalRecharged: users.totalRecharged,
        tierName: agentTiers.name,
        tierDiscountRate: agentTiers.discountRate,
        primaryDomain: sql<string | null>`(
          select ${tenantDomains.hostname} from ${tenantDomains}
          where ${tenantDomains.agentId} = ${agents.id} and ${tenantDomains.status} = 'active'
          order by ${tenantDomains.isPrimary} desc, ${tenantDomains.id} asc limit 1
        )`,
        domainsCount: sql<number>`(
          select count(*) from ${tenantDomains}
          where ${tenantDomains.agentId} = ${agents.id}
        )`,
      })
      .from(agents)
      .innerJoin(users, eq(users.id, agents.userId))
      .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
      .orderBy(asc(agents.depth), desc(agents.id)),
    db
      .select()
      .from(agentTiers)
      .where(eq(agentTiers.ownerAgentId, 0))
      .orderBy(asc(agentTiers.levelRank), asc(agentTiers.minRecharge)),
    db
      .select()
      .from(announcements)
      .where(eq(announcements.ownerAgentId, 0))
      .orderBy(desc(announcements.isPinned), desc(announcements.id)),
    db
      .select()
      .from(helpArticles)
      .where(eq(helpArticles.ownerAgentId, 0))
      .orderBy(asc(helpArticles.sortOrder), asc(helpArticles.id)),
    db.select().from(paymentPlugins).orderBy(asc(paymentPlugins.id)),
    db
      .select({
        w: agentWithdrawals,
        agentSlug: agents.slug,
        agentBrand: agents.brandName,
        ownerEmail: users.email,
      })
      .from(agentWithdrawals)
      .leftJoin(agents, eq(agents.id, agentWithdrawals.agentId))
      .leftJoin(users, eq(users.id, agentWithdrawals.userId))
      .orderBy(
        sql`CASE WHEN ${agentWithdrawals.status} = 'pending' THEN 0 ELSE 1 END`,
        desc(agentWithdrawals.id)
      )
      .limit(100),
    db.select().from(coupons).where(eq(coupons.ownerAgentId, 0)).orderBy(desc(coupons.id)).limit(100),
    db.select().from(rechargeCdks).orderBy(desc(rechargeCdks.id)).limit(120),
    db
      .select({
        ticket: supportTickets,
        siteSlug: agents.slug,
        siteBrand: agents.brandName,
      })
      .from(supportTickets)
      .leftJoin(agents, eq(agents.id, supportTickets.siteAgentId))
      .orderBy(
        sql`CASE WHEN ${supportTickets.status} IN ('open', 'escalated') THEN 0 ELSE 1 END`,
        desc(supportTickets.updatedAt)
      )
      .limit(100),
    db
      .select({ ticketId: ticketMessages.ticketId, c: sql<number>`count(*)` })
      .from(ticketMessages)
      .groupBy(ticketMessages.ticketId),
    db
      .select({ productId: restockSubscriptions.productId, waiting: sql<number>`count(*)` })
      .from(restockSubscriptions)
      .where(eq(restockSubscriptions.status, 'waiting'))
      .groupBy(restockSubscriptions.productId),
    db
      .select({ productId: productCards.productId, available: sql<number>`count(*)` })
      .from(productCards)
      .where(eq(productCards.status, 'available'))
      .groupBy(productCards.productId),
    db
      .select({
        productId: productUpstreamBindings.productId,
        cnt: sql<number>`count(*)`,
        upStock: sql<number>`COALESCE(SUM(${productUpstreamBindings.cachedStock}), 0)`,
      })
      .from(productUpstreamBindings)
      .where(eq(productUpstreamBindings.isEnabled, 1))
      .groupBy(productUpstreamBindings.productId),
    // 统计主站历史总单数与有效已付 GMV（GMV 严格剔除未付款、已过期、已退款与分站私有商品）
    db
      .select({
        totalOrders: sql<number>`count(*)`,
        totalGmv: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} IN (${sql.join(
          RECOGNIZED_ORDER_STATUSES.map((st) => sql`${st}`),
          sql`, `
        )}) THEN ${orders.totalAmount} ELSE 0 END), 0)`,
      })
      .from(orders)
      .where(eq(orders.productOwnerAgentId, 0)),
    // 代理开户/升级费总流水
    db
      .select({
        upgradeTotal: sql<number>`COALESCE(SUM(${rechargeRecords.amount}), 0)`,
      })
      .from(rechargeRecords),
    db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(inArray(orders.status, ['upstream_pending', 'fulfillment_failed'])),
  ]);

  const slugByAgentId = new Map(agentRows.map((r) => [r.agent.id, r.agent.slug]));
  const downlineCountByAgentId = new Map<number, number>();
  for (const r of agentRows) {
    const ancestors = String(r.agent.ancestorPath || '')
      .split('/')
      .filter(Boolean)
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0 && id !== r.agent.id);
    for (const ancId of ancestors) {
      downlineCountByAgentId.set(ancId, (downlineCountByAgentId.get(ancId) ?? 0) + 1);
    }
  }

  const msgCountMap = new Map(ticketMsgCountRows.map((r) => [r.ticketId, Number(r.c || 0)]));

  return {
    settingsRows,
    groups: groupRows.map((g) => ({
      id: g.id,
      slug: g.slug,
      name: g.name,
      name_en: g.nameEn,
      sort_order: g.sortOrder,
      is_active: g.isActive,
    })),
    categories: categoryRows.map((c) => ({
      id: c.id,
      group_id: c.groupId,
      slug: c.slug,
      name: c.name,
      name_en: c.nameEn,
      icon: c.icon,
      badge_text: c.badgeText,
      schema_type: c.schemaType,
      sort_order: c.sortOrder,
      is_active: c.isActive,
    })),
    products: productRows.map((p) => ({
      ...mapProductRowToSnake(p),
      upstream_source_id: p.upstreamSourceId,
      upstream_item_id: p.upstreamItemId,
      upstream_cost: p.upstreamCost,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    })),
    orders: orderRows.map(({ order: o, upstreamSourceName, mailStatus }) => ({
      id: o.id,
      order_no: o.orderNo,
      public_order_no: o.publicOrderNo,
      mail_status: mailStatus,
      user_id: o.userId,
      agent_id: o.agentId,
      tenant_slug: o.tenantSlug,
      contact_email: o.contactEmail,
      product_id: o.productId,
      product_title: o.productTitle,
      spec_id: o.specId,
      spec_name: o.specName,
      quantity: o.quantity,
      unit_price: o.unitPrice,
      total_amount: o.totalAmount,
      discount_amount: o.discountAmount,
      coupon_code: o.couponCode,
      coupon_discount: o.couponDiscount,
      commission_amount: o.commissionAmount,
      payment_method: o.paymentMethod,
      channel: o.channel,
      status: o.status,
      fulfillment_source: o.fulfillmentSource,
      upstream_source_id: o.upstreamSourceId,
      upstream_order_no: o.upstreamOrderNo,
      upstream_cost_total: o.upstreamCostTotal,
      upstream_status: o.upstreamStatus,
      upstream_error: o.upstreamError,
      warranty_type: o.warrantyType,
      warranty_days: o.warrantyDays,
      warranty_summary: o.warrantySummary,
      created_at: o.createdAt,
      upstream_source_name: upstreamSourceName,
    })),
    agents: agentRows.map((r) => ({
      ...mapAgentRow(r.agent),
      owner_email: r.ownerEmail,
      owner_balance: r.ownerBalance,
      total_recharged: r.totalRecharged,
      tier_name: r.tierName,
      tier_discount_rate: r.tierDiscountRate,
      parent_slug: r.agent.parentAgentId ? (slugByAgentId.get(r.agent.parentAgentId) ?? null) : null,
      downline_count: downlineCountByAgentId.get(r.agent.id) ?? 0,
      primary_domain: r.primaryDomain ?? null,
      domains_count: Number(r.domainsCount || 0),
    })),
    agentTiers: agentTierRows.map(mapAgentTierRow),
    announcements: announcementRows.map((a) => ({
      id: a.id,
      owner_agent_id: a.ownerAgentId,
      audience: a.audience,
      title: a.title,
      title_en: a.titleEn,
      content: a.content,
      content_en: a.contentEn,
      translations_json: a.translationsJson,
      level: a.level,
      is_pinned: a.isPinned,
      is_active: a.isActive,
      created_at: a.createdAt,
    })),
    helpArticles: helpArticleRows.map((h) => ({
      id: h.id,
      category: h.category,
      title: h.title,
      title_en: h.titleEn,
      content: h.content,
      content_en: h.contentEn,
      translations_json: h.translationsJson,
      sort_order: h.sortOrder,
      is_active: h.isActive,
      created_at: h.createdAt,
    })),
    paymentPlugins: paymentPluginRows.map((p) => {
      const config = safeJsonParse<Record<string, unknown> | null>(p.configJson, {}) ?? {};
      const publicFields = paymentPluginPublicFields[p.id];
      const secretFields = paymentPluginSecretFields[p.id];
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        config_json: JSON.stringify(
          Object.fromEntries(
            (Array.isArray(publicFields) ? publicFields : []).map((field) => [
              field,
              field === 'channels' && Array.isArray(config[field])
                ? config[field].filter((channel) => typeof channel === 'string')
                : ['string', 'number', 'boolean'].includes(typeof config[field])
                  ? config[field]
                  : '',
            ])
          )
        ),
        secrets_configured: Object.fromEntries(
          (Array.isArray(secretFields) ? secretFields : []).map((field) => [
            field,
            typeof config[field] === 'string' && Boolean(config[field].trim()),
          ])
        ),
        updated_at: p.updatedAt,
      };
    }),
    withdrawals: withdrawalRows.map(({ w, agentSlug, agentBrand, ownerEmail }) => ({
      id: w.id,
      agent_id: w.agentId,
      user_id: w.userId,
      amount: w.amount,
      fee_rate: Number(w.feeRate || 0),
      fee_amount: Number(w.feeAmount || 0),
      net_amount:
        w.netAmount > 0 ? Number(w.netAmount) : Number((w.amount - Number(w.feeAmount || 0)).toFixed(2)),
      channel: w.channel,
      account_info: w.accountInfo,
      account_name: w.accountName,
      status: w.status,
      admin_note: w.adminNote,
      created_at: w.createdAt,
      processed_at: w.processedAt,
      agent_slug: agentSlug,
      agent_brand: agentBrand,
      owner_email: ownerEmail,
    })),
    coupons: couponRows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      discount_type: c.discountType,
      discount_value: c.discountValue,
      min_order_amount: c.minOrderAmount,
      max_uses: c.maxUses,
      used_count: c.usedCount,
      expires_at: c.expiresAt,
      is_active: c.isActive,
      created_at: c.createdAt,
    })),
    cdks: cdkRows.map((c) => ({
      id: c.id,
      code: c.code,
      amount: c.amount,
      status: c.status,
      batch_note: c.batchNote,
      used_by_user_id: c.usedByUserId,
      used_by_email: c.usedByEmail,
      used_at: c.usedAt,
      created_at: c.createdAt,
    })),
    tickets: ticketRows.map(({ ticket: t, siteSlug, siteBrand }) => ({
      id: t.id,
      ticket_no: t.ticketNo,
      site_agent_id: t.siteAgentId,
      user_id: t.userId,
      contact_email: t.contactEmail,
      order_no: t.orderNo,
      category: t.category,
      subject: t.subject,
      status: t.status,
      escalated_to_admin: t.escalatedToAdmin,
      created_at: t.createdAt,
      updated_at: t.updatedAt,
      site_slug: siteSlug,
      site_brand: siteBrand,
      message_count: msgCountMap.get(t.id) ?? 0,
    })),
    restockMap: new Map(restockRows.map((r) => [r.productId, Number(r.waiting || 0)])),
    cardMap: new Map(cardCountRows.map((r) => [r.productId, Number(r.available || 0)])),
    bindingMap: new Map(
      bindingCountRows.map((r) => [
        r.productId,
        { cnt: Number(r.cnt || 0), up_stock: Number(r.upStock || 0) },
      ])
    ),
    stats: {
      totalOrders: Number(statsRows[0]?.totalOrders || 0),
      productGmv: Number(statsRows[0]?.totalGmv || 0),
      agentUpgradeTotal: Number(upgradeStatsRows[0]?.upgradeTotal || 0),
      totalGmv: Number(statsRows[0]?.totalGmv || 0) + Number(upgradeStatsRows[0]?.upgradeTotal || 0),
      upstreamExceptions: Number(upExcRows[0]?.c || 0),
    },
  };
}
