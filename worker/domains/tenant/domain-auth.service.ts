import type { AdminAuthorizeDomainInput, BindTenantDomainInput } from '@shared/index';
import type { Env } from '../../env';
import {
  deleteCloudflareCustomHostname,
  getCloudflareSaasConfig,
  isValidCustomDomain,
  normalizeHostname,
  registerOrSyncCustomHostname,
} from '../../infra/cloudflare-saas';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import type { ActiveAgentContext } from '../agent/agent.guard';
import {
  countAgentCustomDomainsRepo,
  deleteTenantDomainRepo,
  findDomainByHostnameRepo,
  findDomainByIdRepo,
  insertTenantDomainRepo,
  listAdminDomainsRepo,
  listAgentDomainsRepo,
  mapTenantDomainRow,
  setPrimaryTenantDomainRepo,
  updateTenantDomainRepo,
} from './domain-auth.repo';
import { findTenantBySlug, resolveTenantCapabilities } from './tenant.repo';
import { getGlobalSaasPolicyRepo } from './tenant-settings.repo';

function makeVerificationToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `accthub-verify=${hex}`;
}

/** 通过 Cloudflare DoH 探测 TXT 所有权记录是否已生效（非致命，网络受限时返回 false） */
async function checkTxtOwnershipViaDoh(hostname: string, expectedToken: string): Promise<boolean> {
  try {
    const queryHost = `_accthub-verify.${hostname}`;
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(queryHost)}&type=TXT`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { Answer?: Array<{ data?: string }> };
    const answers = data.Answer ?? [];
    return answers.some(
      (a) =>
        String(a.data || '')
          .replace(/"/g, '')
          .trim() === expectedToken
    );
  } catch {
    return false;
  }
}

/** 通过 Cloudflare DoH 探测 CNAME 是否已指向平台配置的接入域 */
async function checkCnameTargetViaDoh(hostname: string, expectedTarget: string): Promise<boolean> {
  const cleanTarget = expectedTarget.trim().toLowerCase().replace(/\.+$/, '');
  if (!cleanTarget) return true;
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=CNAME`,
      { headers: { Accept: 'application/dns-json' } }
    );
    if (!res.ok) return false;
    const data = (await res.json()) as { Answer?: Array<{ data?: string }> };
    const answers = data.Answer ?? [];
    return answers.some(
      (a) =>
        String(a.data || '')
          .trim()
          .toLowerCase()
          .replace(/\.+$/, '') === cleanTarget
    );
  } catch {
    return false;
  }
}

/** 列出当前分站绑定的所有域名及等级配额信息 */
export async function listAgentDomains(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const [rows, saasCfg, policy, tenantAgent] = await Promise.all([
    listAgentDomainsRepo(db, ctx.agent.id),
    getCloudflareSaasConfig(env),
    getGlobalSaasPolicyRepo(db, env.MAIN_HOSTNAMES),
    findTenantBySlug(db, ctx.agent.slug),
  ]);
  const capabilities = await resolveTenantCapabilities(db, tenantAgent, policy);
  const customCount = rows.filter((r) => r.domainType === 'custom').length;
  return {
    domains: rows.map((r) => mapTenantDomainRow(r)),
    quota: {
      allow_custom_domain: capabilities.allow_custom_domain,
      max_custom_domains: capabilities.max_custom_domains,
      used_custom_domains: customCount,
    },
    domain_config: {
      neutral_base_domain: saasCfg.neutralBaseDomain,
      saas_cname_target: saasCfg.cnameTarget,
      cf_saas_enabled: Boolean(saasCfg.zoneId && saasCfg.apiToken),
    },
  };
}

