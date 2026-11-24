/**
 * 闭环 1A：多级代理树（L1/L2/L3 代理的代理）与多租户会员矩阵
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { hashPassword } from '../../infra/auth-crypto';
import { encryptSecret, sha256Hex } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import { agents, agentTiers, users } from '../schema';
import { applySeedWalletTx, offsetSqlTime } from './seed-ledger-helper';
import { seedTenantAssetsAndIdentities } from './seed-tenant-assets';

export interface SeededTopologyContext {
  adminId: number;
  memberId: number;
  aliceId: number;
  bobId: number;
  subStudioBuyerId: number;
  subNebulaBuyerId: number;
  studioAgentId: number;
  studioUserId: number;
  nebulaAgentId: number;
  nebulaUserId: number;
  auroraAgentId: number;
  auroraUserId: number;
  kairoAgentId: number;
  kairoUserId: number;
  pulseAgentId: number;
  pulseUserId: number;
  nebulaPrivateProductId: number;
}

async function ensureUser(
  db: AppDatabase,
  input: {
    siteAgentId: number;
    email: string;
    displayName: string;
    passwordHash: string;
    role: string;
    initialBalance: number;
    totalRecharged: number;
    referralCode?: string;
    referredByUserId?: number | null;
    status?: string;
    statusNote?: string;
    initRefNo: string;
    initNote: string;
  }
): Promise<number> {
  await db
    .insert(users)
    .values({
      siteAgentId: input.siteAgentId,
      email: input.email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: input.role,
      balance: 0,
      totalRecharged: input.totalRecharged,
      referralCode: input.referralCode ?? null,
      referredByUserId: input.referredByUserId ?? null,
      status: input.status ?? 'active',
      statusNote: input.statusNote ?? '',
    })
    .onConflictDoNothing();

  const [row] = await db
    .select({ id: users.id, referralCode: users.referralCode })
    .from(users)
    .where(and(eq(users.siteAgentId, input.siteAgentId), eq(users.email, input.email)))
    .limit(1);
  if (!row) throw new Error(`演示用户初始化失败: ${input.email}`);
  if (input.referralCode && !row.referralCode) {
    await db.update(users).set({ referralCode: input.referralCode }).where(eq(users.id, row.id));
  }
  if (input.initialBalance > 0) {
    await applySeedWalletTx(db, {
      userId: row.id,
      type: 'recharge',
      amount: input.initialBalance,
      refNo: input.initRefNo,
      note: input.initNote,
      createdAt: offsetSqlTime(-168),
    });
  }
  return row.id;
}

async function ensureAgent(
  db: AppDatabase,
  env: Env,
  input: {
    userId: number;
    tierId: number | null;
    parentAgentId: number | null;
    depth: number;
    ancestorPath: string;
    slug: string;
    brandName: string;
    brandTagline: string;
    themeAccent: string;
    markupPercent: number;
    rawApiKey: string;
    status?: string;
    allowPrivateProductsOverride?: number | null;
    allowOwnPaymentOverride?: number | null;
    footerText?: string;
    announcementBanner?: string;
  }
): Promise<number> {
  const [apiKeyHash, apiKeyEnc] = await Promise.all([
    sha256Hex(input.rawApiKey),
    encryptSecret(env, input.rawApiKey),
  ]);
  await db
    .insert(agents)
    .values({
      userId: input.userId,
      tierId: input.tierId,
      parentAgentId: input.parentAgentId,
      depth: input.depth,
      ancestorPath: input.ancestorPath,
      slug: input.slug,
      brandName: input.brandName,
      brandTagline: input.brandTagline,
      themeAccent: input.themeAccent,
      footerText: input.footerText ?? '',
      announcementBanner: input.announcementBanner ?? '',
      markupPercent: input.markupPercent,
      commissionRate: 0,
      apiKey: crypto.randomUUID(),
      apiKeyHash,
      apiKeyEnc,
      status: input.status ?? 'active',
      allowPrivateProductsOverride: input.allowPrivateProductsOverride ?? null,
      allowOwnPaymentOverride: input.allowOwnPaymentOverride ?? null,
    })
    .onConflictDoNothing();

  const [row] = await db.select({ id: agents.id }).from(agents).where(eq(agents.slug, input.slug)).limit(1);
  if (!row) throw new Error(`演示代理初始化失败: ${input.slug}`);
  return row.id;
}

export async function seedAgentsAndMembersTopology(
  db: AppDatabase,
  env: Env
): Promise<SeededTopologyContext> {
  const demoHash = await hashPassword('demo123456');

  await db
    .update(agentTiers)
    .set({ allowPrivateProducts: 1, allowOwnPayment: 1, maxCustomDomains: 5 })
    .where(and(eq(agentTiers.ownerAgentId, 0), eq(agentTiers.code, 'partner')));
  await db
    .update(agentTiers)
    .set({ allowPrivateProducts: 1, maxCustomDomains: 3 })
    .where(and(eq(agentTiers.ownerAgentId, 0), eq(agentTiers.code, 'gold')));

  const tiers = await db.select().from(agentTiers).where(eq(agentTiers.ownerAgentId, 0));
  const tierByCode = new Map(tiers.map((t) => [t.code, t.id]));

  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'admin@accthub.dev')))
    .limit(1);
  const [studioUserRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'demo@accthub.dev')))
    .limit(1);
  const [studioAgentRow] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.slug, 'studio'))
    .limit(1);
  const [memberRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.email, 'member@accthub.dev')))
    .limit(1);
  if (!adminRow || !studioUserRow || !studioAgentRow || !memberRow) {
    throw new Error('基础演示账号缺失，无法继续灌入多级拓扑');
  }

  await db.update(users).set({ referralCode: 'AHMEMBER88' }).where(eq(users.id, memberRow.id));

  const aliceId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'alice@accthub.dev',
    displayName: '许知意 · Pro 会员',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 420,
    totalRecharged: 420,
    referralCode: 'AHALICE99',
    referredByUserId: memberRow.id,
    initRefNo: 'SEED-ALICE-INIT',
    initNote: '沙盒会员初始充值余额',
  });
  const bobId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'bob@accthub.dev',
    displayName: '周明远 · 开发者',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 260,
    totalRecharged: 260,
    referralCode: 'AHBOB2026',
    initRefNo: 'SEED-BOB-INIT',
    initNote: '沙盒会员初始充值余额',
  });
  await ensureUser(db, {
    siteAgentId: 0,
    email: 'charlie.frozen@accthub.dev',
    displayName: '陈默（已冻结演示）',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 50,
    totalRecharged: 50,
    status: 'frozen',
    statusNote: '演示风控冻结：高频异常查单触发人工复核',
    initRefNo: 'SEED-CHARLIE-INIT',
    initNote: '冻结演示账号初始余额',
  });
  await ensureUser(db, {
    siteAgentId: 0,
    email: 'spam.blocked@accthub.dev',
    displayName: '异常脚本号（已拉黑）',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 0,
    totalRecharged: 0,
    status: 'blacklisted',
    statusNote: '演示风控拉黑：恶意批量扫号与恶意拒付',
    initRefNo: 'SEED-SPAM-INIT',
    initNote: '拉黑账号',
  });

  const nebulaUserId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'nebula@accthub.dev',
    displayName: '沈星河 · 战略合伙人',
    passwordHash: demoHash,
    role: 'agent',
    initialBalance: 1680,
    totalRecharged: 5000,
    referralCode: 'AHNEBULA1',
    initRefNo: 'SEED-NEBULA-INIT',
    initNote: 'V4 战略合伙人演示钱包余额',
  });
  const nebulaAgentId = await ensureAgent(db, env, {
    userId: nebulaUserId,
    tierId: tierByCode.get('partner') ?? null,
    parentAgentId: null,
    depth: 1,
    ancestorPath: '/',
    slug: 'nebula',
    brandName: '星云严选 AI 商城',
    brandTagline: 'V4 战略合伙人直供 · 自营 API 算力与全球独享车位',
    themeAccent: '#2563EB',
    markupPercent: 14,
    rawApiKey: 'ah_agent_NEBULA2026V4',
    allowPrivateProductsOverride: 1,
    allowOwnPaymentOverride: 1,
    footerText: '星云严选独立白标分站 · 7×24 自动发货',
    announcementBanner: '星云分站周年庆：全站自营算力包立减，支持独立域名与专属收款。',
  });

  const studioSubTiers = await db
    .select()
    .from(agentTiers)
    .where(eq(agentTiers.ownerAgentId, studioAgentRow.id));
  const studioStdTierId = studioSubTiers[0]?.id ?? tierByCode.get('bronze') ?? null;

  const auroraUserId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'aurora@accthub.dev',
    displayName: '陆北辰 · 二级分站长',
    passwordHash: demoHash,
    role: 'agent',
    initialBalance: 480,
    totalRecharged: 600,
    referralCode: 'AHAURORA2',
    initRefNo: 'SEED-AURORA-INIT',
    initNote: 'L2 代理演示初始余额',
  });
  const auroraAgentId = await ensureAgent(db, env, {
    userId: auroraUserId,
    tierId: studioStdTierId,
    parentAgentId: studioAgentRow.id,
    depth: 2,
    ancestorPath: `/${studioAgentRow.id}/`,
    slug: 'aurora',
    brandName: '极光算力站',
    brandTagline: '星尘旗下二级核心分站 · 开发者专属 AI 工具箱',
    themeAccent: '#0F766E',
    markupPercent: 18,
    rawApiKey: 'ah_agent_AURORA2026L2',
    announcementBanner: '极光算力站：Claude / Cursor 开发者月卡现货秒发！',
  });

  const kairoUserId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'kairo@accthub.dev',
    displayName: '林开罗 · 二级渠道商',
    passwordHash: demoHash,
    role: 'agent',
    initialBalance: 620,
    totalRecharged: 2000,
    initRefNo: 'SEED-KAIRO-INIT',
    initNote: 'L2 渠道商演示初始余额',
  });
  const kairoAgentId = await ensureAgent(db, env, {
    userId: kairoUserId,
    tierId: tierByCode.get('gold') ?? null,
    parentAgentId: nebulaAgentId,
    depth: 2,
    ancestorPath: `/${nebulaAgentId}/`,
    slug: 'kairo',
    brandName: '开罗数字铺',
    brandTagline: '星云直属渠道分站 · B2B 批采与跨境数字会员',
    themeAccent: '#9333EA',
    markupPercent: 16,
    rawApiKey: 'ah_agent_KAIRO2026L2',
  });

  const pulseUserId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'pulse@accthub.dev',
    displayName: '顾脉动 · 三级校园店长',
    passwordHash: demoHash,
    role: 'agent',
    initialBalance: 180,
    totalRecharged: 200,
    initRefNo: 'SEED-PULSE-INIT',
    initNote: 'L3 三级分站演示初始余额',
  });
  const pulseAgentId = await ensureAgent(db, env, {
    userId: pulseUserId,
    tierId: tierByCode.get('bronze') ?? null,
    parentAgentId: auroraAgentId,
    depth: 3,
    ancestorPath: `/${studioAgentRow.id}/${auroraAgentId}/`,
    slug: 'pulse',
    brandName: '脉动极客小店',
    brandTagline: '高校极客 AI 订阅与合租小站（三级分站演示）',
    themeAccent: '#EA580C',
    markupPercent: 22,
    rawApiKey: 'ah_agent_PULSE2026L3',
  });

  const suspendedUserId = await ensureUser(db, {
    siteAgentId: 0,
    email: 'frozen.agent@accthub.dev',
    displayName: '已停用演示分站',
    passwordHash: demoHash,
    role: 'agent',
    initialBalance: 35,
    totalRecharged: 100,
    initRefNo: 'SEED-FROZEN-AGENT-INIT',
    initNote: '停用分站历史余额',
  });
  await ensureAgent(db, env, {
    userId: suspendedUserId,
    tierId: tierByCode.get('bronze') ?? null,
    parentAgentId: nebulaAgentId,
    depth: 2,
    ancestorPath: `/${nebulaAgentId}/`,
    slug: 'paused-demo',
    brandName: '已停用测试分站',
    brandTagline: '用于验证总控停用/恢复分站流程',
    themeAccent: '#64748B',
    markupPercent: 15,
    rawApiKey: 'ah_agent_PAUSED2026',
    status: 'suspended',
  });

  const subStudioBuyerId = await ensureUser(db, {
    siteAgentId: studioAgentRow.id,
    email: 'sub.buyer@studio.demo',
    displayName: '星尘分站忠实买家',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 300,
    totalRecharged: 300,
    initRefNo: 'SEED-STUDIO-BUYER-INIT',
    initNote: '星尘分站会员初始余额',
  });
  const subNebulaBuyerId = await ensureUser(db, {
    siteAgentId: nebulaAgentId,
    email: 'sub.buyer@nebula.demo',
    displayName: '星云分站企业客户',
    passwordHash: demoHash,
    role: 'user',
    initialBalance: 500,
    totalRecharged: 500,
    initRefNo: 'SEED-NEBULA-BUYER-INIT',
    initNote: '星云分站会员初始余额',
  });

  const nebulaPrivateProductId = await seedTenantAssetsAndIdentities(db, env, {
    adminId: adminRow.id,
    memberId: memberRow.id,
    aliceId,
    studioUserId: studioUserRow.id,
    studioAgentId: studioAgentRow.id,
    nebulaAgentId,
    auroraAgentId,
    kairoAgentId,
  });

  return {
    adminId: adminRow.id,
    memberId: memberRow.id,
    aliceId,
    bobId,
    subStudioBuyerId,
    subNebulaBuyerId,
    studioAgentId: studioAgentRow.id,
    studioUserId: studioUserRow.id,
    nebulaAgentId,
    nebulaUserId,
    auroraAgentId,
    auroraUserId,
    kairoAgentId,
    kairoUserId,
    pulseAgentId,
    pulseUserId,
    nebulaPrivateProductId,
  };
}
