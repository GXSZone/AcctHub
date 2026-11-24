import { discountDisplay } from '@shared/domain/money';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import {
  type AgentRow,
  type AgentTierRow,
  agents,
  agentTiers,
  type UserRow,
  userLoginLogs,
  users,
  walletTransactions,
} from '../../db/schema/index';
import type { AgentTier, AuthUser } from '../../db/types';
import type { Env } from '../../env';
import { decryptSecret } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';

/** 将 Drizzle AgentTierRow 映射为既有 REST API 蛇形结构 */
export function mapAgentTierRow(row: AgentTierRow): AgentTier {
  return {
    id: row.id,
    owner_agent_id: row.ownerAgentId,
    code: row.code,
    name: row.name,
    level_rank: row.levelRank,
    min_recharge: row.minRecharge,
    discount_rate: row.discountRate,
    commission_rate: row.commissionRate,
    sub_override_rate: row.subOverrideRate,
    max_sub_agents: row.maxSubAgents,
    badge_color: row.badgeColor,
    perks_json: row.perksJson,
    allow_custom_domain: row.allowCustomDomain,
    max_custom_domains: row.maxCustomDomains,
    allow_private_products: row.allowPrivateProducts,
    allow_own_payment: row.allowOwnPayment,
  };
}

/** 将 Drizzle AgentRow 映射为既有 REST API 蛇形结构，保持前后端 100% 兼容 */
export function mapAgentRow(row: AgentRow, plainApiKey?: string) {
  return {
    id: row.id,
    user_id: row.userId,
    tier_id: row.tierId,
    parent_agent_id: row.parentAgentId,
    depth: row.depth,
    ancestor_path: row.ancestorPath,
    can_recruit: row.canRecruit,
    slug: row.slug,
    brand_name: row.brandName,
    brand_tagline: row.brandTagline,
    support_label: row.supportLabel,
    support_url: row.supportUrl,
    support_note: row.supportNote,
    support_media_json: row.supportMediaJson,
    support_links_json: row.supportLinksJson,
    announcement_banner: row.announcementBanner,
    ticker_enabled: row.tickerEnabled,
    ticker_mode: row.tickerMode,
    ticker_include_notices: row.tickerIncludeNotices,
    popup_enabled: row.popupEnabled,
    popup_title: row.popupTitle,
    popup_content: row.popupContent,
    popup_frequency: row.popupFrequency,
    popup_version: row.popupVersion,
    downline_popup_enabled: row.downlinePopupEnabled,
    downline_popup_title: row.downlinePopupTitle,
    downline_popup_content: row.downlinePopupContent,
    downline_popup_frequency: row.downlinePopupFrequency,
    downline_popup_version: row.downlinePopupVersion,
    api_ip_whitelist: row.apiIpWhitelist,
    markup_percent: row.markupPercent,
    commission_rate: row.commissionRate,
    api_key: plainApiKey ?? '',
    status: row.status,
    theme_accent: row.themeAccent,
    favicon_url: row.faviconUrl,
    og_image_url: row.ogImageUrl,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    footer_text: row.footerText,
    total_revenue: row.totalRevenue,
    total_commission: row.totalCommission,
    allow_private_products_override: row.allowPrivateProductsOverride,
    allow_own_payment_override: row.allowOwnPaymentOverride,
    created_at: row.createdAt,
  };
}

/** 解密代理专属 B2B API Key 并映射为仅限代理本人查看的完整视图 */
export async function mapAgentRowWithSecret(env: Env, row: AgentRow) {
  const plainKey =
    row.status === 'active' && row.apiKeyHash && row.apiKeyEnc
      ? await decryptSecret(env, row.apiKeyEnc).catch(() => '')
      : '';
  return mapAgentRow(row, plainKey);
}

/** 将 Drizzle UserRow 映射为既有 AuthUser DTO */
export function mapAuthUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    site_agent_id: row.siteAgentId,
    email: row.email,
    display_name: row.displayName,
    role: row.role as AuthUser['role'],
    balance: row.balance,
    total_recharged: row.totalRecharged,
    referral_code: row.referralCode ?? null,
    promo_balance: Number(row.promoBalance ?? 0),
  };
}

export async function findUserBySiteEmail(
  db: AppDatabase,
  siteAgentId: number,
  email: string
): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.siteAgentId, siteAgentId), eq(users.email, email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByIdAndEmail(
  db: AppDatabase,
  userId: number,
  email: string
): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), sql`lower(${users.email}) = ${email.toLowerCase()}`))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(db: AppDatabase, userId: number): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createUserRecord(
  db: AppDatabase,
  input: {
    siteAgentId: number;
    email: string;
    displayName: string;
    passwordHash: string;
    role: string;
    balance: number;
    referralCode?: string | null;
    referredByUserId?: number | null;
  }
): Promise<number> {
  const inserted = await db
    .insert(users)
    .values({
      siteAgentId: input.siteAgentId,
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: input.role,
      balance: input.balance,
      referralCode: input.referralCode ?? null,
      referredByUserId: input.referredByUserId ?? null,
    })
    .returning({ id: users.id });
  return inserted[0].id;
}

