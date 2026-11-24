import { desc, eq, sql } from 'drizzle-orm';
import { emailDeliveryLogs, siteMailConfigs } from '../db/schema/index';
import type { AppDatabase } from './db';

export interface EmailDeliveryLogRow {
  id: number;
  owner_agent_id: number;
  order_no: string;
  to_email: string;
  subject: string;
  provider: string;
  scene: string;
  status: 'sent' | 'failed' | string;
  error_message: string;
  created_at: string;
}

export async function findSiteMailConfigRow(db: AppDatabase, ownerAgentId: number) {
  const rows = await db
    .select()
    .from(siteMailConfigs)
    .where(eq(siteMailConfigs.ownerAgentId, ownerAgentId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertSiteMailConfigRow(
  db: AppDatabase,
  values: {
    ownerAgentId: number;
    enabled: number;
    autoSendOrder: number;
    autoSendRestock: number;
    provider: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    apiKeyEncrypted: string;
    apiEndpoint: string;
    mailgunDomain: string;
    footerNote: string;
    orderEmailSubjectTpl?: string;
    orderEmailBodyTpl?: string;
  }
): Promise<void> {
  await db
    .insert(siteMailConfigs)
    .values({
      ...values,
      orderEmailSubjectTpl: values.orderEmailSubjectTpl ?? '',
      orderEmailBodyTpl: values.orderEmailBodyTpl ?? '',
    })
    .onConflictDoUpdate({
      target: siteMailConfigs.ownerAgentId,
      set: {
        enabled: values.enabled,
        autoSendOrder: values.autoSendOrder,
        autoSendRestock: values.autoSendRestock,
        provider: values.provider,
        fromName: values.fromName,
        fromEmail: values.fromEmail,
        replyTo: values.replyTo,
        apiKeyEncrypted: values.apiKeyEncrypted,
        apiEndpoint: values.apiEndpoint,
        mailgunDomain: values.mailgunDomain,
        footerNote: values.footerNote,
        orderEmailSubjectTpl: values.orderEmailSubjectTpl ?? '',
        orderEmailBodyTpl: values.orderEmailBodyTpl ?? '',
        updatedAt: sql`datetime('now')`,
      },
    });
}

export async function listSiteMailLogRows(
  db: AppDatabase,
  ownerAgentId: number,
  limit = 25
): Promise<EmailDeliveryLogRow[]> {
  const rows = await db
    .select()
    .from(emailDeliveryLogs)
    .where(eq(emailDeliveryLogs.ownerAgentId, ownerAgentId))
    .orderBy(desc(emailDeliveryLogs.id))
    .limit(Math.min(100, Math.max(1, limit)));

  return rows.map((r) => ({
    id: r.id,
    owner_agent_id: r.ownerAgentId,
    order_no: r.orderNo,
    to_email: r.toEmail,
    subject: r.subject,
    provider: r.provider,
    scene: r.scene,
    status: r.status,
    error_message: r.errorMessage,
    created_at: r.createdAt,
  }));
}

export async function insertMailDeliveryLogRow(
  db: AppDatabase,
  entry: {
    ownerAgentId: number;
    orderNo?: string;
    toEmail: string;
    subject: string;
    provider: string;
    scene: string;
    status: 'sent' | 'failed';
    errorMessage?: string;
  }
): Promise<void> {
  try {
    await db.insert(emailDeliveryLogs).values({
      ownerAgentId: entry.ownerAgentId,
      orderNo: entry.orderNo || '',
      toEmail: entry.toEmail,
      subject: entry.subject.slice(0, 180),
      provider: entry.provider,
      scene: entry.scene,
      status: entry.status,
      errorMessage: (entry.errorMessage || '').slice(0, 500),
    });
  } catch {
    // 非阻塞审计日志，写库失败不影响发信主流程
  }
}
