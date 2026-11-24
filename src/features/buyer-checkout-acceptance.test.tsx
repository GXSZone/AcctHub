import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { eq } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestApp } from '../../tests/integration/helpers/test-app';
import {
  agentProductPrices,
  agents,
  agentTiers,
  categories,
  categoryGroups,
  commissionLedger,
  orders,
  products,
  users,
} from '../../worker/db/schema/index';
import { issueAuthSession } from '../../worker/domains/auth/auth.session';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { ProductCard } from '../components/ProductCard';
import type { SupportedLocale } from '../i18n';
import { agentEn } from '../i18n/namespaces/agent/en';
import { agentJa } from '../i18n/namespaces/agent/ja';
import { agentKo } from '../i18n/namespaces/agent/ko';
import { agentZhCN } from '../i18n/namespaces/agent/zh-CN';
import { agentZhTW } from '../i18n/namespaces/agent/zh-TW';
import { storefrontEn } from '../i18n/namespaces/storefront/en';
import { storefrontJa } from '../i18n/namespaces/storefront/ja';
import { storefrontKo } from '../i18n/namespaces/storefront/ko';
import { storefrontZhCN } from '../i18n/namespaces/storefront/zh-CN';
import { storefrontZhTW } from '../i18n/namespaces/storefront/zh-TW';
import type { AgentTierInfo, BootstrapPayload, OrderRecord, Product, UserProfile } from '../types';
import { AgentPortalPage } from './agent/AgentPortalPage';
import { AgentTierPayModal } from './agent/AgentTierPayModal';
import { ProductCheckoutForm } from './storefront/ProductCheckoutForm';
import { notifyOrderCompletionToast } from './storefront/useProductCheckout';

const dialog = vi.hoisted(() => ({
  open: vi.fn<(options: { description: string; confirmLabel: string }) => Promise<boolean>>(),
  captureJoin: vi.fn<(join: (tier: AgentTierInfo) => void) => void>(),
}));

const localeFixtures = {
  'zh-CN': [agentZhCN, storefrontZhCN, '9折', '9 折拿货底价', '实付 ¥112.00'],
  'zh-TW': [agentZhTW, storefrontZhTW, '9折', '9 折拿貨底價', '實付 ¥112.00'],
  en: [agentEn, storefrontEn, '10% OFF', '10% wholesale discount', 'Paid ¥112.00'],
  ja: [agentJa, storefrontJa, '10% OFF', '10% OFF の卸値', '支払額 ¥112.00'],
  ko: [agentKo, storefrontKo, '10% 할인', '도매 10% 할인', '실결제 ¥112.00'],
} as const satisfies Record<SupportedLocale, readonly [object, object, string, string, string]>;

let locale: SupportedLocale = 'zh-CN';
let app: ReturnType<typeof createTestApp>;

vi.mock('../i18n/namespaces/agent', () => ({ useAgentI18n: () => localeFixtures[locale][0] }));
vi.mock('../i18n/namespaces/storefront', () => ({ useStorefrontI18n: () => localeFixtures[locale][1] }));
vi.mock('../components/ConfirmDialog', () => ({ openConfirm: dialog.open }));
vi.mock('../queries/agent.queries', () => ({
  useAgentTiersQuery: () => ({ isLoading: false }),
  useAgentMeQuery: () => ({ data: { all_tiers: [sellerTier], total_recharged: 10 } }),
  useAgentNoticesQuery: () => ({}),
  useAgentTicketsQuery: () => ({ data: undefined }),
}));
vi.mock('./agent/AgentOnboardingView', async (load) => {
  const actual = await load<typeof import('./agent/AgentOnboardingView')>();
  return {
    ...actual,
    AgentOnboardingView: (props: Parameters<typeof actual.AgentOnboardingView>[0]) => {
      dialog.captureJoin(props.onJoinOrUpgrade);
      return <actual.AgentOnboardingView {...props} />;
    },
  };
});

