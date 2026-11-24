/**
 * 总控 AI 文案与商品优化引擎领域 API 客户端
 */

import type { AiProvider } from '@shared/constants/enums';
import { apiRequest } from './http';

export type AiProviderType = AiProvider;

export interface AiConfigResponse {
  provider: AiProviderType;
  base_url: string;
  model: string;
  temperature: number;
  system_prompt: string;
  has_api_key: boolean;
  api_key_masked: string;
}

export interface AiOptimizeSuggestion {
  title?: string;
  title_en?: string;
  subtitle?: string;
  subtitle_en?: string;
  tags?: string[];
  summary_markdown?: string;
  detail_markdown?: string;
  risk_notice?: string;
  faq?: Array<{ q: string; a: string }>;
  reasoning?: string;
}

export const aiApi = {
  getConfig: () => apiRequest<{ config: AiConfigResponse }>('/api/admin/ai/config', {}, { admin: true }),

  updateConfig: (payload: {
    provider?: AiProviderType;
    base_url?: string;
    api_key?: string;
    clear_api_key?: boolean;
    model?: string;
    temperature?: number;
    system_prompt?: string;
  }) =>
    apiRequest<{ ok: boolean; config: AiConfigResponse }>(
      '/api/admin/ai/config',
      { method: 'PUT', body: JSON.stringify(payload) },
      { admin: true }
    ),

  testConnection: () =>
    apiRequest<{ ok: boolean; provider: AiProviderType; model: string; duration_ms: number; reply: string }>(
      '/api/admin/ai/test',
      { method: 'POST' },
      { admin: true }
    ),

  optimizeProduct: (payload: {
    scope?: 'all' | 'titles' | 'detail' | 'faq';
    tone?: 'editorial' | 'conversion' | 'technical';
    instruction?: string;
    product: {
      title: string;
      title_en?: string;
      subtitle?: string;
      subtitle_en?: string;
      category_name?: string;
      delivery_type?: string;
      base_price?: number;
      tags?: string[];
      summary_markdown?: string;
      detail_markdown?: string;
      risk_notice?: string;
      faq?: Array<{ q: string; a: string }>;
    };
  }) =>
    apiRequest<{
      ok: boolean;
      provider: AiProviderType;
      model: string;
      duration_ms: number;
      suggestion: AiOptimizeSuggestion;
    }>('/api/admin/ai/optimize-product', { method: 'POST', body: JSON.stringify(payload) }, { admin: true }),
};
