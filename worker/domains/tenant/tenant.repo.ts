import type { TenantCapabilitiesDto } from '@shared/index';
import { eq, sql } from 'drizzle-orm';
import { agents, agentTiers, tenantDomains } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';
import { type GlobalSaasPolicy, getTenantSettingsMapRepo } from './tenant-settings.repo';

const tenantSelectCols = {
  id: agents.id,
  userId: agents.userId,
  tierId: agents.tierId,
  slug: agents.slug,
  brandName: agents.brandName,
  brandTagline: agents.brandTagline,
  supportLabel: agents.supportLabel,
  supportUrl: agents.supportUrl,
  supportNote: agents.supportNote,
  supportMediaJson: agents.supportMediaJson,
  supportLinksJson: agents.supportLinksJson,
  announcementBanner: agents.announcementBanner,
  tickerEnabled: agents.tickerEnabled,
  tickerMode: agents.tickerMode,
  tickerIncludeNotices: agents.tickerIncludeNotices,
  popupEnabled: agents.popupEnabled,
  popupTitle: agents.popupTitle,
  popupContent: agents.popupContent,
  popupFrequency: agents.popupFrequency,
  popupVersion: agents.popupVersion,
  markupPercent: agents.markupPercent,
  commissionRate: agents.commissionRate,
  themeAccent: agents.themeAccent,
  faviconUrl: agents.faviconUrl,
  ogImageUrl: agents.ogImageUrl,
  seoTitle: agents.seoTitle,
  seoDescription: agents.seoDescription,
  footerText: agents.footerText,
  status: agents.status,
  allowPrivateProductsOverride: agents.allowPrivateProductsOverride,
  allowOwnPaymentOverride: agents.allowOwnPaymentOverride,
  tierAllowCustomDomain: agentTiers.allowCustomDomain,
  tierMaxCustomDomains: agentTiers.maxCustomDomains,
  tierAllowPrivateProducts: agentTiers.allowPrivateProducts,
  tierAllowOwnPayment: agentTiers.allowOwnPayment,
};

export interface TenantAgentRecord {
  id: number;
  userId: number;
  tierId: number | null;
  slug: string;
  brandName: string;
  brandTagline: string;
  supportLabel: string;
  supportUrl: string;
  supportNote: string;
  supportMediaJson: string;
  supportLinksJson: string;
  announcementBanner: string;
  tickerEnabled: number;
  tickerMode: string;
  tickerIncludeNotices: number;
  popupEnabled: number;
  popupTitle: string;
  popupContent: string;
  popupFrequency: string;
  popupVersion: string;
  markupPercent: number;
  commissionRate: number;
  themeAccent: string;
  faviconUrl: string;
  ogImageUrl: string;
  seoTitle: string;
  seoDescription: string;
  footerText: string;
  status: string;
  allowPrivateProductsOverride: number | null;
  allowOwnPaymentOverride: number | null;
  tierAllowCustomDomain: number | null;
  tierMaxCustomDomains: number | null;
  tierAllowPrivateProducts: number | null;
  tierAllowOwnPayment: number | null;
}

export interface TenantDomainLookupResult {
  domainId: number;
  hostname: string;
  status: string;
  expiresAt: string | null;
  errorMessage: string;
  agent: TenantAgentRecord | null;
}

/** 按 hostname 精确查询 tenant_domains 授权记录并关联分站与等级 */
export async function findTenantDomainByHost(
  db: AppDatabase,
  host: string
): Promise<TenantDomainLookupResult | null> {
  const rows = await db
    .select({
      domainId: tenantDomains.id,
      hostname: tenantDomains.hostname,
      status: tenantDomains.status,
      expiresAt: tenantDomains.expiresAt,
      errorMessage: tenantDomains.errorMessage,
      agent: tenantSelectCols,
    })
    .from(tenantDomains)
    .leftJoin(agents, eq(agents.id, tenantDomains.agentId))
    .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
    .where(sql`lower(${tenantDomains.hostname}) = ${host.toLowerCase()}`)
    .limit(1);
  const hit = rows[0];
  if (!hit) return null;
  return {
    domainId: hit.domainId,
    hostname: hit.hostname,
    status: hit.status,
    expiresAt: hit.expiresAt,
    errorMessage: hit.errorMessage,
    agent: hit.agent?.id ? (hit.agent as TenantAgentRecord) : null,
  };
}