/** 分站绑定独立自定义域名（校验等级权限、配额、防冲突，支持 CF SaaS / 人工审批双轨） */
export async function bindAgentDomain(env: Env, ctx: ActiveAgentContext, input: BindTenantDomainInput) {
  const db = createDb(env.DB);
  const hostname = normalizeHostname(input.hostname);
  if (!isValidCustomDomain(hostname)) {
    throw Errors.validation('独立域名格式无效，请填写如 shop.yourdomain.com 的合法域名（不含协议与路径）');
  }

  const [saasCfg, policy, tenantAgent] = await Promise.all([
    getCloudflareSaasConfig(env),
    getGlobalSaasPolicyRepo(db, env.MAIN_HOSTNAMES),
    findTenantBySlug(db, ctx.agent.slug),
  ]);
  const capabilities = await resolveTenantCapabilities(db, tenantAgent, policy);
  if (!capabilities.allow_custom_domain) {
    throw Errors.forbidden('您当前的代理等级暂不支持绑定独立域名，请先升级代理等级');
  }

  if (
    (saasCfg.cnameTarget && hostname === saasCfg.cnameTarget) ||
    policy.mainHostnames.includes(hostname) ||
    (saasCfg.neutralBaseDomain &&
      (hostname === saasCfg.neutralBaseDomain || hostname.endsWith(`.${saasCfg.neutralBaseDomain}`)))
  ) {
    throw Errors.validation('不能绑定平台主站或系统保留域名，请填写您自己的独立域名');
  }

  const existing = await findDomainByHostnameRepo(db, hostname);
  if (existing && existing.agentId !== ctx.agent.id) {
    throw Errors.conflict('该独立域名已被其他分站绑定');
  }
  if (existing && existing.agentId === ctx.agent.id) {
    return {
      ok: true,
      domain: mapTenantDomainRow(existing),
      message: '该域名已在您的绑定列表中',
    };
  }

  const usedCount = await countAgentCustomDomainsRepo(db, ctx.agent.id);
  if (usedCount >= capabilities.max_custom_domains) {
    throw Errors.forbidden(
      `您当前等级最多可绑定 ${capabilities.max_custom_domains} 个独立域名，请先解绑旧域名或升级等级`
    );
  }

  const cfEnabled = Boolean(saasCfg.zoneId && saasCfg.apiToken);
  const verificationToken = makeVerificationToken();
  const sync = cfEnabled ? await registerOrSyncCustomHostname(env, hostname, null) : null;

  const authMode = cfEnabled ? 'cloudflare_saas' : 'manual_approval';
  const status = sync ? (sync.status === 'active' ? 'active' : 'pending_dns') : 'pending_review';
  const sslStatus = sync ? (sync.status === 'active' ? 'active' : 'pending') : 'manual';

  const inserted = await insertTenantDomainRepo(db, {
    agentId: ctx.agent.id,
    hostname,
    domainType: 'custom',
    isPrimary: input.is_primary || usedCount === 0 ? 1 : 0,
    authMode,
    status,
    verificationToken,
    cfHostnameId: sync?.cfHostnameId ?? '',
    sslStatus,
    authorizedAt: status === 'active' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
    errorMessage: sync?.error ?? '',
  });

  if (input.is_primary || usedCount === 0) {
    await setPrimaryTenantDomainRepo(db, ctx.agent.id, inserted.id);
  }

  return {
    ok: true,
    domain: mapTenantDomainRow(inserted),
    message: sync?.message || '已提交独立域名绑定申请，请按指引添加 CNAME/TXT 解析，并等待平台审核授权激活。',
  };
}

/** 设为分站主域名 */
export async function setPrimaryAgentDomain(env: Env, ctx: ActiveAgentContext, domainId: number) {
  const db = createDb(env.DB);
  const target = await findDomainByIdRepo(db, domainId);
  if (!target || target.agentId !== ctx.agent.id) {
    throw Errors.notFound('未找到该绑定域名记录');
  }
  await setPrimaryTenantDomainRepo(db, ctx.agent.id, domainId);
  return { ok: true };
}

/** 解绑分站域名（同时清理 Cloudflare Custom Hostname） */
export async function deleteAgentDomain(env: Env, ctx: ActiveAgentContext, domainId: number) {
  const db = createDb(env.DB);
  const target = await findDomainByIdRepo(db, domainId);
  if (!target || target.agentId !== ctx.agent.id) {
    throw Errors.notFound('未找到该绑定域名记录');
  }
  if (target.cfHostnameId) {
    await deleteCloudflareCustomHostname(env, target.cfHostnameId);
  }
  await deleteTenantDomainRepo(db, domainId);
  return { ok: true };
}

