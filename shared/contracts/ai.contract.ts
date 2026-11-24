import { z } from 'zod';
import { AI_PROVIDERS } from '../constants/enums';

export const updateAiConfigInputSchema = z.object({
  provider: z.enum(AI_PROVIDERS).optional(),
  base_url: z.string().trim().max(500).optional(),
  api_key: z.string().max(500).optional(),
  clear_api_key: z.boolean().optional(),
  model: z.string().trim().min(1).max(120).optional(),
  temperature: z.number().min(0).max(1.2).optional(),
  system_prompt: z.string().max(4000).optional(),
});

export const aiOptimizeProductInputSchema = z.object({
  scope: z.enum(['all', 'titles', 'detail', 'faq']).default('all'),
  tone: z.enum(['editorial', 'conversion', 'technical']).default('editorial'),
  instruction: z.string().trim().max(500).optional(),
  product: z.object({
    title: z.string().min(1).max(200),
    title_en: z.string().max(200).optional(),
    subtitle: z.string().max(400).optional(),
    subtitle_en: z.string().max(400).optional(),
    category_name: z.string().max(120).optional(),
    delivery_type: z.string().max(48).optional(),
    base_price: z.number().nonnegative().max(1_000_000).optional(),
    tags: z.array(z.string().max(32)).max(20).optional(),
    summary_markdown: z.string().max(4000).optional(),
    detail_markdown: z.string().max(50000).optional(),
    risk_notice: z.string().max(4000).optional(),
    faq: z
      .array(z.object({ q: z.string().max(240), a: z.string().max(2000) }))
      .max(20)
      .optional(),
  }),
});

export { AI_MODEL_PRESETS, type AiModelPreset } from '../constants/ai-presets';

export type UpdateAiConfigInput = z.infer<typeof updateAiConfigInputSchema>;
export type AiOptimizeProductInput = z.infer<typeof aiOptimizeProductInputSchema>;