/** 按分站 Slug 精确查询分站及等级能力（不滤除 suspended 状态以阻断降级回主站） */
export async function findTenantBySlug(db: AppDatabase, slug: string): Promise<TenantAgentRecord | null> {
  const rows = await db
    .select(tenantSelectCols)
    .from(agents)
    .leftJoin(agentTiers, eq(agentTiers.id, agents.tierId))
    .where(sql`lower(${agents.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  return (rows[0] as TenantAgentRecord | undefined) ?? null;
}

/** 查询分站当前生效的主域名（用于生成跳转链接与 canonical SEO） */
export async function findPrimaryActiveHostname(db: AppDatabase, agentId: number): Promise<string | null> {
  const rows = await db
    .select({ hostname: tenantDomains.hostname, isPrimary: tenantDomains.isPrimary })
    .from(tenantDomains)
    .where(
      sql`${tenantDomains.agentId} = ${agentId} AND ${tenantDomains.status} = 'active' AND (${tenantDomains.expiresAt} IS NULL OR ${tenantDomains.expiresAt} > datetime('now'))`
    );
  if (rows.length === 0) return null;
  const primary = rows.find((r) => r.isPrimary === 1) ?? rows[0];
  return primary?.hostname ?? null;
}

/** 计算指定租户的有效能力集（合并主站全局开关 → 代理等级 → 单店覆写 → 站点展示设置） */
export async function resolveTenantCapabilities(
  db: AppDatabase,
  agent: TenantAgentRecord | null,
  policy: GlobalSaasPolicy
): Promise<TenantCapabilitiesDto> {
  const ownerId = agent ? agent.id : 0;
  const tSettings = await getTenantSettingsMapRepo(db, ownerId, ['show_api_docs', 'inherit_platform_help']);
  const showApiDocs = tSettings.get('show_api_docs') !== '0';
  const inheritPlatformHelp = tSettings.get('inherit_platform_help') !== '0';

  if (!agent) {
    return {
      allow_custom_domain: true,
      max_custom_domains: 0,
      allow_private_products: true,
      allow_own_payment: true,
      show_api_docs: showApiDocs,
      inherit_platform_help: true,
    };
  }

  const tierAllowDomain = agent.tierAllowCustomDomain !== 0;
  const tierMaxDomains = Math.max(0, Number(agent.tierMaxCustomDomains ?? 2));
  const tierPrivate = agent.tierAllowPrivateProducts === 1;
  const tierOwnPay = agent.tierAllowOwnPayment === 1;

  // 资金合规硬铁律：分站私有商品必须使用分站自有收款账户直收，严禁经主站资金流水结算（防二清与洗钱）
  // 因此私有商品能力严格依赖自有收款能力，未获准自有收款的分站绝不具备私有商品权限
  const allowOwnPayment =
    policy.allowOwnPaymentGlobal &&
    (agent.allowOwnPaymentOverride !== null ? agent.allowOwnPaymentOverride === 1 : tierOwnPay);
  const allowPrivateProducts =
    allowOwnPayment &&
    policy.allowPrivateProductsGlobal &&
    (agent.allowPrivateProductsOverride !== null ? agent.allowPrivateProductsOverride === 1 : tierPrivate);

  return {
    allow_custom_domain: tierAllowDomain,
    max_custom_domains: tierAllowDomain ? tierMaxDomains : 0,
    allow_private_products: allowPrivateProducts,
    allow_own_payment: allowOwnPayment,
    show_api_docs: showApiDocs,
    inherit_platform_help: inheritPlatformHelp,
  };
}
