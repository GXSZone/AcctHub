import { z } from 'zod';
import { MAIL_PROVIDERS } from '../constants/enums';

export const updateMailConfigInputSchema = z.object({
  enabled: z.boolean().optional(),
  auto_send_order: z.boolean().optional(),
  auto_send_restock: z.boolean().optional(),
  provider: z.enum(MAIL_PROVIDERS).optional(),
  from_name: z.string().trim().max(80).optional(),
  from_email: z.string().trim().max(160).optional(),
  reply_to: z.string().trim().max(160).optional(),
  api_key: z.string().max(500).optional(),
  clear_api_key: z.boolean().optional(),
  api_endpoint: z.string().trim().max(500).optional(),
  mailgun_domain: z.string().trim().max(200).optional(),
  footer_note: z.string().trim().max(500).optional(),
  order_email_subject_tpl: z.string().trim().max(240).optional(),
  order_email_body_tpl: z.string().max(15000).optional(),
});

export const testMailInputSchema = z.object({
  to_email: z.string().trim().email('请输入有效的测试收件邮箱'),
});

export type UpdateMailConfigInput = z.infer<typeof updateMailConfigInputSchema>;
export type TestMailInput = z.infer<typeof testMailInputSchema>;
