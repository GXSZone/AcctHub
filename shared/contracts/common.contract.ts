import { z } from 'zod';

/** 通用正整数路径参数校验（如 /:id） */
export const positiveIntIdParamSchema = z.object({
  id: z.coerce.number().int().positive('无效的资源 ID'),
});

/** 通用分页查询参数 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

/** 通用成功确认响应体 */
export const okResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type OkResponse = z.infer<typeof okResponseSchema>;
