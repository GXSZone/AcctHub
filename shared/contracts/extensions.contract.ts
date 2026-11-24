import { z } from 'zod';

export const BUSINESS_WEBHOOK_EVENTS = ['order.created', 'order.delivered', 'order.refunded'] as const;
export type BusinessWebhookEvent = (typeof BUSINESS_WEBHOOK_EVENTS)[number];

export const DISPLAY_CURRENCIES = ['CNY', 'USD', 'HKD', 'JPY', 'KRW'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const createOutboundWebhookSchema = z.object({
  name: z.string().trim().min(1, '请填写 Webhook 名称').max(64),
  url: z.string().trim().url('请输入有效的 HTTP(S) 推送地址').max(300),
  secret: z.string().trim().max(160).optional().default(''),
  events: z.array(z.enum(BUSINESS_WEBHOOK_EVENTS)).min(1, '至少勾选 1 个订阅事件'),
  enabled: z.boolean().optional().default(true),
  allow_fulfill_override: z.boolean().optional().default(false),
});

export const updateOutboundWebhookSchema = createOutboundWebhookSchema.partial();

export const admin2FaEnableSchema = z.object({
  secret: z.string().trim().min(16).max(64),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '请输入 6 位数字动态验证码'),
});

export const admin2FaDisableSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '请输入当前 6 位动态验证码以关闭 2FA'),
});

export const externalFulfillCallbackSchema = z.object({
  order_no: z.string().trim().min(4).max(64),
  delivered_payload: z.string().trim().min(1, '回填凭证内容不能为空').max(20000),
});

export interface SelectableCardPublicDto {
  id: number;
  public_label: string;
  select_fee: number;
}

export interface OutboundWebhookDto {
  id: number;
  name: string;
  url: string;
  has_secret: boolean;
  secret_masked: string;
  events: BusinessWebhookEvent[];
  enabled: boolean;
  allow_fulfill_override: boolean;
  last_status: number | null;
  last_error: string;
  last_triggered_at: string | null;
  created_at: string;
}

export interface FxDisplayRatesDto {
  base: 'CNY';
  updated_at: string;
  rates: Record<DisplayCurrency, number>;
}
