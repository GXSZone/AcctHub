import { z } from 'zod';
import { USER_ROLES } from '../constants/enums';

export const loginInputSchema = z.object({
  email: z.string().trim().email('请输入有效邮箱地址'),
  password: z.string().min(6, '密码至少 6 位').max(128),
  totp_code: z.string().trim().max(12).optional(),
  'cf-turnstile-response': z.string().optional(),
  turnstile_token: z.string().optional(),
});

export const registerInputSchema = z.object({
  email: z.string().trim().email('请输入有效邮箱地址'),
  password: z.string().min(6, '密码至少 6 位').max(128),
  display_name: z.string().trim().min(1).max(40).optional(),
  referral_code: z.string().trim().max(32).optional(),
  'cf-turnstile-response': z.string().optional(),
  turnstile_token: z.string().optional(),
});

export const changePasswordInputSchema = z.object({
  current_password: z.string().min(1, '请输入当前密码'),
  new_password: z.string().min(6, '新密码至少 6 位').max(128),
});

export const topupDemoInputSchema = z.object({
  amount: z.coerce
    .number()
    .min(10, '单次体验加款至少 ¥10')
    .max(20000, '单次体验加款上限 ¥20,000')
    .default(100),
});

export const authUserSchema = z.object({
  id: z.number().int().positive(),
  site_agent_id: z.number().int().nonnegative(),
  email: z.string().email(),
  display_name: z.string(),
  role: z.enum(USER_ROLES),
  balance: z.number(),
  total_recharged: z.number(),
  referral_code: z.string().nullable().optional(),
  promo_balance: z.number().optional(),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
export type RegisterInput = z.infer<typeof registerInputSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
export type TopupDemoInput = z.infer<typeof topupDemoInputSchema>;
export type AuthUserDto = z.infer<typeof authUserSchema>;
