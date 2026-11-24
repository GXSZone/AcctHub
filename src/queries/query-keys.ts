/**
 * 全站 TanStack Query v5 统一 Query Key 工厂
 */

import type { AccountAffiliateQuery } from '@shared/contracts/account.contract';

export const queryKeys = {
  bootstrap: (host?: string) => ['storefront', 'bootstrap', host || 'localhost'] as const,
  products: (params: { category?: string; q?: string; tag?: string }) =>
    ['storefront', 'products', params] as const,
  product: (idOrSlug: string, accessCode = '') => ['storefront', 'product', idOrSlug, accessCode] as const,
  helpArticles: () => ['storefront', 'help'] as const,

  me: (scope: string) => ['auth', 'me', scope] as const,

  accountSummary: () => ['account', 'summary'] as const,
  accountAffiliate: (page: AccountAffiliateQuery = {}, host?: string, scope?: string) =>
    ['account', 'affiliate', host || 'localhost', scope || 'guest', page] as const,
  accountOrders: () => ['account', 'orders'] as const,
  accountTransactions: (type?: string) => ['account', 'transactions', type || 'all'] as const,
  accountTickets: () => ['account', 'tickets'] as const,
  accountTicket: (id: number) => ['account', 'ticket', id] as const,
  accountSecurity: () => ['account', 'security'] as const,
  totpVault: (scope: string) => ['account', 'totp-vault', scope] as const,

  paymentIntent: (intentNo?: string, viewToken?: string) => ['payment', intentNo, viewToken] as const,

  agentTiers: () => ['agent', 'tiers'] as const,
  agentMe: () => ['agent', 'me'] as const,
  agentPricing: () => ['agent', 'pricing'] as const,
  agentNotices: (userId?: number) => ['agent', 'notices', userId ?? 'anon'] as const,
  agentTickets: () => ['agent', 'tickets'] as const,
  agentTicket: (id: number) => ['agent', 'ticket', id] as const,
  agentMailConfig: () => ['agent', 'mail-config'] as const,
  agentAffiliateConfig: () => ['agent', 'affiliate-config'] as const,

  adminOverview: (scope: string) => ['admin', 'overview', scope] as const,
  adminFinance: (days: number) => ['admin', 'finance', days] as const,
  adminCashflows: () => ['admin', 'finance', 'cashflows'] as const,
  adminMembers: (params: { q?: string; role?: string; status?: string; page?: number }) =>
    ['admin', 'members', params] as const,
  adminMemberTransactions: (userId: number) => ['admin', 'members', userId, 'transactions'] as const,
  adminMailConfig: () => ['admin', 'mail-config'] as const,
  adminAiConfig: () => ['admin', 'ai-config'] as const,
  adminCards: (productId: number) => ['admin', 'cards', productId] as const,
  adminTicket: (id: number) => ['admin', 'ticket', id] as const,

  upstreamSources: () => ['admin', 'upstreams', 'sources'] as const,
  upstreamItems: (sourceId: number) => ['admin', 'upstreams', 'items', sourceId] as const,
  upstreamBindings: (productId?: number) => ['admin', 'upstreams', 'bindings', productId ?? 'all'] as const,
  upstreamLedger: () => ['admin', 'upstreams', 'ledger'] as const,
};
