import { evaluateSubscriptionRenewalHint } from '@shared/domain/commerce-modes';
import { and, eq, gt, isNotNull } from 'drizzle-orm';
import { orders } from '../../db/schema/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { drainMailOutbox, enqueueMail } from '../../infra/mail.outbox';
import { resolveSiteBrandName } from '../payment/payment.order.repo';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 定时巡检即将到期的已交付订阅订单（到期前 3 天内自动发送续费提醒邮件 + 一键复购直达链接）
 */
export async function runScheduledRenewalReminders(env: Env): Promise<{
  scanned: number;
  reminded: number;
}> {
  const db = createDb(env.DB);
  const candidates = await db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      publicOrderNo: orders.publicOrderNo,
      agentId: orders.agentId,
      contactEmail: orders.contactEmail,
      productId: orders.productId,
      productTitle: orders.productTitle,
      specId: orders.specId,
      specName: orders.specName,
      lookupUrl: orders.lookupUrl,
      warrantyType: orders.warrantyType,
      warrantyDays: orders.warrantyDays,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'delivered'),
        eq(orders.renewalRemindedAt, ''),
        gt(orders.warrantyDays, 0),
        isNotNull(orders.deliveredAt)
      )
    )
    .limit(100);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  let reminded = 0;

  for (const row of candidates) {
    const email = (row.contactEmail || '').trim();
    if (!email || email.endsWith('@oauth.local')) continue;

    const hint = evaluateSubscriptionRenewalHint(row.deliveredAt, row.warrantyType, row.warrantyDays, nowMs);
    if (!hint.eligible || hint.remainingDays === null || hint.remainingDays <= 0 || hint.remainingDays > 3) {
      continue;
    }

    // CAS 原子标记已提醒，防止并发定时任务重复发信
    const marked = await db
      .update(orders)
      .set({ renewalRemindedAt: nowIso })
      .where(and(eq(orders.id, row.id), eq(orders.renewalRemindedAt, '')))
      .returning({ id: orders.id });
    if (marked.length === 0) continue;

    const ownerAgentId = row.agentId && row.agentId > 0 ? row.agentId : 0;
    const brandName = await resolveSiteBrandName(db, ownerAgentId).catch(() => 'AcctHub');
    let rebuyUrl = `/item/${row.productId}?spec=${encodeURIComponent(row.specId || 'default')}&rebuy=1`;
    if (row.lookupUrl) {
      try {
        const origin = new URL(row.lookupUrl).origin;
        rebuyUrl = `${origin}${rebuyUrl}`;
      } catch {
        // 保留相对路径
      }
    }

    const displayNo = row.publicOrderNo || row.orderNo;
    const expiresLabel = hint.expiresAt ? hint.expiresAt.slice(0, 10) : '';
    const subject = `【${brandName}】您的「${row.productTitle}」将在 ${hint.remainingDays} 天后到期，点击一键续费`;
    const text = [
      `您好！`,
      `您在 ${brandName} 购买的「${row.productTitle}${row.specName ? `（${row.specName}）` : ''}」（订单号：${displayNo}）预计将于 ${expiresLabel} 到期（剩余 ${hint.remainingDays} 天）。`,
      `为避免服务中断，您可直接访问下方链接一键复购续费：`,
      rebuyUrl,
    ].join('\n');
    const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e7e5e4;border-radius:16px">
      <h2 style="margin:0 0 12px;font-size:18px;color:#1c1917">${escapeHtml(brandName)} · 服务即将到期提醒</h2>
      <p style="font-size:14px;color:#44403c;line-height:1.6">您购买的 <strong>${escapeHtml(row.productTitle)}</strong>（订单号：<code>${escapeHtml(displayNo)}</code>）将于 <strong>${escapeHtml(expiresLabel)}</strong> 到期（剩余 ${hint.remainingDays} 天）。</p>
      <p style="margin:20px 0"><a href="${escapeHtml(rebuyUrl)}" style="display:inline-block;padding:10px 20px;border-radius:10px;background:#D97757;color:#fff;text-decoration:none;font-weight:600;font-size:14px">立即一键复购续费</a></p>
      <p style="font-size:12px;color:#78716c">如已续费可忽略此提醒。</p>
    </div>`;

    await enqueueMail(env, ownerAgentId, `renewal:${row.orderNo}`, {
      to: email,
      subject,
      text,
      html,
      scene: 'renewal_reminder',
      orderNo: displayNo,
    }).catch(() => undefined);
    reminded += 1;
  }

  if (reminded > 0) {
    await drainMailOutbox(env).catch(() => undefined);
  }
  return { scanned: candidates.length, reminded };
}
