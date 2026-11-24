/**
 * 闭环 4：上游货源生态（主备源/目录/绑定/采购单）、售后工单对话、风控黑名单与事件、出站 Webhook、邮件与审计日志
 */

import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import { encryptSecret } from '../../infra/crypto';
import type { AppDatabase } from '../../infra/db';
import {
  adminAuditLogs,
  emailDeliveryLogs,
  ipBlacklist,
  outboundWebhooks,
  products,
  productUpstreamBindings,
  riskEvents,
  supportTickets,
  ticketMessages,
  upstreamItems,
  upstreamOrders,
  upstreamSources,
  upstreamSyncLogs,
} from '../schema';
import type { SeededTopologyContext } from './seed-agents-topology';
import { offsetSqlTime } from './seed-ledger-helper';

export async function seedOpsAndRiskEcosystem(
  db: AppDatabase,
  env: Env,
  ctx: SeededTopologyContext,
  orderRefs: {
    mainDeliveredOrderNo: string;
    studioDeliveredOrderNo: string;
    pulseDeliveredOrderNo: string;
    expiringOrderNo: string;
  }
): Promise<void> {
  // 1. 补充第 2 个备用上游货源（展示多源容灾与主备路由），并填充上游商品缓存、同步日志、绑定与采购单
  const existingSources = await db.select().from(upstreamSources);
  const primarySource = existingSources[0];
  let backupSourceId = existingSources[1]?.id ?? null;

  if (primarySource && !backupSourceId) {
    const [inserted] = await db
      .insert(upstreamSources)
      .values({
        name: '北极星算力备源（内置仿真容灾节点）',
        adapterType: 'mock_sandbox',
        baseUrl: 'https://backup.upstream.internal/v1/catalog',
        apiKeyEnc: await encryptSecret(env, 'up_backup_demo_token_2026'),
        outOfStockAction: 'keep_local_stock',
        autoRepublishOnRestock: 1,
        defaultCategoryId: primarySource.defaultCategoryId,
        syncIntervalMinutes: 30,
        autoSyncEnabled: 1,
        cachedBalance: 640.5,
        lowBalanceThreshold: 150,
        balanceUpdatedAt: offsetSqlTime(-1),
        status: 'active',
        lastSyncAt: offsetSqlTime(-1),
        lastSyncStatus: 'success',
        lastSyncMessage: '备源同步完成：拉取 4 个可容灾 SKU',
      })
      .returning({ id: upstreamSources.id });
    backupSourceId = inserted?.id ?? null;
  }

  const [firstProd] = await db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(eq(products.ownerAgentId, 0))
    .limit(1);

  if (primarySource && firstProd) {
    await db
      .insert(upstreamItems)
      .values([
        {
          sourceId: primarySource.id,
          upstreamItemId: 'SKU-CLAUDE-PRO-30D',
          rawTitle: 'Claude Pro 官方独立月卡（上游直采源）',
          rawCategory: 'AI 订阅',
          rawPrice: 88,
          rawStock: 120,
          rawStatus: 'active',
          collectStatus: 'collected',
          localProductId: firstProd.id,
          targetCategoryId: primarySource.defaultCategoryId,
        },
        {
          sourceId: primarySource.id,
          upstreamItemId: 'SKU-CURSOR-PRO-30D',
          rawTitle: 'Cursor Pro 开发者独享年付折算月席',
          rawCategory: '编程 AI',
          rawPrice: 96,
          rawStock: 45,
          rawStatus: 'active',
          collectStatus: 'pending',
          targetCategoryId: primarySource.defaultCategoryId,
        },
      ])
      .onConflictDoNothing();

    const existingSyncLogs = await db.select({ id: upstreamSyncLogs.id }).from(upstreamSyncLogs).limit(1);
    if (existingSyncLogs.length === 0) {
      await db.insert(upstreamSyncLogs).values([
        {
          sourceId: primarySource.id,
          sourceName: primarySource.name,
          triggerType: 'cron',
          status: 'success',
          fetchedCount: 12,
          syncedCount: 10,
          outOfStockCount: 1,
          skippedCount: 1,
          durationMs: 420,
          message: '定时同步完成：10 个 SKU 价格与库存已校准',
          createdAt: offsetSqlTime(-3),
        },
        {
          sourceId: primarySource.id,
          sourceName: primarySource.name,
          triggerType: 'manual',
          status: 'warning',
          fetchedCount: 12,
          syncedCount: 9,
          outOfStockCount: 2,
          skippedCount: 1,
          alertsJson: JSON.stringify(['SKU-GPT-TEAM 成本涨幅 +38% 触发熔断保护，未自动改价']),
          durationMs: 680,
          message: '同步完成但存在 1 条成本暴涨保护告警',
          createdAt: offsetSqlTime(-18),
        },
      ]);
    }

    await db
      .insert(productUpstreamBindings)
      .values([
        {
          productId: firstProd.id,
          specId: 'default',
          sourceId: primarySource.id,
          upstreamItemId: 'SKU-CLAUDE-PRO-30D',
          fulfillmentMode: 'local_first',
          routingStrategy: 'priority',
          priority: 10,
          cachedCost: 88,
          cachedStock: 120,
          isEnabled: 1,
        },
        ...(backupSourceId
          ? [
              {
                productId: firstProd.id,
                specId: 'default',
                sourceId: backupSourceId,
                upstreamItemId: 'SKU-BACKUP-CLAUDE-01',
                fulfillmentMode: 'local_first',
                routingStrategy: 'priority',
                priority: 20,
                cachedCost: 92,
                cachedStock: 60,
                isEnabled: 1,
              },
            ]
          : []),
      ])
      .onConflictDoNothing();

    // 上游采购单（1 条已成功出卡，1 条换新补采演示，不影响财务资金守恒巡检）
    await db
      .insert(upstreamOrders)
      .values([
        {
          localOrderNo: orderRefs.mainDeliveredOrderNo,
          attemptNo: 1,
          idempotencyOutTradeNo: 'UP-SEED-OUT-001',
          sourceId: primarySource.id,
          sourceName: primarySource.name,
          productId: firstProd.id,
          specId: 'default',
          upstreamItemId: 'SKU-CLAUDE-PRO-30D',
          quantity: 1,
          upstreamOrderNo: 'SUP-2026-DEMO-8801',
          upstreamCost: 88,
          status: 'succeeded',
          purpose: 'order_fulfill',
          createdAt: offsetSqlTime(-96),
          updatedAt: offsetSqlTime(-96),
        },
        {
          localOrderNo: orderRefs.studioDeliveredOrderNo,
          attemptNo: 1,
          idempotencyOutTradeNo: 'UP-SEED-OUT-002',
          sourceId: primarySource.id,
          sourceName: primarySource.name,
          productId: firstProd.id,
          specId: 'default',
          upstreamItemId: 'SKU-CLAUDE-PRO-30D',
          quantity: 1,
          upstreamOrderNo: 'SUP-2026-DEMO-8802',
          upstreamCost: 88,
          status: 'failed',
          purpose: 'order_fulfill',
          errorMessage: '上游演示接口短暂超时，已自动回退本地卡密库完成交付',
          retryCount: 1,
          createdAt: offsetSqlTime(-60),
          updatedAt: offsetSqlTime(-60),
        },
      ])
      .onConflictDoNothing();
  }

  // 2. 售后工单中心（主站待处理 + 分站升级转交总控 + 已完结换新）+ 多轮对话消息
  const existingTickets = await db.select({ id: supportTickets.id }).from(supportTickets).limit(1);
  if (existingTickets.length === 0) {
    const insertedTickets = await db
      .insert(supportTickets)
      .values([
        {
          ticketNo: 'TK-SEED-2026-001',
          siteAgentId: 0,
          userId: ctx.aliceId,
          contactEmail: 'alice@accthub.dev',
          orderNo: orderRefs.mainDeliveredOrderNo,
          category: 'after_sale',
          subject: '咨询：如何在 Claude 网页版绑定 2FA 验证码？',
          status: 'open',
          escalatedToAdmin: 0,
          createdAt: offsetSqlTime(-8),
          updatedAt: offsetSqlTime(-6),
        },
        {
          ticketNo: 'TK-SEED-2026-002',
          siteAgentId: ctx.studioAgentId,
          userId: ctx.subStudioBuyerId,
          contactEmail: 'sub.buyer@studio.demo',
          orderNo: orderRefs.studioDeliveredOrderNo,
          category: 'warranty_replace',
          subject: '【分站转交】席位提示区域受限，申请质保换新',
          status: 'open',
          escalatedToAdmin: 1,
          createdAt: offsetSqlTime(-14),
          updatedAt: offsetSqlTime(-5),
        },
        {
          ticketNo: 'TK-SEED-2026-003',
          siteAgentId: 0,
          userId: ctx.memberId,
          contactEmail: 'member@accthub.dev',
          orderNo: orderRefs.expiringOrderNo,
          category: 'renewal',
          subject: '已解决：到期前续费是否保留原聊天记录？',
          status: 'resolved',
          escalatedToAdmin: 0,
          createdAt: offsetSqlTime(-48),
          updatedAt: offsetSqlTime(-44),
        },
      ])
      .returning({ id: supportTickets.id, ticketNo: supportTickets.ticketNo });

    const tkMap = new Map(insertedTickets.map((t) => [t.ticketNo, t.id]));
    const tk1 = tkMap.get('TK-SEED-2026-001');
    const tk2 = tkMap.get('TK-SEED-2026-002');
    const tk3 = tkMap.get('TK-SEED-2026-003');
    if (tk1 && tk2 && tk3) {
      await db.insert(ticketMessages).values([
        {
          ticketId: tk1,
          senderRole: 'user',
          senderName: '许知意 · Pro 会员',
          content: '您好，订单已秒发卡密，请问怎么把里面的 2FA 密钥导入到站内验证器？',
          createdAt: offsetSqlTime(-8),
        },
        {
          ticketId: tk2,
          senderRole: 'user',
          senderName: '星尘分站忠实买家',
          content: '今天登录提示网络环境异常，麻烦核查并走质保通道换发一个新席位。',
          createdAt: offsetSqlTime(-14),
        },
        {
          ticketId: tk2,
          senderRole: 'agent',
          senderName: '星尘 AI 研选社',
          content: '已核实买家订单在 30 天质保期内，现升级转交主站总控协助从上游一键换新。',
          createdAt: offsetSqlTime(-5),
        },
        {
          ticketId: tk3,
          senderRole: 'user',
          senderName: '苏清和 · 会员',
          content: '还有 2 天到期，我在会员中心点“一键复购”后能继续原号续期吗？',
          createdAt: offsetSqlTime(-48),
        },
        {
          ticketId: tk3,
          senderRole: 'admin',
          senderName: 'AcctHub 总控客服',
          content: '可以的，选择直充规格一键复购即可无感延续，聊天记录完整保留。',
          createdAt: offsetSqlTime(-44),
        },
      ]);
    }
  }

  // 3. 风控黑名单（仅使用 RFC 5737 文档保留 IP，绝不拦截本机访问）与不可变风控事件
  await db
    .insert(ipBlacklist)
    .values([
      {
        ipPattern: '203.0.113.99',
        reason: '演示拦截：1 分钟内连续恶意探测游客查单接口 45 次',
        createdBy: 'admin@accthub.dev',
        createdAt: offsetSqlTime(-30),
      },
      {
        ipPattern: '198.51.100.0/24',
        reason: '演示网段封禁：自动化扫号机房代理出口 CIDR',
        createdBy: 'admin@accthub.dev',
        createdAt: offsetSqlTime(-72),
      },
    ])
    .onConflictDoNothing();

  const existingRiskEvents = await db.select({ id: riskEvents.id }).from(riskEvents).limit(1);
  if (existingRiskEvents.length === 0) {
    await db.insert(riskEvents).values([
      {
        eventType: 'blacklist_block',
        severity: 'high',
        buyerIp: '203.0.113.99',
        contactEmail: 'bot.probe@invalid.test',
        summary: '拦截黑名单 IP 尝试提交批量游客订单（已阻断）',
        detailJson: JSON.stringify({ rule: 'ip_blacklist', matched: '203.0.113.99', qty: 20 }),
        mailAlertCount: 1,
        createdAt: offsetSqlTime(-18),
      },
      {
        eventType: 'velocity_spike',
        severity: 'medium',
        orderNo: orderRefs.pulseDeliveredOrderNo,
        buyerIp: '198.51.100.66',
        contactEmail: 'campus.geek@pulse.test',
        summary: '校园网出口短时集中拼单告警（复核为正常促销流量）',
        detailJson: JSON.stringify({ window_minutes: 5, order_count: 6 }),
        mailAlertCount: 0,
        createdAt: offsetSqlTime(-22),
      },
      {
        eventType: 'price_guard_alert',
        severity: 'critical',
        summary: '上游成本监控熔断：检测到单个 SKU 上游报价暴涨 38%，已阻止自动同步改价',
        detailJson: JSON.stringify({ sku: 'SKU-GPT-TEAM', pct_change: 38 }),
        mailAlertCount: 3,
        createdAt: offsetSqlTime(-18),
      },
    ]);
  }

  // 4. 出站业务 Webhook 扩展钩子演示
  const existingHooks = await db.select({ id: outboundWebhooks.id }).from(outboundWebhooks).limit(1);
  if (existingHooks.length === 0) {
    await db.insert(outboundWebhooks).values([
      {
        ownerAgentId: 0,
        name: 'ERP 履约回调钩子（演示）',
        url: 'https://erp.example.test/webhooks/accthub-fulfill',
        secretEnc: await encryptSecret(env, 'whsec_demo_erp_hmac_2026'),
        eventsJson: JSON.stringify(['order.created', 'order.delivered', 'order.refunded']),
        enabled: 0,
        allowFulfillOverride: 1,
        lastStatus: 200,
        lastError: '',
        lastTriggeredAt: offsetSqlTime(-4),
      },
      {
        ownerAgentId: 0,
        name: '企业飞书/钉钉成交播报钩子（演示）',
        url: 'https://notify.example.test/webhooks/sales-bot',
        secretEnc: await encryptSecret(env, 'whsec_demo_notify_hmac_2026'),
        eventsJson: JSON.stringify(['order.delivered']),
        enabled: 0,
        allowFulfillOverride: 0,
        lastStatus: 200,
        lastError: '',
        lastTriggeredAt: offsetSqlTime(-2),
      },
    ]);
  }

  // 5. 邮件投递日志与总控操作审计日志
  const existingMailLogs = await db.select({ id: emailDeliveryLogs.id }).from(emailDeliveryLogs).limit(1);
  if (existingMailLogs.length === 0) {
    await db.insert(emailDeliveryLogs).values([
      {
        ownerAgentId: 0,
        orderNo: orderRefs.mainDeliveredOrderNo,
        toEmail: 'alice@accthub.dev',
        subject: '【AcctHub】您的订单已自动发货，请查收卡密凭证',
        provider: 'resend',
        scene: 'order_delivery',
        status: 'sent',
        createdAt: offsetSqlTime(-96),
      },
      {
        ownerAgentId: ctx.studioAgentId,
        orderNo: orderRefs.studioDeliveredOrderNo,
        toEmail: 'sub.buyer@studio.demo',
        subject: '【星尘 AI 研选社】订单交付成功通知',
        provider: 'resend',
        scene: 'order_delivery',
        status: 'sent',
        createdAt: offsetSqlTime(-60),
      },
      {
        ownerAgentId: 0,
        orderNo: orderRefs.expiringOrderNo,
        toEmail: 'member@accthub.dev',
        subject: '【AcctHub】您的订阅席位将于 2 天后到期，支持一键复购',
        provider: 'resend',
        scene: 'renewal_reminder',
        status: 'sent',
        createdAt: offsetSqlTime(-12),
      },
    ]);
  }

  const existingAudit = await db.select({ id: adminAuditLogs.id }).from(adminAuditLogs).limit(1);
  if (existingAudit.length === 0) {
    await db.insert(adminAuditLogs).values([
      {
        actorUserId: ctx.adminId,
        actorEmail: 'admin@accthub.dev',
        actorRole: 'admin',
        action: 'domain.approve',
        targetType: 'tenant_domain',
        targetId: 'nebula.accthub.demo',
        summary: '审核通过 V4 战略合伙人 @nebula 独立域名 nebula.accthub.demo 绑定',
        afterJson: JSON.stringify({ hostname: 'nebula.accthub.demo', status: 'active' }),
        ip: '127.0.0.1',
        createdAt: offsetSqlTime(-24),
      },
      {
        actorUserId: ctx.adminId,
        actorEmail: 'admin@accthub.dev',
        actorRole: 'admin',
        action: 'withdrawal.approve',
        targetType: 'agent_withdrawal',
        targetId: 'WD-SEED-NEBULA-02',
        summary: '审核打款 @nebula 提现申请 ¥200.00（手续费 ¥2.00，实付 ¥198.00）',
        afterJson: JSON.stringify({ amount: 200, fee_amount: 2, net_amount: 198, status: 'paid' }),
        ip: '127.0.0.1',
        createdAt: offsetSqlTime(-45),
      },
      {
        actorUserId: ctx.adminId,
        actorEmail: 'admin@accthub.dev',
        actorRole: 'admin',
        action: 'risk.blacklist_add',
        targetType: 'ip_blacklist',
        targetId: '203.0.113.99',
        summary: '将异常扫单源 IP 203.0.113.99 加入全站黑名单',
        afterJson: JSON.stringify({ ip_pattern: '203.0.113.99' }),
        ip: '127.0.0.1',
        createdAt: offsetSqlTime(-30),
      },
    ]);
  }
}
