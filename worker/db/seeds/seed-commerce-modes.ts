/**
 * 高转化营销商品形态与加密卡密（限时秒杀、卡密预选+会员价、隐藏口令、组合套餐、拼团商品）
 */

import { and, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE } from '../../infra/credential-storage';
import { encryptSecret, keyedDataDigest } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import { categories, productCards, products } from '../schema';
import type { SeededTopologyContext } from './seed-agents-topology';
import { seedGroupBuyAndRestockShowcase } from './seed-group-buy';
import { offsetSqlTime } from './seed-ledger-helper';

async function insertSeedCards(
  db: AppDatabase,
  env: Env,
  productId: number,
  specId: string,
  items: Array<{ plain: string; label?: string; fee?: number; isLoop?: number }>
) {
  for (const item of items) {
    const fingerprint = await keyedDataDigest(env, 'inventory', JSON.stringify([productId, item.plain]));
    await db
      .insert(productCards)
      .values({
        ownerAgentId: 0,
        productId,
        specId,
        cardContent: await encryptSecret(env, item.plain, INVENTORY_CREDENTIAL_SCOPE),
        credentialFingerprint: fingerprint,
        status: 'available',
        isLoop: item.isLoop ?? 0,
        publicLabel: item.label ?? '',
        selectFee: item.fee ?? 0,
      })
      .onConflictDoNothing();
  }
}