export async function incrementUserBalance(
  db: AppDatabase,
  userId: number,
  amount: number
): Promise<{ balance: number; totalRecharged: number } | null> {
  await db
    .update(users)
    .set({ balance: sql`round(${users.balance} + ${amount}, 2)` })
    .where(eq(users.id, userId));
  const rows = await db
    .select({ balance: users.balance, totalRecharged: users.totalRecharged })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateUserRole(db: AppDatabase, userId: number, role: string): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function insertWalletTxRecord(
  db: AppDatabase,
  input: { userId: number; type: string; amount: number; balanceAfter: number; refNo?: string; note: string }
): Promise<void> {
  await db.insert(walletTransactions).values({
    userId: input.userId,
    type: input.type,
    amount: input.amount,
    balanceAfter: input.balanceAfter,
    refNo: input.refNo ?? '',
    note: input.note,
  });
}

export async function insertLoginAuditLog(
  db: AppDatabase,
  userId: number,
  ip: string,
  userAgent: string
): Promise<void> {
  await db.insert(userLoginLogs).values({ userId, ip, userAgent });
}

export async function findAgentByUserId(db: AppDatabase, userId: number): Promise<AgentRow | null> {
  const rows = await db.select().from(agents).where(eq(agents.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function findActiveAgentById(db: AppDatabase, id: number): Promise<AgentRow | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveAgentBySlug(db: AppDatabase, slug: string): Promise<AgentRow | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug.trim().toLowerCase()), eq(agents.status, 'active')))
    .limit(1);
  return rows[0] ?? null;
}

export async function existsAgentBySlug(db: AppDatabase, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(sql`lower(${agents.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  return rows.length > 0;
}

export async function findAgentTierById(db: AppDatabase, tierId: number): Promise<AgentTierRow | null> {
  const rows = await db.select().from(agentTiers).where(eq(agentTiers.id, tierId)).limit(1);
  return rows[0] ?? null;
}

export async function findFallbackAgentTier(
  db: AppDatabase,
  ownerAgentId: number
): Promise<AgentTierRow | null> {
  const rows = await db
    .select()
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, ownerAgentId))
    .orderBy(asc(agentTiers.levelRank))
    .limit(1);
  return rows[0] ?? null;
}

export async function findEligibleAgentTier(
  db: AppDatabase,
  ownerAgentId: number,
  totalRecharged: number,
  explicitTierId?: number | null
): Promise<AgentTierRow | null> {
  const threshold = totalRecharged + 0.001;
  if (explicitTierId) {
    const explicit = await db
      .select()
      .from(agentTiers)
      .where(
        and(
          eq(agentTiers.id, explicitTierId),
          eq(agentTiers.ownerAgentId, ownerAgentId),
          lte(agentTiers.minRecharge, threshold)
        )
      )
      .limit(1);
    if (explicit[0]) return explicit[0];
  }
  const highest = await db
    .select()
    .from(agentTiers)
    .where(and(eq(agentTiers.ownerAgentId, ownerAgentId), lte(agentTiers.minRecharge, threshold)))
    .orderBy(desc(agentTiers.levelRank), desc(agentTiers.minRecharge))
    .limit(1);
  return highest[0] ?? null;
}

export async function updateAgentTierId(db: AppDatabase, agentId: number, tierId: number): Promise<void> {
  await db.update(agents).set({ tierId }).where(eq(agents.id, agentId));
}

export async function createAgentRecord(
  db: AppDatabase,
  input: {
    userId: number;
    tierId: number;
    parentAgentId: number | null;
    depth: number;
    ancestorPath: string;
    slug: string;
    brandName: string;
    brandTagline: string;
    markupPercent: number;
    apiKey: string;
    apiKeyHash: string;
    apiKeyEnc: string;
  }
): Promise<number> {
  const inserted = await db
    .insert(agents)
    .values({
      userId: input.userId,
      tierId: input.tierId,
      parentAgentId: input.parentAgentId,
      depth: input.depth,
      ancestorPath: input.ancestorPath,
      canRecruit: 1,
      slug: input.slug,
      brandName: input.brandName,
      brandTagline: input.brandTagline,
      markupPercent: input.markupPercent,
      commissionRate: 0,
      apiKey: input.apiKey,
      apiKeyHash: input.apiKeyHash,
      apiKeyEnc: input.apiKeyEnc,
      status: 'active',
    })
    .returning({ id: agents.id });
  return inserted[0].id;
}

export async function seedStarterDownlineTier(
  db: AppDatabase,
  ownerAgentId: number,
  childDiscount: number
): Promise<void> {
  await db
    .insert(agentTiers)
    .values({
      ownerAgentId,
      code: 'starter',
      name: '合作分站伙伴',
      levelRank: 1,
      minRecharge: 199,
      discountRate: childDiscount,
      commissionRate: 0,
      subOverrideRate: 0,
      maxSubAgents: 50,
      badgeColor: '#D97757',
      perksJson: JSON.stringify([
        `享 ${discountDisplay(childDiscount).zhFold} 折拿货价，独立品牌分站自由定价`,
        '支持自定义上下架商品、改写图文说明与绑定独立域名',
        '赠送 B2B 批采 API Key，可继续发展下级分站',
      ]),
    })
    .onConflictDoNothing();
}

/** 全站黑名单联防：检查该邮箱在主站或任一分站是否已被拉黑 */
export async function isEmailBlacklisted(db: AppDatabase, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, normalized), eq(users.status, 'blacklisted')))
    .limit(1);
  return rows.length > 0;
}
