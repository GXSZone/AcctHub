import { inArray } from 'drizzle-orm';
import { siteSettings } from '../db/schema/index';
import type { Env } from '../env';
import { createDb } from './db';
import { readSiteCredential } from './site-credential';

export interface CloudflareSaasConfig {
  zoneId: string;
  apiToken: string;
  cnameTarget: string;
  neutralBaseDomain: string;
}

export interface CustomHostnameSyncResult {
  mode: 'cloudflare_saas' | 'manual_review';
  status: 'pending' | 'active';
  cfHostnameId: string;
  error?: string;
  message: string;
}

const SAAS_SETTING_KEYS = [
  'cf_saas_zone_id',
  'cf_saas_api_token',
  'saas_cname_target',
  'neutral_base_domain',
] as const;

/** 使用 Drizzle ORM 读取 Cloudflare for SaaS 域名接入配置 */
export async function getCloudflareSaasConfig(env: Env): Promise<CloudflareSaasConfig> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(inArray(siteSettings.key, [...SAAS_SETTING_KEYS]));

  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || '';

  return {
    zoneId: (map.cf_saas_zone_id || '').trim(),
    apiToken: await readSiteCredential(env, 'cf_saas_api_token', map.cf_saas_api_token || ''),
    cnameTarget: (map.saas_cname_target || '').trim().toLowerCase(),
    neutralBaseDomain: (map.neutral_base_domain || '').trim().toLowerCase(),
  };
}

/** 规范化用户输入的自定义域名 */
export function normalizeHostname(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

/** 校验自定义域名格式（拒绝 IP、localhost 与 .local） */
export function isValidCustomDomain(hostname: string): boolean {
  if (!hostname || hostname.length < 4 || hostname.length > 253) return false;
  if (hostname === 'localhost' || hostname.endsWith('.local') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return false;
  }
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(hostname);
}

/** 向 Cloudflare for SaaS 注册或同步代理分站自定义主机名与 SSL 状态 */
export async function registerOrSyncCustomHostname(
  env: Env,
  hostname: string,
  existingCfHostnameId?: string | null
): Promise<CustomHostnameSyncResult> {
  const cfg = await getCloudflareSaasConfig(env);
  if (!cfg.zoneId || !cfg.apiToken) {
    return {
      mode: 'manual_review',
      status: 'pending',
      cfHostnameId: '',
      message: '已提交独立域名绑定申请，等待平台审核激活（或配置 Cloudflare for SaaS 自动签发 SSL）。',
    };
  }

  try {
    if (existingCfHostnameId) {
      const checkRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames/${encodeURIComponent(existingCfHostnameId)}`,
        {
          redirect: 'error',
          headers: {
            Authorization: `Bearer ${cfg.apiToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (checkRes.ok) {
        const data = (await checkRes.json()) as {
          success?: boolean;
          result?: { id?: string; hostname?: string; status?: string; ssl?: { status?: string } };
        };
        if (data.success && data.result && data.result.hostname?.toLowerCase() === hostname) {
          const active = data.result.status === 'active' && data.result.ssl?.status === 'active';
          return {
            mode: 'cloudflare_saas',
            status: active ? 'active' : 'pending',
            cfHostnameId: data.result.id || existingCfHostnameId,
            message: active
              ? 'Cloudflare for SaaS 域名与 SSL 证书均已生效。'
              : `Cloudflare 正在验证 CNAME 并签发 SSL（域名状态: ${data.result.status || 'pending'}，SSL: ${data.result.ssl?.status || 'initializing'}）。`,
          };
        }
      }
    }

    const createRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames`,
      {
        redirect: 'error',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname,
          ssl: {
            method: 'http',
            type: 'dv',
            settings: {
              min_tls_version: '1.2',
            },
          },
        }),
      }
    );

    const payload = (await createRes.json().catch(() => ({}))) as {
      success?: boolean;
      result?: { id?: string; status?: string; ssl?: { status?: string } };
      errors?: Array<{ message?: string; code?: number }>;
    };

    if (!createRes.ok || !payload.success || !payload.result?.id) {
      const errMsg = payload.errors?.[0]?.message || `Cloudflare API HTTP ${createRes.status}`;
      return {
        mode: 'cloudflare_saas',
        status: 'pending',
        cfHostnameId: existingCfHostnameId || '',
        error: errMsg,
        message: `已保存域名，但调用 Cloudflare for SaaS 失败：${errMsg}`,
      };
    }

    const active = payload.result.status === 'active' && payload.result.ssl?.status === 'active';
    return {
      mode: 'cloudflare_saas',
      status: active ? 'active' : 'pending',
      cfHostnameId: payload.result.id,
      message: active
        ? 'Cloudflare for SaaS 绑定并签发独立 SSL 证书成功！'
        : '已提交至 Cloudflare for SaaS，请在您的域名解析面板配置 CNAME 指向接入域，系统将在解析生效后自动签发独立 SSL。',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络异常';
    return {
      mode: 'cloudflare_saas',
      status: 'pending',
      cfHostnameId: existingCfHostnameId || '',
      error: msg,
      message: `已保存独立域名，自动调用 Cloudflare API 时遇到网络异常（${msg}），可稍后重试同步或联系审核。`,
    };
  }
}

/** 清理 Cloudflare for SaaS 自定义主机名（非致命操作） */
export async function deleteCloudflareCustomHostname(env: Env, cfHostnameId: string): Promise<void> {
  if (!cfHostnameId) return;
  const cfg = await getCloudflareSaasConfig(env);
  if (!cfg.zoneId || !cfg.apiToken) return;
  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/custom_hostnames/${encodeURIComponent(cfHostnameId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch {
    // 清理失败不阻断业务主流程
  }
}