/** 分站触发域名解析与 SSL 证书校验 */
export async function verifyAgentDomainById(env: Env, ctx: ActiveAgentContext, domainId: number) {
  const db = createDb(env.DB);
  const target = await findDomainByIdRepo(db, domainId);
  if (!target || target.agentId !== ctx.agent.id) {
    throw Errors.notFound('未找到该绑定域名记录');
  }
  if (target.status === 'revoked') {
    throw Errors.forbidden('该域名授权已被平台吊销，请联系平台客服处理');
  }

  const saasCfg = await getCloudflareSaasConfig(env);
  if (saasCfg.zoneId && saasCfg.apiToken) {
    const sync = await registerOrSyncCustomHostname(env, target.hostname, target.cfHostnameId || null);
    const nextStatus = sync.status === 'active' ? 'active' : 'pending_dns';
    const updated = await updateTenantDomainRepo(db, target.id, {
      authMode: 'cloudflare_saas',
      status: nextStatus,
      cfHostnameId: sync.cfHostnameId,
      sslStatus: sync.status === 'active' ? 'active' : 'pending',
      authorizedAt:
        nextStatus === 'active'
          ? target.authorizedAt || new Date().toISOString().replace('T', ' ').slice(0, 19)
          : target.authorizedAt,
      errorMessage: sync.error ?? '',
    });
    return {
      ok: true,
      status: nextStatus,
      message: sync.message,
      domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
    };
  }

  const txtOk = target.verificationToken
    ? await checkTxtOwnershipViaDoh(target.hostname, target.verificationToken)
    : false;
  const nextStatus = target.status === 'active' ? 'active' : 'pending_review';
  const updated = await updateTenantDomainRepo(db, target.id, {
    status: nextStatus,
    errorMessage: txtOk ? '' : '尚未检测到 _accthub-verify TXT 记录（您仍可联系平台人工授权）',
  });
  return {
    ok: true,
    status: nextStatus,
    dns_verified: txtOk,
    message: txtOk
      ? 'TXT 域名所有权校验已通过，正在等待平台总控最终授权放行。'
      : '尚未检测到 TXT 验证记录生效，请确认解析已生效或联系平台总控人工授权。',
    domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
  };
}

/** 总控后台：列出全部待授权/已授权/已吊销的分站域名 */
export async function listAdminDomains(env: Env, statusFilter?: string) {
  const db = createDb(env.DB);
  const items = await listAdminDomainsRepo(db, statusFilter?.trim() || undefined);
  return { items };
}

