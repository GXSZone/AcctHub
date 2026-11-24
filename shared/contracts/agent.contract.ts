import { z } from 'zod';
import { BUSINESS_LIMITS } from '../constants/limits';

export const agentTierUpsertSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1, '等级名称不能为空').max(48),
  level_rank: z.number().int().min(1).max(99).optional(),
  min_recharge: z.number().nonnegative(),
  discount_rate: z.number().min(BUSINESS_LIMITS.MIN_DISCOUNT_RATE).max(BUSINESS_LIMITS.MAX_DISCOUNT_RATE),
  max_sub_agents: z.number().int().nonnegative().max(10000).optional(),
  badge_color: z.string().trim().max(32).optional(),
  perks: z.array(z.string().trim().max(200)).max(12).optional(),
});

export const agentBatchPricingSchema = z
  .object({
    mode: z.enum(['markup_cost_pct', 'markup_main_pct', 'markup_cost_fixed', 'reset_all']),
    value: z.number().min(-50).max(5000).optional(),
    rounding: z.enum(['none', 'integer', 'point9']).default('none'),
    scope: z.literal('all').optional(),
    targets: z
      .array(
        z.object({
          product_id: z.number().int().positive(),
          spec_id: z.string().trim().min(1).max(64),
        })
      )
      .max(500)
      .optional(),
  })
  .refine((value) => (value.scope === 'all' ? value.targets === undefined : value.targets !== undefined), {
    message: '请选择批量操作目标或明确指定全店',
  });

export const agentProductOverrideSchema = z.object({
  is_listed: z.boolean().optional(),
  custom_title: z.string().max(200).nullable().optional(),
  custom_subtitle: z.string().max(400).nullable().optional(),
  custom_detail_markdown: z.string().max(50000).nullable().optional(),
  custom_risk_notice: z.string().max(4000).nullable().optional(),
});

export const agentWithdrawalInputSchema = z.object({
  amount: z.coerce
    .number()
    .min(
      BUSINESS_LIMITS.MIN_WITHDRAWAL_AMOUNT,
      `单笔最低提现金额为 ¥${BUSINESS_LIMITS.MIN_WITHDRAWAL_AMOUNT}`
    )
    .max(1_000_000),
  channel: z.enum(['alipay', 'wechat', 'usdt_trc20']).default('alipay'),
  account_info: z.string().trim().min(2, '请填写收款账号或 USDT 地址').max(200),
  account_name: z.string().trim().max(80).optional(),
});

export const agentRechargeInputSchema = z.object({
  target_tier_id: z.coerce.number().int().positive().optional(),
  target_tier_code: z.string().trim().max(48).optional(),
  payment_method: z.string().trim().max(48).optional(),
  desired_slug: z.string().trim().max(32).optional(),
  desired_brand_name: z.string().trim().max(64).optional(),
});

export const agentSinglePricingSchema = z.object({
  product_id: z.coerce.number().int().positive('缺少商品标识'),
  spec_id: z.string().trim().min(1, '缺少规格标识').max(64),
  custom_price: z.union([z.number(), z.string(), z.null()]).optional(),
});

export const agentAnnouncementInputSchema = z.object({
  title: z.string().trim().min(1, '请填写公告标题').max(160),
  content: z.string().trim().max(10000).optional().default(''),
  level: z.string().trim().max(24).optional().default('info'),
  audience: z.enum(['storefront', 'direct_downlines']).optional().default('storefront'),
  is_pinned: z.boolean().optional(),
});

export const agentAnnouncementUpdateSchema = z.object({
  title: z.string().trim().max(160).optional(),
  content: z.string().trim().max(10000).optional(),
  level: z.string().trim().max(24).optional(),
  audience: z.enum(['storefront', 'direct_downlines']).optional(),
  is_pinned: z.boolean().optional(),
});

export const agentMailTestSchema = z.object({
  to_email: z.string().trim().email('请输入有效的测试收件邮箱'),
});

export const agentDownlineUpdateSchema = z.object({
  tier_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const agentTicketReplySchema = z.object({
  content: z.string().trim().min(1, '回复内容不能为空').max(3000),
  mark_resolved: z.boolean().optional(),
});

export const agentTicketEscalateSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const agentApiWhitelistSchema = z.object({
  ip_whitelist: z.string().max(4000).optional().default(''),
});

export const agentBrandUpdateSchema = z.object({
  slug: z.string().trim().max(32).optional(),
  brand_name: z.string().trim().min(1, '请填写分站品牌名称').max(80).optional(),
  brand_tagline: z.string().trim().max(240).optional(),
  announcement_banner: z.string().trim().max(1000).optional(),
  support_label: z.string().trim().max(80).optional(),
  support_url: z.string().trim().max(500).optional(),
  support_note: z.string().trim().max(400).optional(),
  support_media_json: z.unknown().optional(),
  support_links_json: z.unknown().optional(),
  markup_percent: z.coerce.number().min(0).max(200).optional(),
  theme_accent: z.string().trim().max(16).optional(),
  favicon_url: z.string().trim().max(500).optional(),
  og_image_url: z.string().trim().max(500).optional(),
  seo_title: z.string().trim().max(160).optional(),
  seo_description: z.string().trim().max(400).optional(),
  footer_text: z.string().trim().max(300).optional(),
});

export const agentAffiliateConfigSchema = z.object({
  enabled: z.boolean(),
  commission_rate: z.coerce.number().min(0, '返佣比例不能小于 0').max(0.5, '返佣比例最高不超过 0.5 (50%)'),
  min_order_amount: z.coerce.number().min(0, '最低门槛不能小于 0').max(100000),
  max_reward: z.coerce.number().min(0, '单笔封顶不能小于 0').max(100000).optional().default(0),
});

export type AgentAffiliateConfigInput = z.infer<typeof agentAffiliateConfigSchema>;

export type AgentTierUpsertInput = z.infer<typeof agentTierUpsertSchema>;
export type AgentBatchPricingInput = z.infer<typeof agentBatchPricingSchema>;
export type AgentProductOverrideInput = z.infer<typeof agentProductOverrideSchema>;
export type AgentWithdrawalInput = z.infer<typeof agentWithdrawalInputSchema>;
export type AgentRechargeInput = z.infer<typeof agentRechargeInputSchema>;
export type AgentSinglePricingInput = z.infer<typeof agentSinglePricingSchema>;
export type AgentAnnouncementInput = z.infer<typeof agentAnnouncementInputSchema>;
export type AgentAnnouncementUpdateInput = z.infer<typeof agentAnnouncementUpdateSchema>;
export type AgentDownlineUpdateInput = z.infer<typeof agentDownlineUpdateSchema>;
export type AgentTicketReplyInput = z.infer<typeof agentTicketReplySchema>;
export type AgentTicketEscalateInput = z.infer<typeof agentTicketEscalateSchema>;
