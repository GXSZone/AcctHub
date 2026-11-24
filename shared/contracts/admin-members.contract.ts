import { z } from 'zod';

export const USER_ACCOUNT_STATUSES = ['active', 'blacklisted'] as const;
export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

/** 总控后台会员列表查询参数 */
export const adminMembersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['all', 'user', 'agent', 'admin']).optional().default('all'),
  status: z.enum(['all', 'active', 'blacklisted']).optional().default('all'),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  page_size: z.coerce.number().int().min(5).max(100).optional().default(20),
});

export type AdminMembersQuery = z.infer<typeof adminMembersQuerySchema>;

/** 总控后台人工调账请求体（正数加款、负数扣款，强制写不可变钱包流水） */
export const adminAdjustMemberBalanceSchema = z.object({
  amount: z
    .number()
    .finite()
    .refine((v) => Math.abs(v) >= 0.01 && Math.abs(v) <= 100_000, {
      message: '单次调账金额绝对值需在 ¥0.01 – ¥100,000 之间',
    }),
  reason: z.string().trim().min(2, '请填写至少 2 个字的调账原因').max(180, '调账原因不超过 180 字'),
});

export type AdminAdjustMemberBalanceInput = z.infer<typeof adminAdjustMemberBalanceSchema>;

/** 总控后台更新会员账号风控状态（正常 / 冻结 / 拉黑） */
export const adminUpdateMemberStatusSchema = z.object({
  status: z.enum(USER_ACCOUNT_STATUSES),
  reason: z.string().trim().max(180, '备注不超过 180 字').optional().default(''),
});

export type AdminUpdateMemberStatusInput = z.infer<typeof adminUpdateMemberStatusSchema>;

export interface AdminMemberItemDto {
  id: number;
  email: string;
  display_name: string;
  role: 'user' | 'agent' | 'admin' | string;
  status: UserAccountStatus | string;
  status_note: string;
  site_agent_id: number;
  site_slug: string | null;
  site_brand: string | null;
  agent_id: number | null;
  agent_slug: string | null;
  agent_brand: string | null;
  agent_status: string | null;
  balance: number;
  promo_balance: number;
  total_recharged: number;
  order_count: number;
  total_spent: number;
  created_at: string;
}

export interface AdminMembersSummaryDto {
  total_users: number;
  agent_users: number;
  normal_users: number;
  total_balance: number;
  total_promo_balance: number;
}
