import { z } from 'zod';
import { TICKET_CATEGORIES, TICKET_STATUSES } from '../constants/enums';

export const createTicketInputSchema = z.object({
  order_no: z.string().trim().max(64).optional(),
  category: z.enum(TICKET_CATEGORIES).default('after_sale'),
  subject: z.string().trim().min(2, '请输入工单主题').max(160),
  content: z.string().trim().min(2, '请描述具体问题').max(4000),
});

export const replyTicketInputSchema = z.object({
  content: z.string().trim().min(1, '回复内容不能为空').max(4000),
  status: z.enum(TICKET_STATUSES).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketInputSchema>;
export type ReplyTicketInput = z.infer<typeof replyTicketInputSchema>;