export async function seedCommerceModesShowcase(
  db: AppDatabase,
  env: Env,
  ctx: SeededTopologyContext
): Promise<void> {
  const catRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories)
    .where(eq(categories.ownerAgentId, 0));
  const catMap = new Map(catRows.map((c) => [c.slug, c.id]));
  const firstCatId = catRows[0]?.id ?? 1;

  const baseProducts = await db
    .select({ id: products.id, slug: products.slug, title: products.title, specsJson: products.specsJson })
    .from(products)
    .where(eq(products.ownerAgentId, 0));
  const prodBySlug = new Map(baseProducts.map((p) => [p.slug, p]));
  const pickFirstSpecId = (specsJson?: string): string => {
    try {
      const arr = JSON.parse(specsJson || '[]') as Array<{ id?: string }>;
      return String(arr[0]?.id || 'default');
    } catch {
      return 'default';
    }
  };
  const subItemA = baseProducts[0];
  const subItemB = baseProducts[1] ?? baseProducts[0];

  await db
    .insert(products)
    .values({
      ownerAgentId: 0,
      productSource: 'platform',
      categoryId: catMap.get('claude') ?? firstCatId,
      slug: 'claude-flash-deal',
      title: '【限时秒杀】Claude Pro 极速月卡 · 限量 50 席',
      titleEn: '[Flash Sale] Claude Pro Monthly Seat · Limited 50',
      subtitle: '限时秒杀演示 · 倒计时特惠 + 限量防超卖 + 每单限购 3 件',
      subtitleEn: 'Flash sale countdown with stock limit and quantity cap demo',
      iconKey: 'claude',
      accentColor: '#DC2626',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['限时秒杀', '限量抢购', '自动发货']),
      basePrice: 168,
      originalPrice: 198,
      costPrice: 108,
      wholesaleDiscount: 0.85,
      stockMode: 'cards',
      minQuantity: 1,
      maxQuantity: 3,
      flashSalePrice: 129,
      flashSaleStartAt: offsetSqlTime(-6),
      flashSaleEndAt: offsetSqlTime(42),
      flashSaleLimit: 50,
      flashSaleSold: 18,
      specsJson: JSON.stringify([{ id: 'default', name: '秒杀月卡席位', price: 168, badge: '秒杀中' }]),
      summaryMarkdown: '限时 48 小时秒杀价 ¥129（原价 ¥168），系统原子扣减限量防超卖。',
      detailMarkdown:
        '### 秒杀规则\n- 活动期间自动按秒杀价 ¥129 结算。\n- 单笔限购 1–3 件，售完自动恢复原价。',
      warrantySummary: '30 天全周期质保 · 掉线秒换新',
      isFeatured: 1,
      sortOrder: 2,
      salesCount: 18,
    })
    .onConflictDoNothing();

  await db
    .insert(products)
    .values({
      ownerAgentId: 0,
      productSource: 'platform',
      categoryId: catMap.get('chatgpt') ?? firstCatId,
      slug: 'chatgpt-pick-seat',
      title: 'ChatGPT Plus 独享靓号 · 支持前台自选区域与会员专享价',
      titleEn: 'ChatGPT Plus Dedicated Account · Pick Region & Member Price',
      subtitle: '会员专享价与卡密选号演示：游客 ¥148 / 会员 ¥128 · 前台可选靓号标签，绝不泄露卡密原文',
      subtitleEn: 'Guest vs Member pricing + public card label pre-selection demo',
      iconKey: 'openai',
      accentColor: '#059669',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['支持选号', '会员专享价', '独享账号']),
      basePrice: 148,
      memberPrice: 128,
      originalPrice: 178,
      costPrice: 92,
      wholesaleDiscount: 0.82,
      stockMode: 'cards',
      allowCardSelection: 1,
      cardSelectFee: 6,
      specsJson: JSON.stringify([{ id: 'default', name: '独享成品月卡', price: 148, badge: '可选号' }]),
      summaryMarkdown: '登录会员立省 ¥20（享 ¥128 会员价），支持勾选具体节点地区标签。',
      detailMarkdown:
        '### 选号说明\n- 下单前可自由挑选心仪节点标签，部分极品节点含小额选号加价。\n- 下单时数据库 CAS 原子锁定，多人抢同一号不会重复发卡。',
      warrantySummary: '30 天独享质保 · 附带原始邮箱',
      isFeatured: 1,
      sortOrder: 3,
      salesCount: 24,
    })
    .onConflictDoNothing();

  await db
    .insert(products)
    .values({
      ownerAgentId: 0,
      productSource: 'platform',
      categoryId: catMap.get('api-pool') ?? firstCatId,
      slug: 'vip-secret-enterprise',
      title: '【大客户暗号专享】企业级百美元 API 额度内部通道',
      titleEn: '[VIP Password Only] Enterprise $100 API Quota Internal Pass',
      subtitle: '隐藏口令商品演示 · 口令 VIP2026（目录隐藏，凭链接+口令解锁）',
      subtitleEn: 'Hidden password-gated catalog product demo (password: VIP2026)',
      iconKey: 'cpu',
      accentColor: '#7C3AED',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['口令专享', '大客户内部价', '仅限会员']),
      basePrice: 460,
      memberPrice: 420,
      originalPrice: 720,
      costPrice: 360,
      wholesaleDiscount: 0.9,
      stockMode: 'cards',
      requireLogin: 1,
      isHidden: 1,
      accessPassword: 'VIP2026',
      specsJson: JSON.stringify([{ id: 'default', name: '$100 企业直通额度', price: 460, badge: '内部' }]),
      summaryMarkdown: '大客户私域直通链接，输入访问口令 `VIP2026` 即可解锁下单。',
      detailMarkdown: '### 私域说明\n- 该商品在前台普通列表中自动隐藏。\n- 仅限已登录会员凭暗号访问购买。',
      warrantySummary: '额度消耗完为止，官方通道零风控',
      isFeatured: 0,
      sortOrder: 90,
      salesCount: 6,
    })
    .onConflictDoNothing();

  const bundleItems = [
    {
      product_id: subItemA?.id ?? 1,
      spec_id: pickFirstSpecId(subItemA?.specsJson),
      quantity: 1,
      title: subItemA?.title ?? 'Claude 席位',
    },
    {
      product_id: subItemB?.id ?? 1,
      spec_id: pickFirstSpecId(subItemB?.specsJson),
      quantity: 1,
      title: subItemB?.title ?? 'Cursor 席位',
    },
  ];
  await db
    .insert(products)
    .values({
      ownerAgentId: 0,
      productSource: 'platform',
      categoryId: catMap.get('coding-ai') ?? firstCatId,
      slug: 'ai-dev-all-in-one-bundle',
      title: 'AI 编程全家桶组合套餐（双模型打包直省 ¥45）',
      titleEn: 'AI Developer All-in-One Bundle (Save ¥45)',
      subtitle: '组合套餐演示 · 单次下单原子发放多商品卡密，任一缺货全量回滚',
      subtitleEn: 'Atomic multi-product bundle fulfillment demo',
      iconKey: 'terminal',
      accentColor: '#D97706',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['组合套餐', '一次发多卡', '打包特惠']),
      basePrice: 239,
      memberPrice: 219,
      originalPrice: 284,
      costPrice: 155,
      wholesaleDiscount: 0.85,
      stockMode: 'cards',
      bundleItemsJson: JSON.stringify(bundleItems),
      specsJson: JSON.stringify([{ id: 'default', name: '全能开发者月度捆绑包', price: 239, badge: '套餐' }]),
      summaryMarkdown: '一次付款自动从 2 个子商品各自原子出卡并汇总交付，支持整包售后。',
      detailMarkdown: '### 套餐包含\n- 子商品 1 独立自动出卡凭证\n- 子商品 2 独立自动出卡凭证',
      warrantySummary: '套餐内全部子项均享 30 天质保',
      isFeatured: 1,
      sortOrder: 4,
      salesCount: 11,
    })
    .onConflictDoNothing();

  await db
    .insert(products)
    .values({
      ownerAgentId: 0,
      productSource: 'platform',
      categoryId: catMap.get('streaming') ?? firstCatId,
      slug: 'netflix-group-buy',
      title: 'Netflix 4K 家庭组 2 人拼团合租 · 满员自动发车',
      titleEn: 'Netflix 4K Family 2-Seat Group Buy · Auto Deliver',
      subtitle: '拼团合租演示 · 单独买 ¥29.9 / 2人成团 ¥19.9 · 超时自动全额退余额',
      subtitleEn: 'Group buy demo: ¥19.9 per seat, auto refund on timeout',
      iconKey: 'sparkles',
      accentColor: '#E11D48',
      deliveryType: 'auto',
      tagsJson: JSON.stringify(['2人拼团', '满员发卡', '超时秒退']),
      basePrice: 29.9,
      memberPrice: 26.9,
      originalPrice: 39.9,
      costPrice: 12,
      wholesaleDiscount: 0.85,
      stockMode: 'cards',
      groupBuyEnabled: 1,
      groupBuySize: 2,
      groupBuyPrice: 19.9,
      groupBuyHours: 24,
      specsJson: JSON.stringify([
        { id: 'default', name: '4K 独立子车位 · 30天', price: 29.9, badge: '可拼团' },
      ]),
      summaryMarkdown: '支持一键开团或加入现成拼团，2 人满员即刻全团发卡；24 小时未成团自动退余额。',
      detailMarkdown: '### 拼团规则\n- 团购价 ¥19.9/席，成团后系统一次性为全团成员发放独立 PIN 车位。',
      warrantySummary: '30 天翻车包赔换新',
      isFeatured: 1,
      sortOrder: 5,
      salesCount: 16,
    })
    .onConflictDoNothing();

  const loadId = async (slug: string) => {
    const [r] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.ownerAgentId, 0), eq(products.slug, slug)))
      .limit(1);
    if (!r) throw new Error(`演示商品创建失败: ${slug}`);
    return r.id;
  };

  const [flashProductId, pickSeatProductId, hiddenProductId, groupBuyProductId] = await Promise.all([
    loadId('claude-flash-deal'),
    loadId('chatgpt-pick-seat'),
    loadId('vip-secret-enterprise'),
    loadId('netflix-group-buy'),
  ]);

  await insertSeedCards(db, env, flashProductId, 'default', [
    { plain: 'CLAUDE-FLASH-2026-A101----Pass#Flash01----2FA:JBSWY3DPEHPK3PXP' },
    { plain: 'CLAUDE-FLASH-2026-A102----Pass#Flash02----2FA:JBSWY3DPEHPK3PXP' },
    { plain: 'CLAUDE-FLASH-2026-A103----Pass#Flash03----2FA:JBSWY3DPEHPK3PXP' },
    { plain: 'CLAUDE-FLASH-2026-A104----Pass#Flash04----2FA:JBSWY3DPEHPK3PXP' },
    { plain: 'CLAUDE-FLASH-2026-A105----Pass#Flash05----2FA:JBSWY3DPEHPK3PXP' },
  ]);

  await insertSeedCards(db, env, pickSeatProductId, 'default', [
    { plain: 'us.clean.seat01@gpt.demo----Pass#US01', label: '美区住宅 IP 靓号 · 0 封号记录', fee: 8 },
    { plain: 'jp.fast.seat02@gpt.demo----Pass#JP02', label: '日区东京低延迟节点 · 独享邮箱', fee: 6 },
    { plain: 'sg.pro.seat03@gpt.demo----Pass#SG03', label: '新加坡亚太直连节点 · 现货', fee: 4 },
    { plain: 'uk.std.seat04@gpt.demo----Pass#UK04', label: '英区伦敦标准号 · 免选号费', fee: 0 },
    { plain: 'us.vip.seat05@gpt.demo----Pass#US05', label: '美区加州极品老号 · 注册满 2 年', fee: 12 },
    { plain: 'de.std.seat06@gpt.demo----Pass#DE06', label: '德区法兰克福节点 · 免选号费', fee: 0 },
  ]);

  await insertSeedCards(db, env, hiddenProductId, 'default', [
    { plain: 'sk-accthub-vip-ent-100usd-0001', isLoop: 0 },
    { plain: 'sk-accthub-vip-ent-100usd-0002', isLoop: 0 },
    { plain: 'https://docs.accthub.demo/enterprise-guide (循环发放 VIP 配置手册)', isLoop: 1 },
  ]);

  await insertSeedCards(db, env, groupBuyProductId, 'default', [
    { plain: 'nf.family.01@stream.demo----Pass#NF01----PIN:1108' },
    { plain: 'nf.family.02@stream.demo----Pass#NF02----PIN:2209' },
    { plain: 'nf.family.03@stream.demo----Pass#NF03----PIN:3310' },
    { plain: 'nf.family.04@stream.demo----Pass#NF04----PIN:4411' },
    { plain: 'nf.family.05@stream.demo----Pass#NF05----PIN:5512' },
    { plain: 'nf.family.06@stream.demo----Pass#NF06----PIN:6613' },
  ]);

  const restockProdId = prodBySlug.get('claude-pro-direct')?.id ?? flashProductId;
  await seedGroupBuyAndRestockShowcase(db, env, ctx, groupBuyProductId, restockProdId);
}
