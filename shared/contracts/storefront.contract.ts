import { z } from 'zod';

/** 前台商品列表查询参数 */
export const storefrontProductsQuerySchema = z.object({
  category: z.string().trim().max(80).default('featured'),
  q: z.string().trim().max(120).optional().default(''),
  tag: z.string().trim().max(60).optional().default(''),
});

/** 前台商品详情路径参数 */
export const storefrontProductParamSchema = z.object({
  idOrSlug: z.string().trim().min(1, '商品标识不能为空').max(120),
});

/** 智能导购意图匹配入参 */
export const conciergeMatchInputSchema = z.object({
  prompt: z.string().trim().max(500).optional().default(''),
});

/** 结账页优惠券预检入参 */
export const validateCouponInputSchema = z.object({
  code: z.string().trim().min(1, '请输入优惠券码').max(64),
  subtotal: z.coerce.number().nonnegative().optional().default(0),
});

export type StorefrontProductsQuery = z.infer<typeof storefrontProductsQuerySchema>;
export type ConciergeMatchInput = z.infer<typeof conciergeMatchInputSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponInputSchema>;
