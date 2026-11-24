import { and, eq, inArray, sql } from 'drizzle-orm';
import { siteSettings, tenantSettings } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

export interface GlobalSaasPolicy {
  mainHostnames: string[];
  allowPrivateProductsGlobal: boolean;
  allowOwnPaymentGlobal: boolean;
  privateProductPlatformFeePct: number;
}

const GLOBAL_SAAS_POLICY_KEYS = [
  'main_hostnames',
  'saas_allow_private_products_global',
  'saas_allow_own_payment_global',
  'private_product_platform_fee_pct',
] as const;

/** 解析逗号/空白分隔的主站白名单域名列表 */
export function parseHostnameList(raw?: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((s) =>
          s
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, '')
            .replace(/:\d+$/, '')
            .replace(/\.+$/, '')
        )
        .filter(Boolean)
    )
  );
}

/** 批量读取指定租户的独立配置（ownerAgentId = 0 代表主站，> 0 代表分站） */
export async function getTenantSettingsMapRepo(
  db: AppDatabase,
  ownerAgentId: number,
  keys?: readonly string[]
): Promise<Map<string, string>> {
  const cond =
    keys && keys.length > 0
      ? and(eq(tenantSettings.ownerAgentId, ownerAgentId), inArray(tenantSettings.key, [...keys]))
      : eq(tenantSettings.ownerAgentId, ownerAgentId);
  const rows = await db
    .select({ key: tenantSettings.key, value: tenantSettings.value })
    .from(tenantSettings)
    .where(cond);
  return new Map(rows.map((r) => [r.key, r.value]));
}

/** 批量原子写入指定租户的独立配置 */
export async function upsertTenantSettingsRepo(
  db: AppDatabase,
  ownerAgentId: number,
  entries: Array<[string, string]>
): Promise<void> {
  for (const [key, value] of entries) {
    await db
      .insert(tenantSettings)
      .values({ ownerAgentId, key, value })
      .onConflictDoUpdate({
        target: [tenantSettings.ownerAgentId, tenantSettings.key],
        set: { value, updatedAt: sql`datetime('now')` },
      });
  }
}

/** 读取主站全局 SaaS 多租户策略与主站白名单域名 */
export async function getGlobalSaasPolicyRepo(
  db: AppDatabase,
  envMainHostnames?: string
): Promise<GlobalSaasPolicy> {
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(inArray(siteSettings.key, [...GLOBAL_SAAS_POLICY_KEYS]));
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const hostSet = new Set<string>([
    ...parseHostnameList(envMainHostnames),
    ...parseHostnameList(map.get('main_hostnames')),
  ]);
  const feeRaw = Number(map.get('private_product_platform_fee_pct') ?? '0');

  return {
    mainHostnames: Array.from(hostSet),
    allowPrivateProductsGlobal: map.get('saas_allow_private_products_global') === '1',
    allowOwnPaymentGlobal: map.get('saas_allow_own_payment_global') === '1',
    privateProductPlatformFeePct: Number.isFinite(feeRaw) ? Math.min(50, Math.max(0, feeRaw)) : 0,
  };
}
