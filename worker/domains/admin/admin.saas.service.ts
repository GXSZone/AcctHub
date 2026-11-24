import type { Env } from '../../env';
import { getCloudflareSaasConfig } from '../../infra/cloudflare-saas';
import { maskSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { bumpEdgeCacheVersion } from '../../infra/security';
import { sealSiteCredential } from '../../infra/site-credential';
import { getGlobalSaasPolicyRepo, parseHostnameList } from '../tenant/tenant-settings.repo';
import { upsertSiteSettingRepo } from './admin.catalog.repo';

/** 更新反溯源中性域、Cloudflare for SaaS、开户抽成与代理提现手续费比例 */
export async function updateSaasConfig(
  env: Env,
  body: {
    neutral_base_domain?: string;
    saas_cname_target?: string;
    cf_saas_zone_id?: string;
    cf_saas_api_token?: string;
    clear_cf_token?: boolean;
    agent_signup_platform_fee_pct?: number;
    agent_withdrawal_fee_pct?: number;
  }
) {
  const db = createDb(env.DB);
  const stripDomain = (v: string) =>
    v
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');

  if (body.neutral_base_domain !== undefined) {
    await upsertSiteSettingRepo(db, 'neutral_base_domain', stripDomain(body.neutral_base_domain));
  }
  if (body.saas_cname_target !== undefined) {
    await upsertSiteSettingRepo(db, 'saas_cname_target', stripDomain(body.saas_cname_target));
  }
  if (body.cf_saas_zone_id !== undefined) {
    await upsertSiteSettingRepo(db, 'cf_saas_zone_id', body.cf_saas_zone_id.trim());
  }
  if (body.clear_cf_token) {
    await upsertSiteSettingRepo(db, 'cf_saas_api_token', '');
  } else if (body.cf_saas_api_token?.trim()) {
    const token = await sealSiteCredential(env, 'cf_saas_api_token', body.cf_saas_api_token.trim());
    await upsertSiteSettingRepo(db, 'cf_saas_api_token', token);
  }
  if (body.agent_signup_platform_fee_pct !== undefined) {
    const pct = Math.min(80, Math.max(0, Number(body.agent_signup_platform_fee_pct) || 0));
    await upsertSiteSettingRepo(db, 'agent_signup_platform_fee_pct', String(pct));
  }
  if (body.agent_withdrawal_fee_pct !== undefined) {
    const wdPct = Number(Math.min(30, Math.max(0, Number(body.agent_withdrawal_fee_pct) || 0)).toFixed(2));
    await upsertSiteSettingRepo(db, 'agent_withdrawal_fee_pct', String(wdPct));
  }
  bumpEdgeCacheVersion();
  return { ok: true };
}

/** 读取主站全局 SaaS 多租户策略（主站白名单、私有商品/自有收款开关、域名配置） */
export async function getAdminSaasPolicy(env: Env) {
  const db = createDb(env.DB);
  const [policy, saasCfg] = await Promise.all([
    getGlobalSaasPolicyRepo(db, env.MAIN_HOSTNAMES),
    getCloudflareSaasConfig(env),
  ]);
  return {
    main_hostnames: policy.mainHostnames.join(', '),
    saas_allow_private_products_global: policy.allowPrivateProductsGlobal,
    saas_allow_own_payment_global: policy.allowOwnPaymentGlobal,
    private_product_platform_fee_pct: policy.privateProductPlatformFeePct,
    neutral_base_domain: saasCfg.neutralBaseDomain,
    saas_cname_target: saasCfg.cnameTarget,
    cf_saas_zone_id: saasCfg.zoneId,
    cf_saas_has_token: Boolean(saasCfg.apiToken),
    cf_saas_token_masked: maskSecret(saasCfg.apiToken),
  };
}

/** 更新主站全局 SaaS 多租户策略与开关 */
export async function updateAdminSaasPolicy(
  env: Env,
  body: {
    main_hostnames?: string;
    saas_allow_private_products_global?: boolean;
    saas_allow_own_payment_global?: boolean;
    private_product_platform_fee_pct?: number;
    neutral_base_domain?: string;
    saas_cname_target?: string;
    cf_saas_zone_id?: string;
    cf_saas_api_token?: string;
    clear_cf_saas_token?: boolean;
  }
) {
  const db = createDb(env.DB);
  if (body.main_hostnames !== undefined) {
    const cleaned = parseHostnameList(body.main_hostnames).join(',');
    await upsertSiteSettingRepo(db, 'main_hostnames', cleaned);
  }
  if (body.saas_allow_own_payment_global !== undefined) {
    await upsertSiteSettingRepo(
      db,
      'saas_allow_own_payment_global',
      body.saas_allow_own_payment_global ? '1' : '0'
    );
    // 合规强绑定：全局关闭自有收款时底层强制同步关闭全局私有商品
    if (!body.saas_allow_own_payment_global) {
      await upsertSiteSettingRepo(db, 'saas_allow_private_products_global', '0');
    }
  }
  if (body.saas_allow_private_products_global !== undefined && body.saas_allow_own_payment_global !== false) {
    await upsertSiteSettingRepo(
      db,
      'saas_allow_private_products_global',
      body.saas_allow_private_products_global ? '1' : '0'
    );
  }
  if (body.private_product_platform_fee_pct !== undefined) {
    const pct = Math.min(50, Math.max(0, Number(body.private_product_platform_fee_pct) || 0));
    await upsertSiteSettingRepo(db, 'private_product_platform_fee_pct', String(pct));
  }
  await updateSaasConfig(env, {
    neutral_base_domain: body.neutral_base_domain,
    saas_cname_target: body.saas_cname_target,
    cf_saas_zone_id: body.cf_saas_zone_id,
    cf_saas_api_token: body.cf_saas_api_token,
    clear_cf_token: body.clear_cf_saas_token,
  });
  bumpEdgeCacheVersion();
  return { ok: true, ...(await getAdminSaasPolicy(env)) };
}