const sellerTier: AgentTierInfo = {
  id: 1,
  code: 'seller',
  name: 'Seller',
  level_rank: 1,
  min_recharge: 25.5,
  discount_rate: 0.9,
  commission_rate: 0,
  sub_override_rate: 0,
  max_sub_agents: 5,
  badge_color: '#123456',
  perks: [],
};

beforeEach(() => {
  resetRateLimitBucketsForTest();
  locale = 'zh-CN';
  app = createTestApp();
});

afterEach(() => app.close());

async function seedBuyableProduct(
  basePrice: number,
  onSubsite = false,
  pricing?: { specCost?: number; customPrice?: number; tierPricing?: Product['tier_pricing'] }
) {
  const [group] = await app.db
    .insert(categoryGroups)
    .values({ slug: 'fixture', name: 'Fixture' })
    .returning();
  const [category] = await app.db
    .insert(categories)
    .values({ groupId: group.id, slug: 'buyer-catalog', name: 'Buyer catalog' })
    .returning();
  const [item] = await app.db
    .insert(products)
    .values({
      categoryId: category.id,
      slug: 'test-product',
      title: 'Test product',
      basePrice,
      stockMode: 'manual_stock',
      manualStock: 5,
      specsJson: JSON.stringify([
        { id: 'default', name: 'Standard', price: basePrice, cost_price: pricing?.specCost },
      ]),
      tierPricingJson: JSON.stringify(pricing?.tierPricing ?? []),
    })
    .returning();

  let subsiteId = 0;
  let origin = 'http://localhost';
  if (onSubsite) {
    const [seller] = await app.db
      .insert(users)
      .values({ email: 'seller@example.test', displayName: 'Seller', role: 'agent', passwordHash: 'unused' })
      .returning();
    const [tier] = await app.db
      .insert(agentTiers)
      .values({ code: sellerTier.code, name: sellerTier.name, discountRate: sellerTier.discount_rate })
      .returning();
    const [site] = await app.db
      .insert(agents)
      .values({
        userId: seller.id,
        tierId: tier.id,
        slug: 'buyer-tenant',
        brandName: 'Buyer tenant',
        markupPercent: 12,
        apiKey: 'fixture-tenant-key',
      })
      .returning();
    await app.db
      .insert(agentTiers)
      .values({ ownerAgentId: site.id, code: 'child', name: 'Child', discountRate: 0.96 });
    if (pricing?.customPrice !== undefined) {
      await app.db.insert(agentProductPrices).values({
        agentId: site.id,
        productId: item.id,
        specId: 'default',
        customPrice: pricing.customPrice,
      });
    }
    subsiteId = site.id;
    origin = 'http://buyer-tenant.localhost';
  }

  const [buyer] = await app.db
    .insert(users)
    .values({
      siteAgentId: subsiteId,
      email: 'buyer@example.test',
      displayName: 'Buyer',
      balance: 300,
      passwordHash: 'unused',
    })
    .returning();

  const user: UserProfile = {
    id: buyer.id,
    email: buyer.email,
    display_name: buyer.displayName,
    role: 'user',
    balance: buyer.balance,
  };
  const token = await issueAuthSession(app.db, app.env, buyer);
  const bootstrap = await app.jsonRequest<BootstrapPayload>(`${origin}/api/storefront/bootstrap`);
  const catalog = await app.jsonRequest<{ items: Product[] }>(
    `${origin}/api/storefront/products?category=all`
  );
  const detail = await app.jsonRequest<{ product: Product }>(`${origin}/api/storefront/products/${item.id}`);
  expect(bootstrap.ok).toBe(true);
  expect(catalog.ok).toBe(true);
  expect(detail.ok).toBe(true);
  const listed = catalog.data.items.find((product) => product.id === item.id);
  expect(listed).toBeDefined();
  if (!listed) throw new Error('目录没有返回测试商品');

  async function buy(quantity = 1) {
    const result = await app.jsonRequest<{ order: OrderRecord }>(`${origin}/api/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contact_email: buyer.email,
        product_id: item.id,
        spec_id: 'default',
        quantity,
        payment_method: 'balance',
      }),
    });
    expect(result.ok, JSON.stringify(result.data)).toBe(true);
    expect(result.data.order.status).toBe('delivered');
    return result.data.order;
  }

  return { bootstrap: bootstrap.data, listed, detailed: detail.data.product, subsiteId, user, buy };
}

function renderCheckout(fixture: Awaited<ReturnType<typeof seedBuyableProduct>>) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ProductCheckoutForm
        product={fixture.detailed}
        bootstrap={fixture.bootstrap}
        user={fixture.user}
        onOpenAuth={vi.fn()}
        onDelivered={vi.fn()}
        onRequirePayment={vi.fn()}
      />
    </QueryClientProvider>
  );
}

it('[B24] 分站目录详情、结账展示与实际订单金额一致', async () => {
  const fixture = await seedBuyableProduct(100, true);
  expect(fixture.bootstrap.tenant).toMatchObject({ isSubAgent: true, agentId: fixture.subsiteId });
  expect(fixture.listed).toMatchObject({ price: 112, wholesale_price: 96 });
  expect(fixture.detailed).toMatchObject({ price: 112, wholesale_price: 96 });
  const order = await fixture.buy();
  expect(order).toMatchObject({ unit_price: fixture.listed.price, total_amount: fixture.detailed.price });
  const [stored] = await app.db.select().from(orders).where(eq(orders.orderNo, order.order_no));
  expect(stored).toMatchObject({ agentId: fixture.subsiteId, unitPrice: 112, totalAmount: 112 });
  const checkout = renderCheckout(fixture);
  expect(checkout).toMatch(/>¥112<\/span>/);
  expect(checkout).toContain(`${storefrontZhCN.checkoutBtnPrefix} · ¥112.00`);
});

it('[B33] 网格列表与结账都保留 12.34 的完整分值', async () => {
  const fixture = await seedBuyableProduct(12.34);
  for (const viewMode of ['grid', 'list'] as const) {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProductCard product={fixture.listed} viewMode={viewMode} />
      </MemoryRouter>
    );
    expect(html).toMatch(/>¥12\.34<\/\w+>/);
  }
  const checkout = renderCheckout(fixture);
  expect(checkout).toMatch(/class="font-mono-num text-3xl font-semibold"[^>]*>¥12\.34<\/span>/);
  expect(checkout).toContain(`${storefrontZhCN.checkoutBtnPrefix} · ¥12.34`);
  expect(await fixture.buy()).toMatchObject({ unit_price: 12.34, total_amount: 12.34 });
});

it('五语阶梯预览与订单采用同一成本保护价，库存不足的档位不展示', async () => {
  const fixture = await seedBuyableProduct(100, false, {
    specCost: 80,
    tierPricing: [
      { min_qty: 2, discount_rate: 0.6 },
      { min_qty: 6, discount_rate: 0.5 },
    ],
  });
  expect(fixture.listed.specs[0]).not.toHaveProperty('cost_price');
  expect(fixture.detailed.specs[0]).not.toHaveProperty('cost_price');
  const order = await fixture.buy(2);
  expect(order).toMatchObject({ quantity: 2, unit_price: 80, total_amount: 160 });
  for (const choice of Object.keys(localeFixtures) as SupportedLocale[]) {
    locale = choice;
    const messages = localeFixtures[choice][1];
    const checkout = renderCheckout(fixture);
    expect(checkout).toContain(messages.bulkUpsellPrefix);
    expect(checkout).toContain(`¥${order.unit_price.toFixed(2)}${messages.bulkUpsellUnit}`);
    expect(checkout).not.toContain('¥60.00');
    expect(checkout).not.toContain(
      messages.bulkRuleItem.replace('{minQty}', '6').replace('{offPct}', '50').replace('{zhFold}', '5')
    );
  }
});

it('分站定制价低于当前拿货价时，目录与结账展示实际收取的底价', async () => {
  const fixture = await seedBuyableProduct(100, true, { customPrice: 80 });
  const order = await fixture.buy();
  expect(order).toMatchObject({ quantity: 1, unit_price: 90, total_amount: 90 });
  expect(fixture.listed.price).toBe(order.unit_price);
  expect(fixture.detailed.price).toBe(order.unit_price);
  expect(renderCheckout(fixture)).toContain(`${storefrontZhCN.checkoutBtnPrefix} · ¥90.00`);
});

it('[B39] 同一折扣系数用于五语展示、开通确认与实际分润备注', async () => {
  const fixture = await seedBuyableProduct(100, true);
  const order = await fixture.buy();
  const [posting] = await app.db
    .select()
    .from(commissionLedger)
    .where(eq(commissionLedger.orderNo, order.order_no));
  expect(posting).toMatchObject({
    rewardType: 'direct_sale',
    beneficiaryAgentId: fixture.subsiteId,
    amount: 22,
    note: expect.stringContaining('卖价 ¥112.00 − 9折拿货底价 ¥90.00'),
  });

  for (const [language, [, , discount, confirmation]] of Object.entries(localeFixtures)) {
    locale = language as SupportedLocale;
    dialog.captureJoin.mockClear();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AgentPortalPage user={fixture.user} onOpenAuth={vi.fn()} onRefreshUser={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(markup, language).toContain(`>${discount}<`);
    expect(dialog.captureJoin, language).toHaveBeenCalledOnce();
    const amountDue = Math.max(0, Number((sellerTier.min_recharge - 10).toFixed(2)));
    const modalMarkup = renderToStaticMarkup(
      <AgentTierPayModal
        open
        tier={sellerTier}
        isUpgrade={false}
        amountDue={amountDue}
        userBalance={100}
        paymentMethods={[{ id: 'balance', name: 'Balance', description: '', enabled: 1 }]}
        submitting={false}
        onClose={vi.fn()}
        onConfirmPay={vi.fn()}
      />
    );
    expect(modalMarkup, language).toContain(confirmation);
    expect(modalMarkup, language).toContain('¥15.50');
    expect(modalMarkup, language).not.toMatch(/\{(?:zhFold|offPct|diff)\}/);
  }
});

it('支付交付后通过五语全局气泡提示邮件与我的订单/查单入口，且商品页不再直接露出凭证卡', async () => {
  const { subscribeToasts, toast } = await import('../lib/toast');
  const fixture = await seedBuyableProduct(100, true);
  const order = await fixture.buy();
  expect(order.payment_message).toBe('已通过站内钱包余额即时扣款');
  expect(order.public_order_no).toMatch(/^AHQ-[a-f0-9]{32}$/);

  const expectedOrderNo = order.public_order_no ?? order.order_no;
  let latest: ReturnType<typeof Array<import('../lib/toast').ToastItem>> = [];
  const unsub = subscribeToasts((items) => {
    latest = items;
  });

  try {
    for (const [language, [, sf]] of Object.entries(localeFixtures)) {
      toast.clearErrors();
      notifyOrderCompletionToast(order, {
        isSignedIn: true,
        sf: sf as typeof storefrontZhCN,
      });
      const hasOrderToast = latest.some(
        (item) => item.message.includes(expectedOrderNo) && item.action?.to === '/account/orders'
      );
      expect(hasOrderToast, language).toBe(true);
      expect(
        latest.every((item) => !item.message.includes(order.delivered_payload ?? '')),
        language
      ).toBe(true);

      notifyOrderCompletionToast(order, {
        isSignedIn: false,
        sf: sf as typeof storefrontZhCN,
      });
      const hasGuestToast = latest.some(
        (item) => item.message.includes(expectedOrderNo) && item.action?.to === '/orders'
      );
      expect(hasGuestToast, language).toBe(true);
    }
  } finally {
    unsub();
  }
});
