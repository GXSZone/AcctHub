import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ProductCard } from '../components/ProductCard';
import type { AgentInfo, AgentTierInfo, BootstrapPayload, Product, UserProfile } from '../types';
import { AccountAffiliateTab } from './account/AccountAffiliateTab';
import { AgentDomainCard } from './agent/AgentDomainCard';
import { AgentPortalHeader } from './agent/AgentPortalHeader';
import { getStorefrontAgentRate } from './storefront/agent-pricing';
import { ProductCheckoutForm } from './storefront/ProductCheckoutForm';

vi.mock('../i18n', async (load) => ({
  ...(await load<typeof import('../i18n')>()),
  useI18n: () => ({ locale: 'zh-CN', messages: { actionBuy: '购买', actionPreorder: '预订' } }),
}));
vi.mock('../i18n/namespaces/storefront', async () => {
  const { storefrontZhCN } = await import('../i18n/namespaces/storefront/zh-CN');
  return { useStorefrontI18n: () => storefrontZhCN };
});
vi.mock('../i18n/namespaces/agent', async () => {
  const { agentZhCN } = await import('../i18n/namespaces/agent/zh-CN');
  return { useAgentI18n: () => agentZhCN };
});
vi.mock('../i18n/namespaces/account', async () => {
  const { accountEn } = await import('../i18n/namespaces/account/en');
  return { useAccountI18n: () => accountEn };
});
vi.mock('../queries/account.queries', () => ({
  useAccountAffiliateQuery: () => ({
    data: {
      available_on_site: true,
      affiliate_enabled: true,
      promo_balance: 0,
      min_order_amount: 37.25,
      commission_rate: 0.05,
      referred_count: 0,
      settled_reward_total: 0,
      total_reward: 0,
      pending_reward: 0,
      promo_transactions: [],
      reward_history: [],
      affiliate_orders: [],
      recent_rewards: [],
      ledgers: [],
    },
  }),
}));

const item: Product = {
  id: 42,
  category_id: 1,
  slug: 'fixture-item',
  title: '商品',
  title_en: 'Product',
  subtitle: '',
  subtitle_en: '',
  icon_key: 'sparkles',
  accent_color: '#D97757',
  price: 12.34,
  base_price: 12.34,
  original_price: null,
  wholesale_price: 11.11,
  available_stock: 5,
  stock_label: '有库存',
  stock_mode: 'manual_stock',
  seat_total: 0,
  seat_used: 0,
  summary_markdown: '',
  detail_markdown: '',
  risk_notice: '',
  faq: [],
  custom_fields: [],
  tags: [],
  specs: [],
  delivery_type: 'auto',
  warranty_type: 'none',
  is_featured: false,
  is_active: true,
  sort_order: 0,
  sales_count: 0,
};

it('[B24] 分站商品卡和结账表单使用直属代理的实际折率', () => {
  const bootstrap: BootstrapPayload = {
    tenant: {
      isSubAgent: true,
      agentId: 10,
      slug: 'fixture',
      brandName: '分站',
      brandTagline: null,
      markupPercent: 25,
      commissionRate: 0,
    },
    settings: {},
    groups: [],
    counts: { all: 1, featured: 0 },
    announcements: [],
    payment_methods: [],
  };
  const user: UserProfile = {
    id: 7,
    role: 'agent',
    email: 'child@example.test',
    display_name: '直属代理',
    balance: 100,
    agent: { id: 11, parent_agent_id: 10, status: 'active' } as AgentInfo,
    agent_tier: { name: '分站等级', discount_rate: 0.96 } as AgentTierInfo,
  };
  const product: Product = {
    ...item,
    base_price: 100,
    price: 125,
    wholesale_price: 97,
    specs: [{ id: 'base', name: '规格', base_price: 100, price: 125 }],
  };
  const agentRate = getStorefrontAgentRate(user, bootstrap.tenant);
  const catalog = renderToStaticMarkup(
    <MemoryRouter>
      <ProductCard
        product={product}
        viewMode="grid"
        showWholesale={agentRate !== null}
        agentRate={agentRate}
      />
    </MemoryRouter>
  );
  const checkout = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProductCheckoutForm
        product={product}
        bootstrap={bootstrap}
        user={user}
        onOpenAuth={vi.fn()}
        onDelivered={vi.fn()}
        onRequirePayment={vi.fn()}
      />
    </QueryClientProvider>
  );
  expect(catalog).toContain('¥96');
  expect(checkout).toContain('¥96');
  expect(getStorefrontAgentRate(user, { ...bootstrap.tenant, agentId: 9 })).toBeNull();
});

it.each(['grid', 'list'] as const)('[B33] 商品 %s 价格保留分值', (viewMode) => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProductCard product={item} viewMode={viewMode} />
    </MemoryRouter>
  );
  expect(html).toContain('¥12.34');
});

it('[B34] 旧商品保留真实席位数且席位图最多绘制二十个节点', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ProductCard
        product={{ ...item, stock_mode: 'seats', seat_total: 200, seat_used: 50 }}
        viewMode="grid"
      />
    </MemoryRouter>
  );
  expect(html).toContain('已入座 50/200 席');
  expect(html.match(/w-2 h-2 rounded-full inline-block/g)).toHaveLength(20);
});

it('[B39] 代理工作台用九折表示 0.90', () => {
  const html = renderToStaticMarkup(
    <AgentPortalHeader
      agent={{ brand_name: '店' } as AgentInfo}
      currentTier={{ name: '一级', discount_rate: 0.9 } as AgentTierInfo}
      storefrontPublicUrl="https://example.test"
      upstreamNotices={[]}
      upstreamPopup={null}
      onOpenUpstreamPopup={vi.fn()}
      onViewUpstreamNotice={vi.fn()}
    />
  );
  expect(html).toContain('一级 · 9折底价');
});

it('[B40] 英文推广页在第二段显示实际实付门槛', () => {
  const html = renderToStaticMarkup(<AccountAffiliateTab onToast={vi.fn()} />);
  expect(html).toContain('¥37.25');
  expect(html).not.toContain('{minAmt}');
});

it.each([
  [true, '自动签发 HTTPS 证书', '平台将人工审核并激活'],
  [false, '平台将人工审核并激活', '自动签发 HTTPS 证书'],
] as const)('[B54] 域名卡片按 SaaS 配置显示接入流程 (%s)', (enabled, expected, hidden) => {
  const html = renderToStaticMarkup(
    <AgentDomainCard
      agent={{ slug: 'fixture' } as AgentInfo}
      domainConfig={{
        neutral_base_domain: 'example.test',
        saas_cname_target: 'cname.example.test',
        cf_saas_enabled: enabled,
      }}
      onToast={vi.fn()}
      onError={vi.fn()}
    />
  );
  expect(html).toContain(expected);
  expect(html).not.toContain(hidden);
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
