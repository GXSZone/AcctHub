import { z } from 'zod';
import { ASYNC_PAYMENT_PROVIDERS } from '../constants/enums';

/** 会员在线充值（异步收银台）入参（具体最低充值门槛由后台 balance 插件 min_topup 动态校验） */
export const accountRechargeIntentSchema = z.object({
  amount: z.coerce
    .number()
    .min(0.01, '单次余额充值金额需大于 ¥0.01 且不超过 ¥50,000')
    .max(50000, '单次余额充值金额不能超过 ¥50,000'),
  payment_method: z.enum(ASYNC_PAYMENT_PROVIDERS, {
    message: '请选择有效的在线支付网关（支付宝当面付 / 易支付 / Stripe / USDT 多链）',
  }),
});

/** 会员沙盒直充入参（仅非生产环境启用） */
export const accountSandboxRechargeSchema = z.object({
  amount: z.coerce
    .number()
    .min(0.01, '单次余额充值金额需大于 ¥0.01 且不超过 ¥50,000')
    .max(50000, '单次余额充值金额不能超过 ¥50,000'),
  payment_method: z.string().trim().min(1).max(48).optional().default('demo_instant'),
});

/** 充值卡密 (CDK) 兑换入参 */
export const redeemCdkInputSchema = z.object({
  code: z.string().trim().min(1, '请输入充值卡密 (CDK)').max(64),
  'cf-turnstile-response': z.string().max(4096).optional(),
  turnstile_token: z.string().max(4096).optional(),
});

/** 更新会员昵称入参 */
export const updateProfileInputSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(2, '显示昵称长度需在 2–32 个字符之间')
    .max(32, '显示昵称长度需在 2–32 个字符之间'),
});

/** 新增 2FA 密钥条目入参 */
export const createTotpVaultInputSchema = z.object({
  issuer: z.string().trim().max(60).optional(),
  account_name: z.string().trim().max(120).optional(),
  secret: z.string().trim().min(1, '请输入有效的 Base32 2FA 密钥（至少 8 位）').max(512),
  digits: z.coerce.number().int().optional(),
  period: z.coerce.number().int().optional(),
});

/** 批量导入 2FA 密钥入参 */
export const batchTotpVaultInputSchema = z.object({
  items: z
    .array(
      z.object({
        issuer: z.string().trim().max(60).optional(),
        account_name: z.string().trim().max(120).optional(),
        secret: z.string().trim().max(512).optional(),
        digits: createTotpVaultInputSchema.shape.digits,
        period: createTotpVaultInputSchema.shape.period,
      })
    )
    .max(50)
    .default([]),
});

/** 本地沙盒模拟支付回调入参 */
export const simulatePayInputSchema = z.object({
  intent_no: z.string().trim().min(1, '缺少支付单号 intent_no').max(64),
});

export const sandboxGatewayQuerySchema = z.object({
  intent: z.string().regex(/^PAY[0-9]{14}$/, '无效的沙盒支付单号'),
  provider: z.enum(['epay', 'stripe', 'alipay_f2f']).default('epay'),
});

/** 查单凭据仅通过请求体提交。 */
export const lookupOrdersInputSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  password: z.string().trim().max(64).optional().default(''),
  cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  'cf-turnstile-response': z.string().max(4096).optional(),
  turnstile_token: z.string().max(4096).optional(),
});

export const memberOrdersQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

/** 账单类型筛选参数 */
export const walletTransactionsQuerySchema = z.object({
  type: z.string().trim().max(32).optional().default(''),
});

export const accountAffiliateQuerySchema = z.object({
  ledger_before_id: z.coerce.number().int().positive().optional(),
  promo_before_id: z.coerce.number().int().positive().optional(),
});

export type AccountAffiliateQuery = z.infer<typeof accountAffiliateQuerySchema>;
export type AccountRechargeIntentInput = z.infer<typeof accountRechargeIntentSchema>;
export type AccountSandboxRechargeInput = z.infer<typeof accountSandboxRechargeSchema>;
export type RedeemCdkInput = z.infer<typeof redeemCdkInputSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
export type CreateTotpVaultInput = z.infer<typeof createTotpVaultInputSchema>;
export type BatchTotpVaultInput = z.infer<typeof batchTotpVaultInputSchema>;
export type SimulatePayInput = z.infer<typeof simulatePayInputSchema>;
export type LookupOrdersInput = z.infer<typeof lookupOrdersInputSchema>;
