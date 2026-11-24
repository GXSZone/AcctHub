import type { TenantCapabilitiesDto } from '@shared/index';
import type { Env, TenantContext } from '../../env';
import { getCloudflareSaasConfig } from '../../infra/cloudflare-saas';
import { createDb } from '../../infra/db';
import {
  findPrimaryActiveHostname,
  findTenantBySlug,
  findTenantDomainByHost,
  resolveTenantCapabilities,
  type TenantAgentRecord,
} from './tenant.repo';
import { getGlobalSaasPolicyRepo } from './tenant-settings.repo';

const DEFAULT_MAIN_CAPABILITIES: TenantCapabilitiesDto = {
  allow_custom_domain: true,
  max_custom_domains: 0,
  allow_private_products: true,
  allow_own_payment: true,
  show_api_docs: true,
  inherit_platform_help: true,
};

const EMPTY_CAPABILITIES: TenantCapabilitiesDto = {
  allow_custom_domain: false,
  max_custom_domains: 0,
  allow_private_products: false,
  allow_own_payment: false,
  show_api_docs: false,
  inherit_platform_help: false,
};

function buildMainTenantContext(opts: {
  matchedHostname?: string;
  capabilities?: TenantCapabilitiesDto;
  isBlockedCnameHost?: boolean;
}): TenantContext {
  return {
    isSubAgent: false,
    agentId: null,
    ownerUserId: null,
    slug: null,
    brandName: null,
    brandTagline: null,
    supportLabel: null,
    supportUrl: null,
    supportNote: null,
    supportMediaJson: null,
    supportLinksJson: null,
    announcementBanner: null,
    markupPercent: 0,
    commissionRate: 0,
    resolvedVia: 'main',
    matchedHostname: opts.matchedHostname,
    capabilities: opts.capabilities ?? DEFAULT_MAIN_CAPABILITIES,
    ...(opts.isBlockedCnameHost ? { isBlockedCnameHost: true } : {}),
  };
}

function buildUnauthorizedDomainContext(host: string, reason: string): TenantContext {
  return {
    isSubAgent: false,
    agentId: null,
    ownerUserId: null,
    slug: null,
    brandName: null,
    brandTagline: null,
    supportLabel: null,
    supportUrl: null,
    supportNote: null,
    supportMediaJson: null,
    supportLinksJson: null,
    announcementBanner: null,
    markupPercent: 0,
    commissionRate: 0,
    resolvedVia: 'unauthorized',
    matchedHostname: host,
    isUnauthorizedDomain: true,
    unauthorizedReason: reason,
    capabilities: EMPTY_CAPABILITIES,
  };
}

function isDomainExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const normalized = expiresAt.includes('T') ? expiresAt : `${expiresAt.replace(' ', 'T')}Z`;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) && ts <= Date.now();
}

/** 构造对外公开的租户信息（剔除内部 ownerUserId 与敏感字段） */
export function sanitizePublicTenant(tenant: TenantContext) {
  return {
    isSubAgent: tenant.isSubAgent,
    agentId: tenant.agentId,
    slug: tenant.slug,
    brandName: tenant.brandName,
    brandTagline: tenant.brandTagline,
    markupPercent: tenant.markupPercent,
    commissionRate: tenant.commissionRate,
    themeAccent: tenant.themeAccent || '',
    faviconUrl: tenant.faviconUrl || '',
    ogImageUrl: tenant.ogImageUrl || '',
    seoTitle: tenant.seoTitle || '',
    seoDescription: tenant.seoDescription || '',
    footerText: tenant.footerText || '',
    resolvedVia: tenant.resolvedVia,
    primaryHostname: tenant.primaryHostname ?? null,
    capabilities: tenant.capabilities ?? DEFAULT_MAIN_CAPABILITIES,
  };
}

function buildSubAgentTenantContext(
  agent: TenantAgentRecord,
  opts: {
    resolvedVia: TenantContext['resolvedVia'];
    matchedHostname: string;
    primaryHostname: string | null;
    capabilities: TenantCapabilitiesDto;
  }
): TenantContext {
  return {
    isSubAgent: true,
    isSuspended: agent.status !== 'active',
    agentId: agent.id,
    ownerUserId: agent.userId,
    slug: agent.slug,
    brandName: agent.brandName,
    brandTagline: agent.brandTagline,
    supportLabel: agent.supportLabel || null,
    supportUrl: agent.supportUrl || null,
    supportNote: agent.supportNote || null,
    supportMediaJson: agent.supportMediaJson || '[]',
    supportLinksJson: agent.supportLinksJson || '[]',
    announcementBanner: agent.announcementBanner || '',
    tickerEnabled: agent.tickerEnabled !== 0,
    tickerMode: agent.tickerMode || 'vertical',
    tickerIncludeNotices: agent.tickerIncludeNotices !== 0,
    popupEnabled: Boolean(agent.popupEnabled),
    popupTitle: agent.popupTitle || '',
    popupContent: agent.popupContent || '',
    popupFrequency: agent.popupFrequency || 'once_per_day',
    popupVersion: agent.popupVersion || '1',
    markupPercent: agent.markupPercent,
    commissionRate: agent.commissionRate,
    themeAccent: agent.themeAccent || '',
    faviconUrl: agent.faviconUrl || '',
    ogImageUrl: agent.ogImageUrl || '',
    seoTitle: agent.seoTitle || '',
    seoDescription: agent.seoDescription || '',
    footerText: agent.footerText || '',
    resolvedVia: opts.resolvedVia,
    matchedHostname: opts.matchedHostname,
    primaryHostname: opts.primaryHostname,
    capabilities: opts.capabilities,
  };
}

