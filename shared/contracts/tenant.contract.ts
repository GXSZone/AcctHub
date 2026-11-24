import { z } from 'zod';
import { TENANT_DOMAIN_AUTH_MODES, TENANT_DOMAIN_STATUSES, TENANT_DOMAIN_TYPES } from '../constants/enums';
import { upsertProductInputSchema } from './catalog.contract';

/** 租户有效功能能力开关集合（合并主站全局开关 + 代理等级 + 单店覆写） */
export const tenantCapabilitiesSchema = z.object({
  allow_custom_domain: z.boolean(),
  max_custom_domains: z.number().int().nonnegative(),
  allow_private_products: z.boolean(),
  allow_own_payment: z.boolean(),
  show_api_docs: z.boolean(),
  inherit_platform_help: z.boolean(),
});

/** 分站绑定域名记录 DTO */
export const tenantDomainDtoSchema = z.object({
  id: z.number().int().positive(),
  agent_id: z.number().int().positive(),
  agent_slug: z.string().optional(),
  agent_brand: z.string().optional(),
  hostname: z.string(),
  domain_type: z.enum(TENANT_DOMAIN_TYPES),
  is_primary: z.boolean(),
  auth_mode: z.enum(TENANT_DOMAIN_AUTH_MODES),
  status: z.enum(TENANT_DOMAIN_STATUSES),
  verification_token: z.string(),
  cf_hostname_id: z.string(),
  ssl_status: z.string(),
  authorized_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  error_message: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** 分站绑定自定义域名入参 */
export const bindTenantDomainSchema = z.object({
  hostname: z.string().trim().min(4, '请填写有效的独立域名').max(253),
  is_primary: z.boolean().optional().default(true),
});

/** 总控审核/授权/吊销/设置有效期分站域名入参 */
export const adminAuthorizeDomainSchema = z.object({
  action: z.enum(['approve', 'revoke', 'sync', 'set_expiry']),
  expires_at: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(300).optional().default(''),
});

/** 全局 SaaS 策略响应 DTO */
export const globalSaasPolicyDtoSchema = z.object({
  main_hostnames: z.string(),
  saas_allow_private_products_global: z.boolean(),
  saas_allow_own_payment_global: z.boolean(),
  private_product_platform_fee_pct: z.number(),
  neutral_base_domain: z.string().optional(),
  saas_cname_target: z.string().optional(),
  cf_saas_zone_id: z.string().optional(),
  cf_saas_has_token: z.boolean().optional(),
  cf_saas_token_masked: z.string().optional(),
});

/** 分站独立运营扩展开关 */
export const agentSitePreferencesSchema = z.object({
  show_api_docs: z.boolean().optional(),
  inherit_platform_help: z.boolean().optional(),
  header_links_json: z.string().max(12000).optional(),
});

/** 分站新建专属优惠券入参 */
export const agentCouponCreateSchema = z.object({
  code: z.string().trim().min(3, '优惠券码至少 3 位').max(32),
  name: z.string().trim().max(80).optional(),
  discount_type: z.enum(['fixed', 'percent']).optional().default('fixed'),
  discount_value: z.coerce.number().positive('优惠面额或折扣必须大于 0'),
  min_order_amount: z.coerce.number().min(0).optional().default(0),
  max_uses: z.coerce.number().int().min(0).optional().default(100),
  expires_at: z.string().trim().max(40).nullable().optional(),
});

/** 分站新建/编辑专属帮助文章入参 */
export const agentHelpArticleSchema = z.object({
  category: z.string().trim().max(60).optional().default('常见问题'),
  title: z.string().trim().min(1, '标题不能为空').max(160),
  title_en: z.string().trim().max(160).optional(),
  content: z.string().trim().min(1, '正文不能为空').max(20000),
  content_en: z.string().trim().max(20000).optional(),
  sort_order: z.coerce.number().int().optional().default(0),
  is_active: z.boolean().optional().default(true),
});

/** 主站 SaaS 全局多租户能力开关与白名单配置 */
export const adminSaasPolicySchema = z.object({
  main_hostnames: z.string().trim().max(1000).optional(),
  saas_allow_private_products_global: z.boolean().optional(),
  saas_allow_own_payment_global: z.boolean().optional(),
  private_product_platform_fee_pct: z.coerce.number().min(0).max(50).optional(),
  neutral_base_domain: z.string().trim().max(253).optional(),
  saas_cname_target: z.string().trim().max(253).optional(),
  cf_saas_zone_id: z.string().trim().max(120).optional(),
  cf_saas_api_token: z.string().trim().max(300).optional(),
  clear_cf_saas_token: z.boolean().optional(),
});

/** 跨站一次性免登 SSO 签发与兑换入参 */
export const ssoIssueInputSchema = z.object({
  redirect_path: z.string().trim().max(200).optional().default('/agent'),
});

export const ssoExchangeInputSchema = z.object({
  ticket: z.string().trim().min(16, '免登票据无效').max(256),
});

/** Phase 3：分站自建私有商品入参（直接复用统一商品编辑器契约 `upsertProductInputSchema`） */
export const agentPrivateProductInputSchema = upsertProductInputSchema.extend({
  category_id: z.coerce.number().int().positive().optional(),
  slug: z.string().trim().max(120).optional(),
  base_price: z.coerce.number().positive('售价必须大于 0'),
});

/** Phase 3：分站私有商品批量导入自有卡密入参（支持自动去重与循环卡密模式） */
export const agentPrivateCardsImportSchema = z.object({
  spec_id: z.string().trim().min(1).max(40).optional().default('default'),
  lines: z.string().trim().min(1, '请粘贴至少一条卡密内容').max(500_000),
  dedupe: z.boolean().optional().default(true),
  is_loop: z.boolean().optional().default(false),
});

/** Phase 4：分站自有收款插件配置更新入参 */
export const agentPaymentPluginUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type TenantCapabilitiesDto = z.infer<typeof tenantCapabilitiesSchema>;
export type TenantDomainDto = z.infer<typeof tenantDomainDtoSchema>;
export type GlobalSaasPolicyDto = z.infer<typeof globalSaasPolicyDtoSchema>;
export type BindTenantDomainInput = z.infer<typeof bindTenantDomainSchema>;
export type AdminAuthorizeDomainInput = z.infer<typeof adminAuthorizeDomainSchema>;
export type AdminSaasPolicyInput = z.infer<typeof adminSaasPolicySchema>;
export type SsoIssueInput = z.infer<typeof ssoIssueInputSchema>;
export type SsoExchangeInput = z.infer<typeof ssoExchangeInputSchema>;
