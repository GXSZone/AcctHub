import type { Env, TenantContext } from '../../env';
import type { AppDatabase } from '../../infra/db';
import { getSiteMailConfig, isMailConfigAutoDeliveryReady } from '../../infra/mail';
import { sendQueuedOrderEmails } from '../../infra/mail.outbox';
import { dispatchOpsNotification, getOpsNotifyConfig } from '../../infra/notify';
import { countRemainingSpecCards } from './orders.repo';

export interface MailDeliverySummary {
  status: 'sent' | 'pending' | 'disabled';
  reason?: string;
}

/** 订单成交后立即触发买家发信队列并推送新单/低库存运维通知 */
export async function dispatchPostOrderNotifications(
  env: Env,
  db: AppDatabase,
  params: {
    tenant: TenantContext;
    tenantAgentId: number | null;
    orderNo: string;
    publicNo?: string;
    productId: number;
    productOriginalTitle: string;
    effectiveProductTitle: string;
    specId: string;
    specName: string;
    qty: number;
    totalAmount: number;
    paymentMethod: string;
    email: string;
    orderStatus: string;
    stockMode: string;
    deliveryType: string;
  }
): Promise<MailDeliverySummary> {
  const {
    tenant,
    tenantAgentId,
    orderNo,
    publicNo,
    productId,
    productOriginalTitle,
    effectiveProductTitle,
    specId,
    specName,
    qty,
    totalAmount,
    paymentMethod,
    email,
    orderStatus,
    stockMode,
    deliveryType,
  } = params;

  void dispatchOpsNotification(env, 'new_order', '新订单成交提醒', [
    `订单号：${orderNo}`,
    `商品：${effectiveProductTitle} (${specName}) × ${qty}`,
    `实付：¥${totalAmount.toFixed(2)}（${paymentMethod === 'balance' ? '余额支付' : '在线收银台'}）`,
    `客户邮箱：${email}`,
    ...(tenant.isSubAgent && tenant.brandName ? [`来源分站：${tenant.brandName} (@${tenant.slug})`] : []),
  ]);

  if (stockMode === 'cards' && deliveryType !== 'api_key') {
    const rem = await countRemainingSpecCards(db, productId, specId);
    const notifyCfg = await getOpsNotifyConfig(env);
    if (rem <= notifyCfg.lowStockThreshold) {
      void dispatchOpsNotification(env, 'low_stock', '卡密库存低位预警', [
        `商品：${productOriginalTitle}（${specName}）`,
        `剩余可用卡密：仅剩 ${rem} 张（预警阈值 ${notifyCfg.lowStockThreshold}）`,
        '请尽快前往总控后台补录卡密，避免断货！',
      ]);
    }
  }

  if (!publicNo || (orderStatus !== 'delivered' && orderStatus !== 'paid')) {
    return { status: 'disabled', reason: 'not_delivered' };
  }

  const ownerAgentId = tenantAgentId ?? 0;
  try {
    const cfg = await getSiteMailConfig(env, ownerAgentId);
    if (!isMailConfigAutoDeliveryReady(cfg)) {
      return { status: 'disabled', reason: 'not_configured' };
    }
    const mailRes = await sendQueuedOrderEmails(env, ownerAgentId, publicNo);
    if (mailRes.mail_status === 'sent') {
      return { status: 'sent' };
    }
    if (mailRes.mail_status === 'disabled') {
      return { status: 'disabled', reason: mailRes.error || 'disabled' };
    }
    return { status: 'pending', reason: mailRes.error };
  } catch {
    return { status: 'pending' };
  }
}
