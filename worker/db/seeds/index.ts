/**
 * 本地开发演示数据灌入引擎（100% Drizzle ORM，严格零运行时 DDL）
 * 表结构完全由 migrations/*.sql 权威建表驱动；生产与测试环境绝不写入任何演示数据。
 */

import { and, eq, sql } from 'drizzle-orm';
import { type Env, isDevOrTestEnv } from '../../env';
import { hashPassword } from '../../infra/auth-crypto';
import { INVENTORY_CREDENTIAL_SCOPE } from '../../infra/credential-storage';
import { encryptSecret, sha256Hex } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import {
  agents,
  agentTiers,
  announcements,
  categories,
  categoryGroups,
  coupons,
  helpArticles,
  paymentPlugins,
  productCards,
  products,
  siteSettings,
  tenantDomains,
  tenantSettings,
  upstreamSources,
  users,
  walletTransactions,
} from '../schema';
import { seedAgentsAndMembersTopology } from './seed-agents-topology';
import { seedCommerceModesShowcase } from './seed-commerce-modes';
import { ensureDemoMemberAccount } from './seed-demo-member';
import { seedOpsAndRiskEcosystem } from './seed-ops-ecosystem';
import { DEMO_PRODUCTS_PART_A } from './seed-products-a.data';
import { DEMO_PRODUCTS_PART_B } from './seed-products-b.data';
import {
  DEMO_ANNOUNCEMENTS,
  DEMO_CATEGORIES,
  DEMO_CATEGORY_GROUPS,
  DEMO_HELP_ARTICLES,
  DEMO_PAYMENT_PLUGINS,
  DEMO_SITE_SETTINGS,
} from './seed-static.data';
import { DEMO_MAIN_AGENT_TIERS, DEMO_STUDIO_SUB_TIERS } from './seed-tiers.data';
import { seedTransactionsAndFinanceLedger } from './seed-transactions-ledger';

const FULL_DEMO_PACK_KEY = 'demo_seed_pack_version';
const FULL_DEMO_PACK_VERSION = 'v2_full_closed_loop';

const seededDbs = new WeakSet<D1Database>();
const seedingPromises = new WeakMap<D1Database, Promise<void>>();

function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function ensureDemoSeeded(env: Env): Promise<void> {
  // 仅在本地开发环境灌入演示数据，test / staging / production 环境严禁自动写入演示数据
  if (!isDevOrTestEnv(env) || String(env.APP_ENV || '').toLowerCase() === 'test') {
    return;
  }
  if (seededDbs.has(env.DB)) return;
  const inflight = seedingPromises.get(env.DB);
  if (inflight) return inflight;

  const task = runDemoSeedOnce(env)
    .then(() => {
      seededDbs.add(env.DB);
    })
    .finally(() => {
      seedingPromises.delete(env.DB);
    });
  seedingPromises.set(env.DB, task);
  return task;
}

