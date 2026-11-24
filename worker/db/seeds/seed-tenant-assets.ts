/**
 * 闭环 1B：多状态独立域名矩阵、分站私有商品与自有支付、分站公告/帮助、OAuth/登录日志与 2FA 保险箱
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE } from '../../infra/credential-storage';
import { encryptSecret, keyedDataDigest } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import { sealPaymentPluginCredential } from '../../infra/payment-credential-storage';
import {
  agentProductOverrides,
  agentProductPrices,
  announcements,
  categories,
  categoryGroups,
  helpArticles,
  productCards,
  products,
  siteMailConfigs,
  siteSettings,
  tenantDomains,
  tenantPaymentPlugins,
  tenantSettings,
  userLoginLogs,
  userOauthIdentities,
  userTotpVault,
} from '../schema';
import { offsetSqlTime } from './seed-ledger-helper';

export async function seedTenantAssetsAndIdentities(
  db: AppDatabase,
  env: Env,
  refs: {
    adminId: number;
    memberId: number;
    aliceId: number;
    studioUserId: number;
    studioAgentId: number;
    nebulaAgentId: number;
    auroraAgentId: number;
    kairoAgentId: number;
  }
): Promise<number> {
  const nowStr = offsetSqlTime(-24);

  // 1. 多状态独立域名（active / pending_dns / pending_review）
  await db
    .insert(tenantDomains)
    .values([
      {
        agentId: refs.nebulaAgentId,
        hostname: 'nebula.accthub.demo',
        domainType: 'custom',
        isPrimary: 1,
        authMode: 'manual_approval',
        status: 'active',
        sslStatus: 'active',
        authorizedByAdminId: refs.adminId,
        authorizedAt: nowStr,
      },
      {
        agentId: refs.nebulaAgentId,
        hostname: 'vip.nebula-ai.test',
        domainType: 'custom',
        isPrimary: 0,
        authMode: 'cloudflare_saas',
        status: 'pending_dns',
        verificationToken: 'accthub-verify-nebula-vip-2026',
        sslStatus: 'pending',
      },
      {
        agentId: refs.auroraAgentId,
        hostname: 'aurora.accthub.demo',
        domainType: 'custom',
        isPrimary: 1,
        authMode: 'manual_approval',
        status: 'pending_review',
        sslStatus: 'pending',
      },
      {
        agentId: refs.kairoAgentId,
        hostname: 'kairo.accthub.demo',
        domainType: 'custom',
        isPrimary: 1,
        authMode: 'manual_approval',
        status: 'active',
        sslStatus: 'active',
        authorizedByAdminId: refs.adminId,
        authorizedAt: nowStr,
      },
    ])
    .onConflictDoNothing();

  // 2. 主站 SaaS 演示全局开关（site_settings）与分站配置（tenant_settings）、独立支付通道、独立发信配置
  await db
    .insert(siteSettings)
    .values([
      { key: 'saas_allow_private_products_global', value: '1' },
      { key: 'saas_allow_own_payment_global', value: '1' },
    ])
    .onConflictDoNothing();
  await db
    .insert(tenantSettings)
    .values([
      { ownerAgentId: refs.nebulaAgentId, key: 'show_api_docs', value: '1' },
      { ownerAgentId: refs.nebulaAgentId, key: 'affiliate_enabled', value: '1' },
      { ownerAgentId: refs.nebulaAgentId, key: 'affiliate_rate', value: '0.06' },
      { ownerAgentId: refs.nebulaAgentId, key: 'inherit_platform_help', value: '1' },
      { ownerAgentId: refs.auroraAgentId, key: 'show_api_docs', value: '0' },
      { ownerAgentId: refs.kairoAgentId, key: 'show_api_docs', value: '1' },
    ])
    .onConflictDoNothing();

  await db
    .insert(tenantPaymentPlugins)
    .values({
      ownerAgentId: refs.nebulaAgentId,
      pluginId: 'epay',
      enabled: 1,
      configJson: JSON.stringify({
        api_url: 'https://pay.nebula-sandbox.test/submit.php',
        pid: '10086',
        key: await sealPaymentPluginCredential(env, 'epay', 'key', 'nebula_demo_epay_key_2026'),
        pay_type: 'alipay',
      }),
    })
    .onConflictDoNothing();

  await db
    .insert(siteMailConfigs)
    .values({
      ownerAgentId: refs.nebulaAgentId,
      enabled: 0,
      autoSendOrder: 1,
      autoSendRestock: 1,
      provider: 'resend',
      fromName: '星云严选 AI 商城',
      fromEmail: 'noreply@nebula.accthub.demo',
      footerNote: '感谢选择星云严选分站，订单售后请登录分站会员中心提交工单。',
    })
    .onConflictDoNothing();

  // 3. 星云分站私有自营分类、私有商品与加密库存
  const [groupRow] = await db.select({ id: categoryGroups.id }).from(categoryGroups).limit(1);
  await db
    .insert(categories)
    .values({
      ownerAgentId: refs.nebulaAgentId,
      groupId: groupRow?.id ?? 1,
      slug: 'nebula-exclusive',
      name: '星云独家自营',
      nameEn: 'Nebula Exclusive',
      icon: 'sparkles',
      badgeText: '自营',
      sortOrder: 1,
    })
    .onConflictDoNothing();
  const [nebulaCat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.ownerAgentId, refs.nebulaAgentId), eq(categories.slug, 'nebula-exclusive')))
    .limit(1);

  await db
    .insert(products)
    .values({
      ownerAgentId: refs.nebulaAgentId,
      productSource: 'tenant_private',
      categoryId: nebulaCat?.id ?? 1,
      slug: 'nebula-gpu-relay-pro',
      title: '星云自营 · 独享高并发模型转发节点',
      titleEn: 'Nebula Private Dedicated LLM Relay Node',
      subtitle: '分站自营私有商品演示 · 直收直发不走主站资金池',
      subtitleEn: 'Sub-agent private catalog product demo',
      iconKey: 'cpu',
      accentColor: '#2563EB',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['分站自营', '独享节点', '自动发货']),
      basePrice: 88,
      originalPrice: 128,
      costPrice: 35,
      stockMode: 'cards',
      specsJson: JSON.stringify([{ id: 'monthly', name: '月度独享节点', price: 88, badge: '现货' }]),
      summaryMarkdown: '星云严选分站自营商品，展示 SaaS 私有货源与分站自有收款闭环。',
      detailMarkdown: '### 自营权益\n- 独立转发域名与专属 Key。\n- 仅在 `@nebula` 分站展示并由分站直收。',
      warrantySummary: '30 天节点 SLA 保障',
      isFeatured: 1,
      sortOrder: 1,
      salesCount: 9,
    })
    .onConflictDoNothing();

  const [nebulaProd] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.ownerAgentId, refs.nebulaAgentId), eq(products.slug, 'nebula-gpu-relay-pro')))
    .limit(1);
  if (!nebulaProd) throw new Error('星云自营演示商品创建失败');

  for (let i = 1; i <= 5; i++) {
    const plain = `NEBULA-RELAY-KEY-2026-00${i}-XZ9Q`;
    await db
      .insert(productCards)
      .values({
        ownerAgentId: refs.nebulaAgentId,
        productId: nebulaProd.id,
        specId: 'monthly',
        cardContent: await encryptSecret(env, plain, INVENTORY_CREDENTIAL_SCOPE),
        credentialFingerprint: await keyedDataDigest(
          env,
          'inventory',
          JSON.stringify([nebulaProd.id, plain])
        ),
        status: 'available',
      })
      .onConflictDoNothing();
  }

  // 4. 分站对平台商品的自主定价与文案覆写
  const [firstPlatformProd] = await db
    .select({ id: products.id, basePrice: products.basePrice })
    .from(products)
    .where(eq(products.ownerAgentId, 0))
    .limit(1);
  if (firstPlatformProd) {
    await db
      .insert(agentProductPrices)
      .values([
        {
          agentId: refs.studioAgentId,
          productId: firstPlatformProd.id,
          specId: 'default',
          customPrice: Number((firstPlatformProd.basePrice * 1.12).toFixed(2)),
        },
        {
          agentId: refs.nebulaAgentId,
          productId: firstPlatformProd.id,
          specId: 'default',
          customPrice: Number((firstPlatformProd.basePrice * 1.08).toFixed(2)),
        },
      ])
      .onConflictDoNothing();
    await db
      .insert(agentProductOverrides)
      .values({
        agentId: refs.studioAgentId,
        productId: firstPlatformProd.id,
        isListed: 1,
        customSubtitle: '星尘研选社专供 · 含专属中文配置手册与售后群',
      })
      .onConflictDoNothing();
  }

  // 5. 分站公告、下级通知与分站帮助文档
  const existingSubAnn = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.ownerAgentId, refs.nebulaAgentId))
    .limit(1);
  if (existingSubAnn.length === 0) {
    await db.insert(announcements).values([
      {
        ownerAgentId: refs.nebulaAgentId,
        audience: 'storefront',
        title: '星云严选分站自营节点上新通知',
        titleEn: 'Nebula Private Relay Nodes Available',
        content: '即日起星云分站推出独享高并发模型转发节点，欢迎新老客户选购体验。',
        contentEn: 'Dedicated LLM relay nodes are now live exclusively on Nebula Storefront.',
        level: 'highlight',
        isPinned: 1,
      },
      {
        ownerAgentId: refs.studioAgentId,
        audience: 'downline_agents',
        title: '星尘致下级分站长：本周拿货折扣与爆款推荐',
        titleEn: 'Studio Downline Partner Weekly Supply Update',
        content: 'Claude 与 Cursor 开发者系列库存充足，欢迎 @aurora 及三级伙伴重点推广。',
        contentEn: 'Claude and Cursor seats are fully restocked for all downline storefronts.',
        level: 'info',
        isPinned: 1,
      },
    ]);
  }
  const existingSubHelp = await db
    .select({ id: helpArticles.id })
    .from(helpArticles)
    .where(eq(helpArticles.ownerAgentId, refs.nebulaAgentId))
    .limit(1);
  if (existingSubHelp.length === 0) {
    await db.insert(helpArticles).values({
      ownerAgentId: refs.nebulaAgentId,
      category: '分站专属指南',
      title: '星云独享转发节点如何配置到 Cursor / Claude Code',
      titleEn: 'How to Configure Nebula Relay Node in Cursor',
      content: '复制订单交付的 API Endpoint 与 Key，填入客户端自定义 Base URL 即可秒连。',
      contentEn: 'Paste your delivered endpoint and API key into Cursor custom base URL settings.',
      sortOrder: 1,
    });
  }

  // 6. OAuth 绑定、登录日志与 2FA 保险箱
  await db
    .insert(userOauthIdentities)
    .values([
      {
        siteAgentId: 0,
        userId: refs.memberId,
        provider: 'github',
        providerUserId: 'gh_demo_1024001',
        email: 'member@accthub.dev',
        nickname: 'suqinghe-dev',
      },
      {
        siteAgentId: 0,
        userId: refs.memberId,
        provider: 'google',
        providerUserId: 'gg_demo_2048001',
        email: 'member@accthub.dev',
        nickname: 'Qinghe Su',
      },
      {
        siteAgentId: 0,
        userId: refs.aliceId,
        provider: 'wechat',
        providerUserId: 'wx_demo_open_3001',
        unionId: 'wx_demo_union_3001',
        nickname: '知意同学',
      },
    ])
    .onConflictDoNothing();

  const existingLoginLogs = await db
    .select({ id: userLoginLogs.id })
    .from(userLoginLogs)
    .where(eq(userLoginLogs.userId, refs.memberId))
    .limit(1);
  if (existingLoginLogs.length === 0) {
    await db.insert(userLoginLogs).values([
      {
        userId: refs.memberId,
        ip: '192.0.2.15',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/135.0',
        createdAt: offsetSqlTime(-36),
      },
      {
        userId: refs.memberId,
        ip: '192.0.2.88',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1',
        createdAt: offsetSqlTime(-4),
      },
      {
        userId: refs.studioUserId,
        ip: '198.51.100.22',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/135.0',
        createdAt: offsetSqlTime(-2),
      },
    ]);
  }

  const existingTotp = await db
    .select({ id: userTotpVault.id })
    .from(userTotpVault)
    .where(eq(userTotpVault.userId, refs.memberId))
    .limit(1);
  if (existingTotp.length === 0) {
    await db.insert(userTotpVault).values([
      {
        userId: refs.memberId,
        issuer: 'OpenAI ChatGPT Plus',
        accountName: 'vip.demo.member@accthub.mail',
        encryptedSecret: await encryptSecret(env, 'JBSWY3DPEHPK3PXP'),
        digits: 6,
        period: 30,
      },
      {
        userId: refs.memberId,
        issuer: 'Anthropic Claude Pro',
        accountName: 'claude.seat.01@accthub.mail',
        encryptedSecret: await encryptSecret(env, 'NB2W45DFOIZA===='),
        digits: 6,
        period: 30,
      },
    ]);
  }

  return nebulaProd.id;
}
