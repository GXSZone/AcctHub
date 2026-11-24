import { z } from 'zod';

export const bundleItemSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  spec_id: z.string().trim().min(1).max(64).default('default'),
  quantity: z.coerce.number().int().min(1).max(20).default(1),
  title: z.string().trim().max(200).optional(),
});

export interface PublicGroupBuySessionDto {
  id: number;
  code: string;
  product_id: number;
  spec_id: string;
  leader_name: string;
  required_size: number;
  current_size: number;
  remaining_slots: number;
  group_price: number;
  status: 'open' | 'completed' | 'expired_refunded';
  expires_at: string;
  created_at: string;
}

export type BundleItemDto = z.infer<typeof bundleItemSchema>;
