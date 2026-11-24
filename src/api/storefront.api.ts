/**
 * 前台商城（Storefront）领域 API 客户端
 */

import type { PublicGroupBuySessionDto } from '@shared/contracts/commerce.contract';
import type { BootstrapPayload, HelpArticle, Product } from '../types';
import { apiRequest } from './http';

export const storefrontApi = {
  bootstrap: (bypassCache = false) =>
    apiRequest<BootstrapPayload>(
      bypassCache ? '/api/storefront/bootstrap?nocache=1' : '/api/storefront/bootstrap',
      bypassCache ? { cache: 'no-store' } : undefined
    ),

  listProducts: (params: { category?: string; q?: string; tag?: string }) => {
    const sp = new URLSearchParams();
    if (params.category) sp.set('category', params.category);
    if (params.q) sp.set('q', params.q);
    if (params.tag) sp.set('tag', params.tag);
    return apiRequest<{ items: Product[] }>(`/api/storefront/products?${sp.toString()}`);
  },

  getProduct: (idOrSlug: string, accessCode?: string) => {
    const qs = accessCode?.trim() ? `?access_code=${encodeURIComponent(accessCode.trim())}` : '';
    return apiRequest<{
      product: Product;
      access_locked?: boolean;
      open_group_buys?: PublicGroupBuySessionDto[];
    }>(`/api/storefront/products/${encodeURIComponent(idOrSlug)}${qs}`);
  },

  conciergeMatch: (prompt: string) =>
    apiRequest<{ prompt: string; reasoning: string; items: Product[] }>('/api/storefront/concierge/match', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  getHelp: () => apiRequest<{ articles: HelpArticle[] }>('/api/storefront/help'),

  validateCoupon: (code: string, subtotal: number) =>
    apiRequest<{
      ok: boolean;
      coupon: {
        code: string;
        name: string;
        discount_type: string;
        discount_value: number;
        min_order_amount: number;
      };
      discount_amount: number;
      final_amount: number;
    }>('/api/storefront/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code, subtotal }),
    }),

  subscribeRestock: (payload: { product_id: number; spec_id?: string; email: string }) =>
    apiRequest<{ ok: boolean; message: string }>('/api/storefront/restock-subscribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