/**
 * 解析当前请求的 SaaS 多租户上下文（域名授权唯一真相源 + 未知域名硬拦截）：
 * 1) 严禁信任客户端可伪造的 X-Forwarded-Host，仅使用请求 URL hostname / Host；
 * 2) 直接访问中性 CNAME 接入域返回 404 反溯源；
 * 3) 本地开发原生支持 <slug>.localhost 独立多域名路由；
 * 4) 生产/线上域名严格要求命中主站白名单、已授权活跃 tenant_domains 或有效中性泛子域，
 *    任何未授权/待审/过期/已吊销域名一律硬拦截，绝不静默回落主站。
 */
export async function resolveTenantContext(req: Request, env: Env): Promise<TenantContext> {
  const url = new URL(req.url);
  const rawHost = (url.hostname || req.headers.get('Host') || '').split(',')[0].trim();
  const host = rawHost.split(':')[0].toLowerCase();
  const isLoopbackRoot = !host || host === 'localhost' || host === '127.0.0.1';
  const isLocalSubdomain = host.endsWith('.localhost') && host.length > '.localhost'.length;

  const db = createDb(env.DB);
  const [saasCfg, policy] = await Promise.all([
    getCloudflareSaasConfig(env),
    getGlobalSaasPolicyRepo(db, env.MAIN_HOSTNAMES),
  ]);

  // 1. 直接访问中性 CNAME 接入域返回 404 反溯源
  if (saasCfg.cnameTarget && host && host === saasCfg.cnameTarget) {
    return buildMainTenantContext({ matchedHostname: host, isBlockedCnameHost: true });
  }

  // 2. 本地多域名开发：<slug>.localhost 直接解析为对应分站（不存在则硬拦截，不回落主站）
  if (isLocalSubdomain) {
    const localSlug = host.slice(0, -'.localhost'.length);
    if (!localSlug || localSlug.includes('.')) {
      return buildUnauthorizedDomainContext(host, '本地分站子域名格式无效');
    }
    const agent = await findTenantBySlug(db, localSlug);
    if (!agent) {
      return buildUnauthorizedDomainContext(host, `未找到标识为「${localSlug}」的分站`);
    }
    const [capabilities, primaryHostname] = await Promise.all([
      resolveTenantCapabilities(db, agent, policy),
      findPrimaryActiveHostname(db, agent.id),
    ]);
    return buildSubAgentTenantContext(agent, {
      resolvedVia: 'local_subdomain',
      matchedHostname: host,
      primaryHostname,
      capabilities,
    });
  }

  // 3. 线上/自定义域名匹配（先查 tenant_domains 授权表，再查中性泛子域，再核对主站白名单）
  if (!isLoopbackRoot && host) {
    const domainHit = await findTenantDomainByHost(db, host);
    if (domainHit) {
      if (!domainHit.agent) {
        return buildUnauthorizedDomainContext(host, '该域名绑定的分站不存在');
      }
      if (domainHit.status === 'revoked') {
        return buildUnauthorizedDomainContext(host, '该分站域名授权已被平台吊销');
      }
      if (domainHit.status === 'expired' || isDomainExpired(domainHit.expiresAt)) {
        return buildUnauthorizedDomainContext(host, '该分站域名授权已过期，请联系平台续期');
      }
      if (domainHit.status !== 'active') {
        return buildUnauthorizedDomainContext(host, '该独立域名正在等待 DNS 验证或平台授权审批');
      }
      const [capabilities, primaryHostname] = await Promise.all([
        resolveTenantCapabilities(db, domainHit.agent, policy),
        findPrimaryActiveHostname(db, domainHit.agent.id),
      ]);
      return buildSubAgentTenantContext(domainHit.agent, {
        resolvedVia: 'custom_domain',
        matchedHostname: host,
        primaryHostname: primaryHostname || host,
        capabilities,
      });
    }

    // 3.2 中性泛子域池（<slug>.<neutralBaseDomain>）
    if (saasCfg.neutralBaseDomain && host.endsWith(`.${saasCfg.neutralBaseDomain}`)) {
      const sub = host.slice(0, -(saasCfg.neutralBaseDomain.length + 1));
      if (sub && !sub.includes('.')) {
        const subAgent = await findTenantBySlug(db, sub);
        if (subAgent) {
          const [capabilities, primaryHostname] = await Promise.all([
            resolveTenantCapabilities(db, subAgent, policy),
            findPrimaryActiveHostname(db, subAgent.id),
          ]);
          return buildSubAgentTenantContext(subAgent, {
            resolvedVia: 'neutral_subdomain',
            matchedHostname: host,
            primaryHostname,
            capabilities,
          });
        }
      }
      return buildUnauthorizedDomainContext(host, '该分站二级域名未开通或已失效');
    }

    // 3.3 平台主站白名单校验（已配置主站白名单时，任何未知第三方域名一律硬拦截，绝不静默回落主站）
    const isMainWhitelisted = policy.mainHostnames.length === 0 || policy.mainHostnames.includes(host);
    if (!isMainWhitelisted) {
      return buildUnauthorizedDomainContext(host, '当前域名未获平台授权绑定，已拦截访问');
    }
  }

  const mainCapabilities = await resolveTenantCapabilities(db, null, policy);
  return buildMainTenantContext({
    matchedHostname: host || 'localhost',
    capabilities: mainCapabilities,
  });
}
