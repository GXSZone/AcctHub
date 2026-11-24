import { z } from 'zod';

/** 生产冷启动初始化向导入参契约 */
export const setupInitializeInputSchema = z.object({
  setup_secret: z.string().trim().min(1, '请输入初始化口令（对应环境变量 ADMIN_SECRET）').max(128),
  admin_email: z.string().trim().email('请输入有效的管理员邮箱地址'),
  admin_password: z.string().min(8, '管理员密码至少需要 8 位字符').max(128),
  admin_display_name: z
    .string()
    .trim()
    .min(2, '管理员昵称至少 2 个字符')
    .max(32)
    .default('AcctHub 超级管理员'),
  brand_name: z.string().trim().min(2, '品牌名称至少 2 个字符').max(48).default('AcctHub'),
  brand_tagline: z.string().trim().max(120).default('极速自动交付与多级渠道发卡平台'),
});

/** 总控操作审计日志查询契约 */
export const adminAuditLogsQuerySchema = z.object({
  action: z.string().trim().max(64).optional().default(''),
  target_type: z.string().trim().max(64).optional().default(''),
  q: z.string().trim().max(80).optional().default(''),
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
  limit: z.coerce.number().int().min(1).max(200).optional().default(80),
});

export type SetupInitializeInput = z.infer<typeof setupInitializeInputSchema>;
export type AdminAuditLogsQuery = z.infer<typeof adminAuditLogsQuerySchema>;