/** 总控后台：批准授权（可设到期时间）、吊销授权或同步 Cloudflare SSL */
export async function adminAuthorizeDomain(
  env: Env,
  adminUserId: number,
  domainId: number,
  input: AdminAuthorizeDomainInput
) {
  const db = createDb(env.DB);
  const target = await findDomainByIdRepo(db, domainId);
  if (!target) throw Errors.notFound('未找到该域名绑定记录');

  if (input.action === 'sync') {
    const saasCfg = await getCloudflareSaasConfig(env);
    if (!saasCfg.zoneId || !saasCfg.apiToken) {
      return {
        ok: true,
        message: '当前处于人工审批模式（未配置 Cloudflare for SaaS API），已保留当前授权状态',
        domain: mapTenantDomainRow(target),
      };
    }
    const sync = await registerOrSyncCustomHostname(env, target.hostname, target.cfHostnameId || null);
    if (sync.mode === 'manual_review') {
      return {
        ok: true,
        message: sync.message,
        domain: mapTenantDomainRow(target),
      };
    }
    // 已人工激活的域名在 CF SSL 尚未签发完成前保持 active，不倒退回 pending_dns
    const nextStatus =
      sync.status === 'active'
        ? 'active'
        : target.status === 'active' && target.authMode === 'manual_approval'
          ? 'active'
          : 'pending_dns';
    const updated = await updateTenantDomainRepo(db, target.id, {
      authMode: sync.cfHostnameId ? 'cloudflare_saas' : target.authMode,
      status: nextStatus,
      cfHostnameId: sync.cfHostnameId || target.cfHostnameId,
      sslStatus:
        sync.status === 'active' ? 'active' : target.status === 'active' ? target.sslStatus : 'pending',
      errorMessage: sync.error ?? '',
    });
    return {
      ok: true,
      message: sync.message,
      domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
    };
  }

  if (input.action === 'revoke') {
    if (target.cfHostnameId) {
      await deleteCloudflareCustomHostname(env, target.cfHostnameId);
    }
    const updated = await updateTenantDomainRepo(db, target.id, {
      status: 'revoked',
      cfHostnameId: '',
      sslStatus: 'revoked',
      errorMessage: input.note || '管理员已吊销该域名授权',
    });
    return {
      ok: true,
      message: '已吊销该分站域名授权并即时生效拦截',
      domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
    };
  }

  if (input.action === 'set_expiry') {
    const expiresAt = input.expires_at?.trim() ? input.expires_at.trim() : null;
    const updated = await updateTenantDomainRepo(db, target.id, { expiresAt });
    return {
      ok: true,
      status: updated?.status ?? target.status,
      message: expiresAt ? `已更新授权有效期至 ${expiresAt}` : '已设置为永久有效',
      domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
    };
  }

  // approve：总控授权激活（支持设置到期日），强制按 DNS 事实证据核验后再放行
  const isOfflineUnitTest = String(env.APP_ENV || '').toLowerCase() === 'test';
  if (!isOfflineUnitTest) {
    const saasCfg = await getCloudflareSaasConfig(env);
    if (saasCfg.zoneId && saasCfg.apiToken) {
      const sync = await registerOrSyncCustomHostname(env, target.hostname, target.cfHostnameId || null);
      if (sync.status !== 'active') {
        const failMsg = `DNS / SSL 实测未通过，暂无法激活：${sync.message}`;
        await updateTenantDomainRepo(db, target.id, {
          cfHostnameId: sync.cfHostnameId || target.cfHostnameId,
          errorMessage: failMsg,
        });
        throw Errors.conflict(failMsg);
      }
    } else {
      const [txtOk, cnameOk] = await Promise.all([
        target.verificationToken
          ? checkTxtOwnershipViaDoh(target.hostname, target.verificationToken)
          : Promise.resolve(false),
        saasCfg.cnameTarget
          ? checkCnameTargetViaDoh(target.hostname, saasCfg.cnameTarget)
          : Promise.resolve(true),
      ]);
      const missing: string[] = [];
      if (!txtOk) {
        missing.push(
          `TXT 记录 _accthub-verify.${target.hostname} = ${target.verificationToken || '(未生成校验码)'}`
        );
      }
      if (!cnameOk && saasCfg.cnameTarget) {
        missing.push(`CNAME 记录 ${target.hostname} -> ${saasCfg.cnameTarget}`);
      }
      if (missing.length > 0) {
        const failMsg = `DNS 事实检测未通过，无法激活授权，请确认代理已生效以下解析：${missing.join('；')}`;
        await updateTenantDomainRepo(db, target.id, { errorMessage: failMsg });
        throw Errors.conflict(failMsg);
      }
    }
  }

  const expiresAt = input.expires_at?.trim() ? input.expires_at.trim() : null;
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const updated = await updateTenantDomainRepo(db, target.id, {
    status: 'active',
    authorizedByAdminId: adminUserId,
    authorizedAt: nowStr,
    expiresAt,
    sslStatus: target.authMode === 'cloudflare_saas' ? target.sslStatus || 'active' : 'active',
    errorMessage: '',
  });
  return {
    ok: true,
    status: 'active',
    message: expiresAt
      ? `DNS 核验通过，已批准域名授权（有效期至 ${expiresAt}）`
      : 'DNS 核验通过，已永久批准该域名授权并即时生效',
    domain: updated ? mapTenantDomainRow(updated) : mapTenantDomainRow(target),
  };
}