async function runDemoSeedOnce(env: Env): Promise<void> {
  const db = createDb(env.DB);

  // migrations/0004 会预置 3 条增长默认开关到 site_settings，因此必须检查商品与品牌标记，防止全新空库误跳过种子灌入
  const [[brandRow], [prodCount]] = await Promise.all([
    db
      .select({ key: siteSettings.key })
      .from(siteSettings)
      .where(eq(siteSettings.key, 'brand_name'))
      .limit(1),
    db.select({ c: sql<number>`count(*)` }).from(products),
  ]);

  if (brandRow && Number(prodCount?.c || 0) > 0) {
    // 对已存在的本地开发库幂等补种普通演示会员与全功能闭环模拟包
    await ensureDemoMemberAccount(db);
    await ensureFullDemoEcosystemSeeded(db, env);
    return;
  }

  // 1. 站点配置（按批写入严守 Cloudflare D1 单句 100 绑定参数上限）
  for (const batch of chunkRows(DEMO_SITE_SETTINGS, 10)) {
    await db
      .insert(siteSettings)
      .values(batch.map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  }

  // 2. 演示优惠券
  await db
    .insert(coupons)
    .values({
      code: 'WELCOME10',
      name: '新人专享立减 ¥10',
      discountType: 'fixed',
      discountValue: 10,
      minOrderAmount: 50,
      maxUses: 500,
      isActive: 1,
    })
    .onConflictDoNothing();

  // 3. 商品分组与子分类
  await db
    .insert(categoryGroups)
    .values([...DEMO_CATEGORY_GROUPS])
    .onConflictDoNothing();

  const groupRows = await db
    .select({ id: categoryGroups.id, slug: categoryGroups.slug })
    .from(categoryGroups);
  const groupIdMap = new Map(groupRows.map((g) => [g.slug, g.id]));

  for (const batch of chunkRows(DEMO_CATEGORIES, 5)) {
    await db
      .insert(categories)
      .values(
        batch.map((c) => ({
          groupId: groupIdMap.get(c.groupSlug) || 1,
          slug: c.slug,
          name: c.name,
          nameEn: c.nameEn,
          icon: c.icon,
          badgeText: c.badgeText,
          schemaType: c.schemaType,
          sortOrder: c.sortOrder,
        }))
      )
      .onConflictDoNothing();
  }

  const catRows = await db.select({ id: categories.id, slug: categories.slug }).from(categories);
  const catIdMap = new Map(catRows.map((c) => [c.slug, c.id]));
  const firstCatId = catRows[0]?.id ?? 1;

  // 4. 内置上游仿真沙盒源
  await db
    .insert(upstreamSources)
    .values({
      name: '星云海外货源池（内置仿真适配器）',
      adapterType: 'mock_sandbox',
      baseUrl: 'https://sandbox.upstream.internal/v1/catalog',
      apiKeyEnc: await encryptSecret(env, 'up_live_demo_token_2026'),
      fieldMappingJson: JSON.stringify({
        list_path: 'data.items',
        id_field: 'sku_code',
        title_field: 'item_name',
        category_field: 'group_name',
        price_field: 'wholesale_cny',
        stock_field: 'qty_left',
        status_field: 'sale_state',
      }),
      filterRulesJson: JSON.stringify({
        include_keywords: [],
        exclude_keywords: ['测试', '内部禁用'],
        min_cost_price: 0,
        max_cost_price: 5000,
      }),
      pricingRulesJson: JSON.stringify({
        markup_percent: 25,
        markup_fixed: 0,
        rounding: 'point9',
        price_spike_guard_pct: 35,
      }),
      outOfStockAction: 'mark_sold_out',
      autoRepublishOnRestock: 1,
      defaultCategoryId: firstCatId,
      syncIntervalMinutes: 15,
      autoSyncEnabled: 1,
      cachedBalance: 1280,
      balanceUpdatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      status: 'active',
    })
    .onConflictDoNothing();

  // 5. 演示商品与默认卡密库存
  const allProducts = [...DEMO_PRODUCTS_PART_A, ...DEMO_PRODUCTS_PART_B];
  for (const p of allProducts) {
    const costPrice = Number((p.basePrice * 0.6).toFixed(2));
    await db
      .insert(products)
      .values({
        categoryId: catIdMap.get(p.categorySlug) || firstCatId,
        slug: p.slug,
        title: p.title,
        titleEn: p.titleEn,
        subtitle: p.subtitle,
        subtitleEn: p.subtitleEn,
        iconKey: p.iconKey,
        accentColor: p.accentColor,
        deliveryType: p.deliveryType,
        tagsJson: JSON.stringify(p.tags),
        basePrice: p.basePrice,
        originalPrice: p.originalPrice,
        costPrice,
        wholesaleDiscount: p.wholesaleDiscount,
        stockMode: p.stockMode,
        manualStock: p.manualStock,
        seatTotal: p.seatTotal,
        seatUsed: p.seatUsed,
        summaryMarkdown: p.summaryMarkdown,
        detailMarkdown: p.detailMarkdown,
        riskNotice: p.riskNotice,
        warrantyType: p.warrantyType,
        warrantyDays: p.warrantyDays,
        warrantySummary: p.warrantySummary,
        faqJson: JSON.stringify(p.faq),
        customFieldsJson: JSON.stringify(p.customFields),
        specsJson: JSON.stringify(p.specs),
        isFeatured: p.isFeatured,
        sortOrder: p.sortOrder,
        salesCount: p.salesCount,
      })
      .onConflictDoNothing();

    const [prodRow] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, p.slug))
      .limit(1);

    if (prodRow && p.stockMode === 'cards') {
      const cardRows: Array<{ productId: number; specId: string; cardContent: string; status: string }> = [];
      for (const spec of p.specs) {
        for (let i = 1; i <= 6; i++) {
          const cardContent = p.slug.includes('gmail')
            ? `us.clean.${prodRow.id}${i}@gmail.com----AcctHub#2026${i}----rec.${i}@outlook.com`
            : p.slug.includes('claude') && spec.id === 'official_topup'
              ? `CLAUDE-TOPUP-VOUCHER-${prodRow.id}${i}X9-${Math.random().toString(36).slice(2, 6).toUpperCase()} (兑换说明: 提交工单或自助链接激活)`
              : `member.${p.slug.slice(0, 6)}.${i}@accthub.mail----Pass!${2026 + i}Ah----2FA:JBSWY3DPEHPK3PXP`;
          cardRows.push({
            productId: prodRow.id,
            specId: spec.id,
            cardContent: await encryptSecret(env, cardContent, INVENTORY_CREDENTIAL_SCOPE),
            status: 'available',
          });
        }
      }
      for (const batch of chunkRows(cardRows, 6)) {
        await db.insert(productCards).values(batch);
      }
    }
  }

  // 6. 主站 4 级代理等级（分批写入防超 D1 绑定参数上限）
  for (const batch of chunkRows(DEMO_MAIN_AGENT_TIERS, 2)) {
    await db
      .insert(agentTiers)
      .values(
        batch.map((t) => ({
          ownerAgentId: 0,
          code: t.code,
          name: t.name,
          levelRank: t.levelRank,
          minRecharge: t.minRecharge,
          discountRate: t.discountRate,
          commissionRate: t.commissionRate,
          subOverrideRate: t.subOverrideRate,
          maxSubAgents: t.maxSubAgents,
          badgeColor: t.badgeColor,
          perksJson: JSON.stringify(t.perks),
        }))
      )
      .onConflictDoNothing();
  }

  const [silverTier] = await db
    .select({ id: agentTiers.id })
    .from(agentTiers)
    .where(and(eq(agentTiers.ownerAgentId, 0), eq(agentTiers.code, 'silver')))
    .limit(1);

  // 7. 演示用户、管理员与示例代理分站 @studio
  const [demoHash, adminHash] = await Promise.all([hashPassword('demo123456'), hashPassword('admin123456')]);
  await ensureDemoMemberAccount(db);
  await db
    .insert(users)
    .values([
      {
        siteAgentId: 0,
        email: 'demo@accthub.dev',
        displayName: '林知行 · 体验官',
        passwordHash: demoHash,
        role: 'agent',
        balance: 358.8,
        totalRecharged: 600,
      },
      {
        siteAgentId: 0,
        email: 'admin@accthub.dev',
        displayName: 'AcctHub 总控管理员',
        passwordHash: adminHash,
        role: 'admin',
        balance: 9999,
        totalRecharged: 0,
      },
    ])
    .onConflictDoNothing();

  const [demoUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'demo@accthub.dev')))
    .limit(1);
  const [adminUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'admin@accthub.dev')))
    .limit(1);

  for (const seedBal of [
    { user: demoUser, amount: 358.8, refNo: 'SEED-DEMO-INIT', note: '演示代理初始化余额' },
    { user: adminUser, amount: 9999, refNo: 'SEED-ADMIN-INIT', note: '总控管理员初始化余额' },
  ]) {
    if (!seedBal.user) continue;
    const existsTx = await db
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.userId, seedBal.user.id), eq(walletTransactions.refNo, seedBal.refNo)))
      .limit(1);
    if (existsTx.length === 0) {
      await db.insert(walletTransactions).values({
        userId: seedBal.user.id,
        type: 'recharge',
        amount: seedBal.amount,
        balanceAfter: seedBal.amount,
        refNo: seedBal.refNo,
        note: seedBal.note,
      });
    }
  }

  if (demoUser) {
    const demoRawKey = 'ah_agent_DEMOSTUDIO2026';
    const [demoKeyHash, demoKeyEnc] = await Promise.all([
      sha256Hex(demoRawKey),
      encryptSecret(env, demoRawKey),
    ]);
    await db
      .insert(agents)
      .values({
        userId: demoUser.id,
        tierId: silverTier?.id ?? null,
        slug: 'studio',
        brandName: '星尘 AI 研选社',
        brandTagline: '精选 AI 与数字席位服务平台 · 极速自动交付',
        markupPercent: 10,
        commissionRate: 15,
        apiKey: crypto.randomUUID(),
        apiKeyHash: demoKeyHash,
        apiKeyEnc: demoKeyEnc,
        status: 'active',
        totalRevenue: 4280.5,
        totalCommission: 642.08,
      })
      .onConflictDoNothing();

    const [studioAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.slug, 'studio'))
      .limit(1);

    if (studioAgent) {
      await db
        .insert(tenantDomains)
        .values({
          agentId: studioAgent.id,
          hostname: 'studio.accthub.demo',
          domainType: 'custom',
          isPrimary: 1,
          authMode: 'manual_approval',
          status: 'active',
          sslStatus: 'active',
          authorizedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        })
        .onConflictDoNothing();
      await db
        .insert(tenantSettings)
        .values([
          { ownerAgentId: 0, key: 'affiliate_enabled', value: '1' },
          { ownerAgentId: 0, key: 'show_api_docs', value: '1' },
          { ownerAgentId: studioAgent.id, key: 'show_api_docs', value: '1' },
          { ownerAgentId: studioAgent.id, key: 'inherit_platform_help', value: '1' },
        ])
        .onConflictDoNothing();
      for (const batch of chunkRows(DEMO_STUDIO_SUB_TIERS, 2)) {
        await db
          .insert(agentTiers)
          .values(
            batch.map((t) => ({
              ownerAgentId: studioAgent.id,
              code: t.code,
              name: t.name,
              levelRank: t.levelRank,
              minRecharge: t.minRecharge,
              discountRate: t.discountRate,
              commissionRate: 0,
              subOverrideRate: 0,
              maxSubAgents: t.maxSubAgents,
              badgeColor: t.badgeColor,
              perksJson: JSON.stringify(t.perks),
            }))
          )
          .onConflictDoNothing();
      }
    }
  }

  // 8. 公告、帮助文档与支付网关插件
  const [[annCount], [helpCount]] = await Promise.all([
    db.select({ c: sql<number>`count(*)` }).from(announcements),
    db.select({ c: sql<number>`count(*)` }).from(helpArticles),
  ]);
  if (Number(annCount?.c || 0) === 0) {
    await db.insert(announcements).values([...DEMO_ANNOUNCEMENTS]);
  }
  if (Number(helpCount?.c || 0) === 0) {
    await db.insert(helpArticles).values([...DEMO_HELP_ARTICLES]);
  }
  for (const batch of chunkRows(DEMO_PAYMENT_PLUGINS, 4)) {
    await db
      .insert(paymentPlugins)
      .values([...batch])
      .onConflictDoNothing();
  }

  // 9. 全功能闭环增强模拟数据（多级代理拓扑 / 高转化商品形态 / 平账交易流水 / 上游工单风控审计）
  await ensureFullDemoEcosystemSeeded(db, env);
}

/** 幂等灌入全功能闭环模拟数据（按哨兵键仅执行一次，绝不在生产或单元测试环境触发） */
async function ensureFullDemoEcosystemSeeded(db: ReturnType<typeof createDb>, env: Env): Promise<void> {
  const [packRow] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, FULL_DEMO_PACK_KEY))
    .limit(1);
  if (packRow?.value === FULL_DEMO_PACK_VERSION) return;

  const topology = await seedAgentsAndMembersTopology(db, env);
  await seedCommerceModesShowcase(db, env, topology);
  const orderRefs = await seedTransactionsAndFinanceLedger(db, env, topology);
  await seedOpsAndRiskEcosystem(db, env, topology, orderRefs);

  await db
    .insert(siteSettings)
    .values({ key: FULL_DEMO_PACK_KEY, value: FULL_DEMO_PACK_VERSION })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: FULL_DEMO_PACK_VERSION, updatedAt: sql`(datetime('now'))` },
    });
}
