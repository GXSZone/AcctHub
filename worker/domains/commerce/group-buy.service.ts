import type { PublicGroupBuySessionDto } from '@shared/contracts/commerce.contract';
import { normalizeBundleItems } from '@shared/domain/commerce-modes';
import { roundCurrency } from '@shared/domain/money';
import { eq } from 'drizzle-orm';
import { type GroupBuySessionRow, orders, type ProductRow, products } from '../../db/schema/index';
import type { AuthUser, ProductSpec } from '../../db/types';
import type { Env, TenantContext } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import { generateRandomCode } from '../../infra/crypto';
import { type AppDatabase, createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { drainMailOutbox, enqueueMail, resendQueuedOrderEmail } from '../../infra/mail.outbox';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { creditUserBalance, hasWalletTxByRefRepo, recordWalletTx } from '../account/wallet.repo';
import { settleOrderProfitDispatch } from '../agent/settlement.service';
import { checkSpecAvailability, executeUnifiedFulfillment } from '../fulfillment/fulfillment.service';
import { findOrderByNo, findProductById, resolveSiteBrandName } from '../payment/payment.order.repo';
import { findActiveProductByIdOrSlug } from '../storefront/storefront.repo';
import { fulfillBundleCardsAtomically } from './bundle.service';
import {
  createGroupBuySessionRepo,
  findGroupBuyMemberByUserRepo,
  findGroupBuySessionByCodeRepo,
  joinGroupBuySessionAtomicRepo,
  listExpiredOpenGroupBuysRepo,
  listGroupBuyMembersRepo,
  listOpenGroupBuySessionsForProductRepo,
  lockExpiredGroupBuyCasRepo,
  markGroupBuyCompletedCasRepo,
  updateGroupBuyMemberStatusRepo,
} from './group-buy.repo';

function maskLeaderName(name: string): string {
  const clean = (name || 'Member').trim();
  if (clean.length <= 1) return `${clean}***`;
  if (clean.length <= 3) return `${clean[0]}***`;
  return `${clean.slice(0, 2)}***${clean.slice(-1)}`;
}

function mapPublicSession(row: GroupBuySessionRow): PublicGroupBuySessionDto {
  return {
    id: row.id,
    code: row.code,
    product_id: row.productId,
    spec_id: row.specId,
    leader_name: maskLeaderName(row.leaderName),
    required_size: row.requiredSize,
    current_size: row.currentSize,
    remaining_slots: Math.max(0, row.requiredSize - row.currentSize),
    group_price: Number(row.groupPrice),
    status: row.status as PublicGroupBuySessionDto['status'],
    expires_at: row.expiresAt,
    created_at: row.createdAt,
  };
}

/** 前台查询指定商品进行中的公开拼团列表（按当前站点租户隔离） */
export async function listProductOpenGroupBuys(
  env: Env,
  tenant: TenantContext,
  idOrSlug: string
): Promise<{ sessions: PublicGroupBuySessionDto[] }> {
  const db = createDb(env.DB);
  const siteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(siteAgentId > 0 && tenant.capabilities?.allow_private_products);
  const prod = await findActiveProductByIdOrSlug(db, idOrSlug, siteAgentId, includePrivate);
  if (!prod || Number(prod.groupBuyEnabled || 0) !== 1) return { sessions: [] };
  const rows = await listOpenGroupBuySessionsForProductRepo(
    db,
    siteAgentId,
    prod.id,
    new Date().toISOString()
  );
  return { sessions: rows.map(mapPublicSession) };
}

/** 按拼团分享码查询单团实时进度 */
export async function getPublicGroupBuyByCode(
  env: Env,
  tenant: TenantContext,
  code: string
): Promise<{ session: PublicGroupBuySessionDto }> {
  const db = createDb(env.DB);
  const siteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const row = await findGroupBuySessionByCodeRepo(db, code);
  if (!row || row.siteAgentId !== siteAgentId) {
    throw Errors.notFound('拼团场次不存在或已失效');
  }
  return { session: mapPublicSession(row) };
}

/** 下单前校验拼团参数并返回拼团单价与目标团信息 */
export async function validateGroupBuyCheckout(
  db: AppDatabase,
  params: {
    siteAgentId: number;
    product: ProductRow;
    specId: string;
    qty: number;
    user: AuthUser | null;
    mode: 'start' | 'join';
    code?: string;
  }
): Promise<{ groupPrice: number; targetSession: GroupBuySessionRow | null }> {
  const { siteAgentId, product, specId, qty, user, mode, code } = params;
  if (!user) {
    throw Errors.unauthorized('参与或发起拼团合租请先登录账号，以便超时未成团时自动全额退回钱包余额');
  }
  if (Number(product.groupBuyEnabled || 0) !== 1) {
    throw Errors.validation('该商品暂未开启拼团合租活动');
  }
  const groupPrice = Number(product.groupBuyPrice || 0);
  if (!Number.isFinite(groupPrice) || groupPrice <= 0) {
    throw Errors.validation('该商品拼团价配置无效');
  }
  if (qty !== 1) {
    throw Errors.validation('拼团合租每单限购 1 份，如需多份请另行参团或单独购买');
  }

  if (mode === 'join') {
    const cleanCode = (code || '').trim().toUpperCase();
    if (!cleanCode) throw Errors.validation('请提供要加入的拼团口令/团号');
    const session = await findGroupBuySessionByCodeRepo(db, cleanCode);
    if (!session || session.siteAgentId !== siteAgentId || session.productId !== product.id) {
      throw Errors.notFound('未找到该拼团场次');
    }
    if (session.specId !== specId) {
      throw Errors.validation('所选规格与目标拼团规格不一致');
    }
    if (session.status !== 'open' || session.currentSize >= session.requiredSize) {
      throw Errors.conflict('该拼团已满员或已结束，请选择其他团或新开一团');
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw Errors.conflict('该拼团已过截止时间，请重新开团');
    }
    const alreadyIn = await findGroupBuyMemberByUserRepo(db, session.id, user.id);
    if (alreadyIn) {
      throw Errors.conflict('您已参与该拼团，请勿重复参团');
    }
    return { groupPrice: Number(session.groupPrice), targetSession: session };
  }

  return { groupPrice: roundCurrency(groupPrice), targetSession: null };
}

/** 拼团满员后：逐一为所有已付款团员执行发卡履约并推进订单为 delivered */
async function fulfillCompletedGroupBuySession(
  env: Env,
  db: AppDatabase,
  session: GroupBuySessionRow,
  originUrl: string
): Promise<void> {
  const members = await listGroupBuyMembersRepo(db, session.id);
  const product = await findProductById(db, session.productId);
  if (!product) return;

  const bundleItems = normalizeBundleItems(product.bundleItemsJson);
  const specs = safeJsonParse<ProductSpec[]>(product.specsJson || '[]', []);
  const selectedSpec: ProductSpec = specs.find((s) => s.id === session.specId) ?? {
    id: session.specId,
    name: '拼团合租版',
    price: Number(session.groupPrice),
  };

  for (const m of members) {
    if (m.status !== 'paid') continue;
    const order = await findOrderByNo(db, m.orderNo);
    if (order?.status !== 'grouping') continue;

    let deliveredLines: string[] = [];
    let finalStatus: 'delivered' | 'paid' | 'upstream_pending' | 'fulfillment_failed' = 'delivered';
    let fulfillmentSource: 'local' | 'upstream' = 'local';
    let upstreamSourceId: number | null = null;
    let upstreamOrderNo = '';
    let upstreamCostTotal = 0;
    let upstreamStatus: 'none' | 'pending' | 'delivered' | 'failed' = 'none';
    let upstreamError = '';

    if (bundleItems.length > 0) {
      const bRes = await fulfillBundleCardsAtomically(env, db, {
        orderNo: order.orderNo,
        bundleProductId: product.id,
        bundleItems,
        quantity: order.quantity,
      });
      if (bRes.ok) {
        deliveredLines = bRes.deliveredLines;
      } else {
        finalStatus = 'fulfillment_failed';
        upstreamError = bRes.error;
      }
    } else {
      const availability = await checkSpecAvailability(env, {
        productId: product.id,
        productOwnerAgentId: product.ownerAgentId,
        spec: selectedSpec,
        specsCount: specs.length,
        quantity: order.quantity,
        stockMode: product.stockMode || 'cards',
        deliveryType: product.deliveryType || 'auto',
        manualStock: product.manualStock || 0,
        seatTotal: product.seatTotal || 5,
        seatUsed: product.seatUsed || 0,
      });
      const fulfill = await executeUnifiedFulfillment(env, {
        orderNo: order.orderNo,
        channel: 'web',
        paymentMethod: order.paymentMethod,
        productId: product.id,
        productOwnerAgentId: product.ownerAgentId,
        productTitle: order.productTitle,
        spec: selectedSpec,
        specsCount: specs.length,
        quantity: order.quantity,
        stockMode: product.stockMode || 'cards',
        deliveryType: product.deliveryType || 'auto',
        contactEmail: order.contactEmail,
        totalAmount: order.totalAmount,
        originUrl,
        availability,
      });
      if (fulfill.ok) {
        deliveredLines = fulfill.deliveredLines;
        finalStatus = fulfill.orderStatus;
        fulfillmentSource = fulfill.fulfillmentSource;
        upstreamSourceId = fulfill.upstreamSourceId;
        upstreamOrderNo = fulfill.upstreamOrderNo;
        upstreamCostTotal = fulfill.upstreamCostTotal;
        upstreamStatus = fulfill.upstreamStatus;
        upstreamError = fulfill.upstreamError;
      } else {
        finalStatus = 'fulfillment_failed';
        upstreamError = fulfill.conflictError || '拼团成团发卡库存不足';
      }
    }

    let commissionAmount = 0;
    if (finalStatus === 'delivered' || finalStatus === 'paid') {
      commissionAmount = await settleOrderProfitDispatch({
        env,
        orderNo: order.orderNo,
        productOwnerAgentId: product.ownerAgentId,
        buyerWholesaleAgentId: 0,
        sellingAgentId: Number(order.agentId || 0),
        baseMainTotal: roundCurrency(Number(session.groupPrice) * order.quantity),
        totalAmount: order.totalAmount,
      }).catch(() => 0);
    }

    const nowIso = new Date().toISOString();
    const sealed =
      deliveredLines.length > 0
        ? await sealDeliveryPayload(env, order.orderNo, deliveredLines.join('\n'))
        : '';
    await db
      .update(orders)
      .set({
        status: finalStatus,
        deliveredPayload: sealed,
        deliveredAt: finalStatus === 'delivered' ? nowIso : order.deliveredAt,
        commissionAmount,
        fulfillmentSource,
        upstreamSourceId,
        upstreamOrderNo,
        upstreamCostTotal,
        upstreamStatus,
        upstreamError,
      })
      .where(eq(orders.orderNo, order.orderNo));

    await updateGroupBuyMemberStatusRepo(db, m.id, 'fulfilled');
    if (finalStatus === 'delivered' || finalStatus === 'paid') {
      await settleAffiliateRewardForOrder(env, order.orderNo).catch(() => undefined);
    }
    if (finalStatus === 'delivered') {
      await resendQueuedOrderEmail(
        env,
        order.id,
        Number(order.agentId || 0),
        order.publicOrderNo || order.orderNo
      ).catch(() => undefined);
    }
  }
}

/** 拼团单支付完成后：开团或入团；若满员则原子成团并立即为全体团员发卡 */
export async function commitPaidGroupBuyOrder(
  env: Env,
  db: AppDatabase,
  params: {
    siteAgentId: number;
    product: ProductRow;
    specId: string;
    orderNo: string;
    user: { id: number; displayName: string; email: string };
    contactEmail: string;
    paidAmount: number;
    promoUsedAmount: number;
    mode: 'start' | 'join';
    groupBuyCode?: string;
    originUrl: string;
  }
): Promise<{
  session: PublicGroupBuySessionDto;
  completed: boolean;
  finalOrderStatus: string;
  deliveredPayload: string;
}> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let sessionRow: GroupBuySessionRow;

  if (params.mode === 'start') {
    const requiredSize = Math.max(2, Math.min(20, Math.floor(Number(params.product.groupBuySize || 2))));
    const hours = Math.max(1, Math.min(168, Math.floor(Number(params.product.groupBuyHours || 24))));
    const expiresAt = new Date(nowMs + hours * 3_600_000).toISOString();
    const code = generateRandomCode('GB', 8).toUpperCase();
    sessionRow = await createGroupBuySessionRepo(db, {
      code,
      siteAgentId: params.siteAgentId,
      productId: params.product.id,
      specId: params.specId,
      leaderUserId: params.user.id,
      leaderName: params.user.displayName || params.user.email,
      requiredSize,
      currentSize: 0,
      groupPrice: roundCurrency(Number(params.product.groupBuyPrice || params.paidAmount)),
      status: 'open',
      expiresAt,
    });
    const joined = await joinGroupBuySessionAtomicRepo(db, {
      sessionId: sessionRow.id,
      userId: params.user.id,
      orderNo: params.orderNo,
      email: params.contactEmail,
      paidAmount: params.paidAmount,
      promoUsedAmount: params.promoUsedAmount,
      nowIso,
    });
    if (!joined.joined || !joined.session) {
      throw Errors.conflict('发起拼团失败，请稍后重试');
    }
    sessionRow = joined.session;
  } else {
    const existing = await findGroupBuySessionByCodeRepo(db, params.groupBuyCode || '');
    if (!existing) throw Errors.notFound('目标拼团场次不存在');
    const joined = await joinGroupBuySessionAtomicRepo(db, {
      sessionId: existing.id,
      userId: params.user.id,
      orderNo: params.orderNo,
      email: params.contactEmail,
      paidAmount: params.paidAmount,
      promoUsedAmount: params.promoUsedAmount,
      nowIso,
    });
    if (!joined.joined || !joined.session) {
      // 并发满员或刚刚过期：自动将本次实付退回用户钱包余额（保证财务守恒）
      if (params.paidAmount > 0) {
        const alreadyRefunded = await hasWalletTxByRefRepo(
          db,
          params.user.id,
          'order_refund',
          params.orderNo
        );
        if (!alreadyRefunded) {
          const balAfter = await creditUserBalance(db, params.user.id, params.paidAmount);
          await recordWalletTx(env, {
            userId: params.user.id,
            type: 'order_refund',
            amount: params.paidAmount,
            balanceAfter: balAfter,
            refNo: params.orderNo,
            note: '参团时目标拼团已满员/过期，自动全额退回钱包余额',
          });
        }
      }
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.orderNo, params.orderNo));
      throw Errors.conflict('目标拼团刚刚已满员或过期，您的实付款已自动全额退回站内余额');
    }
    sessionRow = joined.session;
  }

  // 先将当前订单推进至 grouping 并绑定 sessionId
  await db
    .update(orders)
    .set({ status: 'grouping', groupBuySessionId: sessionRow.id })
    .where(eq(orders.orderNo, params.orderNo));

  let completed = false;
  if (sessionRow.currentSize >= sessionRow.requiredSize) {
    const casCompleted = await markGroupBuyCompletedCasRepo(db, sessionRow.id, nowIso);
    if (casCompleted) {
      sessionRow = casCompleted;
      completed = true;
      await fulfillCompletedGroupBuySession(env, db, casCompleted, params.originUrl);
    }
  }

  const latestOrder = await findOrderByNo(db, params.orderNo);
  let deliveredPayload = '';
  if (latestOrder?.status === 'delivered' && latestOrder.deliveredPayload) {
    const { readDeliveryPayload } = await import('../../infra/credential-storage');
    deliveredPayload = await readDeliveryPayload(env, latestOrder.orderNo, latestOrder.deliveredPayload);
  }

  return {
    session: mapPublicSession(sessionRow),
    completed,
    finalOrderStatus: latestOrder?.status || 'grouping',
    deliveredPayload,
  };
}

