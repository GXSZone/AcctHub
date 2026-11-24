import { z } from 'zod';

export const RISK_EMERGENCY_MODES = ['normal', 'hold_delivery', 'maintenance'] as const;
export type RiskEmergencyMode = (typeof RISK_EMERGENCY_MODES)[number];

/** 全站 5 维反盗刷风控配置 DTO 与校验 Schema */
export const riskControlConfigSchema = z.object({
  emergency_mode: z.enum(RISK_EMERGENCY_MODES).default('normal'),
  max_cards_5m: z.coerce.number().int().min(0).max(10000).default(30),
  max_cards_1h: z.coerce.number().int().min(0).max(50000).default(120),
  max_upstream_daily_spend: z.coerce.number().min(0).max(1000000).default(5000),
  review_order_amount_threshold: z.coerce.number().min(0).max(1000000).default(500),
  review_order_qty_threshold: z.coerce.number().int().min(0).max(1000).default(10),
  max_pending_orders_per_ip_10m: z.coerce.number().int().min(0).max(100).default(5),
  max_pending_orders_per_email_10m: z.coerce.number().int().min(0).max(100).default(5),
  min_cost_guard_enabled: z.boolean().default(true),
  alert_emails: z.string().trim().max(500).default(''),
});

export type RiskControlConfig = z.infer<typeof riskControlConfigSchema>;

export const riskEmergencyModeInputSchema = z.object({
  emergency_mode: z.enum(RISK_EMERGENCY_MODES),
  reason: z.string().trim().max(180).optional().default(''),
});

export const ipBlacklistCreateSchema = z.object({
  ip_pattern: z
    .string()
    .trim()
    .min(3, '请输入有效的 IP 或 CIDR 网段')
    .max(64)
    .regex(/^[0-9a-fA-F.:/]+$/, 'IP 或网段仅支持数字、字母、点、冒号与斜杠'),
  reason: z.string().trim().max(180).optional().default(''),
});

export const adminOrdersSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(40).optional().default('all'),
  payment_method: z.string().trim().max(40).optional().default('all'),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(100).optional().default(30),
});

export const adminManualConfirmOrderSchema = z.object({
  manual_payload: z.string().max(10000).optional().default(''),
  note: z.string().trim().max(240).optional().default(''),
});

export const adminRiskRejectSchema = z.object({
  reason: z.string().trim().min(2, '请填写驳回原因').max(240),
});

export const authForgotPasswordSchema = z.object({
  email: z.string().trim().email('请输入有效的电子邮箱'),
});

export const authResetPasswordSchema = z.object({
  email: z.string().trim().email('请输入有效的电子邮箱'),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '请输入 6 位数字验证码'),
  new_password: z.string().min(8, '新密码至少 8 位').max(128),
});

export const authChangePasswordSchema = z.object({
  current_password: z.string().min(1, '请输入当前密码').max(128),
  new_password: z.string().min(8, '新密码至少 8 位').max(128),
});

export const adminResetMemberPasswordSchema = z.object({
  new_password: z.string().min(8, '新密码至少 8 位').max(128),
});

export const legalDocsUpdateSchema = z.object({
  legal_terms: z.string().max(50000).optional(),
  legal_privacy: z.string().max(50000).optional(),
  legal_refund: z.string().max(50000).optional(),
});

export interface IpBlacklistItemDto {
  id: number;
  ip_pattern: string;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface RiskEventDto {
  id: number;
  event_type: string;
  severity: string;
  order_no: string;
  buyer_ip: string;
  contact_email: string;
  summary: string;
  detail_json: string;
  mail_alert_count: number;
  created_at: string;
}

export interface CardReverseLookupItemDto {
  card_id: number;
  product_id: number;
  product_title: string;
  spec_id: string;
  status: string;
  is_loop: boolean;
  card_content: string;
  order_no: string | null;
  contact_email: string | null;
  buyer_ip: string | null;
  order_status: string | null;
  sold_at: string | null;
  created_at: string;
}
