import { resolveSiteBrandName } from '../domains/payment/payment.order.repo';
import type { Env } from '../env';
import { readDeliveryPayload } from './credential-storage';
import { decryptSecret, encryptSecret } from './crypto';
import { createDb } from './db';
import { getSiteMailConfig, type MailMessage, type MailResult, sendSiteEmail } from './mail';
import {
  claimDueMailRepo,
  enqueueMailRepo,
  findMailOrderRepo,
  findMailOutboxStatusRepo,
  findMailSubscriptionRepo,
  finishMailOutboxRepo,
  type OutboxRow,
  type OutboxStatus,
  requeueOrderMailRepo,
} from './mail.outbox.repo';
import {
  buildOrderCreatedEmailTemplate,
  buildOrderDeliveryEmailTemplate,
  buildRestockEmailTemplate,
} from './mail.templates';

export type QueuedMailResult = MailResult & { mail_status: OutboxStatus };

const LEASE_MS = 120_000;
const BATCH_SIZE = 6;
const MAX_BATCHES = 10;

export async function enqueueMail(env: Env, ownerAgentId: number, eventKey: string, message: MailMessage) {
  const payload = await encryptSecret(
    env,
    JSON.stringify(message),
    `mail-outbox:${ownerAgentId}:${eventKey}`
  );
  await enqueueMailRepo(createDb(env.DB), ownerAgentId, eventKey, message.scene, payload);
}

async function claimMail(env: Env, selector?: { owner: number; key: string }) {
  const now = Date.now();
  return claimDueMailRepo(createDb(env.DB), now, now + LEASE_MS, selector ? 1 : BATCH_SIZE, selector);
}

function mailResult(status: OutboxStatus, error?: string): QueuedMailResult {
  return { ok: status === 'sent', skipped: status === 'disabled', error, mail_status: status };
}

async function buildOrderMail(env: Env, row: OutboxRow): Promise<MailMessage | undefined> {
  if (row.orderId === null) return;
  const db = createDb(env.DB);
  const order = await findMailOrderRepo(db, row.orderId, row.ownerAgentId);
  if (!order?.publicOrderNo || !order.contactEmail) return;
  const cfg = await getSiteMailConfig(env, row.ownerAgentId);
  const fields = {
    brandName: cfg.from_name || (await resolveSiteBrandName(db, row.ownerAgentId)),
    orderNo: order.publicOrderNo,
    productTitle: order.productTitle,
    specName: order.specName,
    quantity: order.quantity,
    lookupUrl: order.lookupUrl ?? undefined,
  };
  const destination = { to: order.contactEmail, orderNo: fields.orderNo };
  if (row.scene === 'order_created') {
    return { ...buildOrderCreatedEmailTemplate(fields), ...destination, scene: row.scene };
  }
  if (
    (row.scene !== 'order_delivery' && row.scene !== 'order_resend') ||
    order.status !== 'delivered' ||
    !order.deliveredPayload
  )
    return;
  const template = buildOrderDeliveryEmailTemplate({
    ...fields,
    deliveredPayload: await readDeliveryPayload(env, order.orderNo, order.deliveredPayload),
    totalAmount: order.totalAmount,
    warrantySummary: order.warrantySummary,
    footerNote: cfg.footer_note,
  });
  return { ...template, ...destination, scene: row.scene };
}

async function buildRestockMail(env: Env, row: OutboxRow): Promise<MailMessage | undefined> {
  if (row.subscriptionId === null || row.subscriptionCycle === null) return;
  const sub = await findMailSubscriptionRepo(
    createDb(env.DB),
    row.subscriptionId,
    row.ownerAgentId,
    row.subscriptionCycle
  );
  if (!sub) return;
  const config = await getSiteMailConfig(env, row.ownerAgentId);
  const template = buildRestockEmailTemplate(config.from_name || '商城', row.restockTitle);
  return { ...template, to: sub.email, scene: 'restock_alert' };
}

async function processMail(env: Env, row: OutboxRow): Promise<QueuedMailResult> {
  let result: QueuedMailResult;
  try {
    let message: MailMessage | undefined;
    if (row.orderId !== null) {
      message = await buildOrderMail(env, row);
    } else if (row.scene === 'restock_alert') {
      message = await buildRestockMail(env, row);
    } else {
      const decoded = await decryptSecret(
        env,
        row.payload,
        `mail-outbox:${row.ownerAgentId}:${row.eventKey}`
      );
      if (!decoded) throw new Error('无法读取待投递邮件');
      message = JSON.parse(decoded) as MailMessage;
    }
    if (!message) {
      result = mailResult('disabled', '该通知已失效');
    } else {
      const sent = await sendSiteEmail(env, row.ownerAgentId, {
        ...message,
        idempotencyKey: `accthub-mail-${row.id}`,
      });
      result = { ...sent, mail_status: sent.ok ? 'sent' : 'pending' };
    }
  } catch {
    result = mailResult('pending', '邮件暂时无法投递');
  }
  const retryDelay = Math.min(6 * 60 * 60, 30 * 2 ** Math.min(10, row.attempts - 1)) * 1000;
  await finishMailOutboxRepo(
    createDb(env.DB),
    row,
    result.mail_status,
    result.error ?? '',
    Date.now() + retryDelay
  );
  return result;
}

export async function sendQueuedOrderEmails(env: Env, ownerAgentId: number, publicOrderNo: string) {
  await sendQueuedMail(env, ownerAgentId, `order_created:${publicOrderNo}`);
  return sendQueuedMail(env, ownerAgentId, `order_delivery:${publicOrderNo}`);
}

export async function resendQueuedOrderEmail(
  env: Env,
  orderId: number,
  ownerAgentId: number,
  publicOrderNo: string
) {
  const key = await requeueOrderMailRepo(createDb(env.DB), orderId, ownerAgentId, publicOrderNo);
  return sendQueuedMail(env, ownerAgentId, key);
}

export async function sendQueuedMail(
  env: Env,
  ownerAgentId: number,
  eventKey: string
): Promise<QueuedMailResult> {
  const [claimed] = await claimMail(env, { owner: ownerAgentId, key: eventKey });
  if (claimed) return processMail(env, claimed);
  const row = await findMailOutboxStatusRepo(createDb(env.DB), ownerAgentId, eventKey);
  return mailResult(row?.status ?? 'disabled', row?.lastError || undefined);
}

export async function drainMailOutbox(env: Env): Promise<void> {
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await claimMail(env);
    if (rows.length === 0) break;
    await Promise.all(rows.map((row) => processMail(env, row)));
  }
}
