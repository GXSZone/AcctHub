import { z } from 'zod';
import { BUSINESS_LIMITS } from '../constants/limits';

// 限制下单自定义字段的键名、键值长度及总键数，防止构造超大 JSON 膨胀 D1 存储
const boundedCustomInputsSchema = z
  .record(z.string().trim().min(1).max(48), z.string().max(500))
  .refine((obj) => Object.keys(obj).length <= 16, '自定义表单字段数量不得超过 16 项')
  .optional();

export const createOrderInputSchema = z.object({
  product_id: z.number().int().positive(),
  spec_id: z.string().trim().min(1).max(64).optional(),
  quantity: z.number().int().min(1).max(BUSINESS_LIMITS.MAX_ORDER_QUANTITY).default(1),
  contact_email: z.string().trim().email('接收邮箱格式不正确'),
  query_password: z.string().trim().max(64).optional(),
  payment_method: z.string().trim().min(1).max(48).default('balance'),
  coupon_code: z.string().trim().max(64).optional(),
  use_promo_balance: z.boolean().optional(),
  custom_inputs: boundedCustomInputsSchema,
  idempotency_key: z.string().trim().max(64).optional(),
  checkout_secret: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  'cf-turnstile-response': z.string().max(4096).optional(),
  turnstile_token: z.string().max(4096).optional(),
  access_code: z.string().trim().max(64).optional(),
  group_buy_mode: z.enum(['start', 'join']).optional(),
  group_buy_code: z.string().trim().max(32).optional(),
  selected_card_id: z.coerce.number().int().positive().optional(),
});

export const recoverCheckoutInputSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(64),
  checkout_secret: z.string().regex(/^[a-f0-9]{64}$/),
});

export const resellerOrderInputSchema = z.object({
  product_id: z.number().int().positive(),
  spec_id: z.string().trim().min(1).max(64).optional(),
  quantity: z.number().int().min(1).max(BUSINESS_LIMITS.MAX_ORDER_QUANTITY).default(1),
  customer_ref: z.string().trim().max(120).optional(),
  out_trade_no: z.string().trim().max(80).optional(),
  idempotency_key: z.string().trim().max(80).optional(),
  custom_inputs: boundedCustomInputsSchema,
});

export const restockSubscribeInputSchema = z.object({
  product_id: z.number().int().positive(),
  spec_id: z.string().trim().min(1).max(64).default('default'),
  email: z.string().trim().email('请输入有效邮箱'),
});

export type CreateOrderInput = z.infer<typeof createOrderInputSchema>;
export type ResellerOrderInput = z.infer<typeof resellerOrderInputSchema>;
export type RestockSubscribeInput = z.infer<typeof restockSubscribeInputSchema>;