/**
 * 定时巡检超时未成团的拼团场次：
 * CAS 锁定 expired_refunded -> 为全体已付款团员原子全额退回站内余额并记不可变钱包账本 -> 发送退款通知邮件
 */
export async function runScheduledGroupBuyMaintenance(env: Env): Promise<{
  expiredSessions: number;
  refundedMembers: number;
}> {
  const db = createDb(env.DB);
  const nowIso = new Date().toISOString();
  const expired = await listExpiredOpenGroupBuysRepo(db, nowIso);
  let expiredSessions = 0;
  let refundedMembers = 0;

  for (const session of expired) {
    const locked = await lockExpiredGroupBuyCasRepo(db, session.id);
    if (!locked) continue;
    expiredSessions += 1;

    const members = await listGroupBuyMembersRepo(db, session.id);
    const brandName = await resolveSiteBrandName(db, session.siteAgentId).catch(() => 'AcctHub');
    const [prod] = await db
      .select({ title: products.title })
      .from(products)
      .where(eq(products.id, session.productId))
      .limit(1);

    for (const m of members) {
      if (m.status !== 'paid') continue;
      if (m.paidAmount > 0) {
        const alreadyRefunded = await hasWalletTxByRefRepo(db, m.userId, 'order_refund', m.orderNo);
        if (!alreadyRefunded) {
          const balAfter = await creditUserBalance(db, m.userId, m.paidAmount);
          await recordWalletTx(env, {
            userId: m.userId,
            type: 'order_refund',
            amount: m.paidAmount,
            balanceAfter: balAfter,
            refNo: m.orderNo,
            note: `拼团 ${session.code} 超时未成团，自动全额退回站内余额`,
          });
        }
      }
      await db.update(orders).set({ status: 'refunded' }).where(eq(orders.orderNo, m.orderNo));
      await updateGroupBuyMemberStatusRepo(db, m.id, 'refunded');
      refundedMembers += 1;

      if (m.email && !m.email.endsWith('@oauth.local')) {
        await enqueueMail(env, session.siteAgentId, `gb_refund:${m.orderNo}`, {
          to: m.email,
          subject: `【${brandName}】拼团 ${session.code} 超时未成团，¥${m.paidAmount.toFixed(2)} 已自动退回钱包余额`,
          text: `您好！您参与的「${prod?.title || '拼团商品'}」（团号：${session.code}，订单号：${m.orderNo}）在截止时间内未满 ${session.requiredSize} 人成团，系统已将实付金额 ¥${m.paidAmount.toFixed(2)} 全额退回您的站内钱包余额，可随时重新开团或购买其他商品。`,
          html: `<p>您好！您参与的 <strong>${prod?.title || '拼团商品'}</strong>（团号：<code>${session.code}</code>）超时未成团，实付款 <strong>¥${m.paidAmount.toFixed(2)}</strong> 已自动全额退回您的站内钱包余额。</p>`,
          scene: 'group_buy_refund',
          orderNo: m.orderNo,
        }).catch(() => undefined);
      }
    }
  }

  if (refundedMembers > 0) {
    await drainMailOutbox(env).catch(() => undefined);
  }
  return { expiredSessions, refundedMembers };
}
