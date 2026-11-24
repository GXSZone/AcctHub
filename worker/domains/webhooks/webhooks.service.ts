import type { BusinessWebhookEvent, OutboundWebhookDto } from '@shared/contracts/extensions.contract';
import { eq } from 'drizzle-orm';
import { type OutboundWebhookRow, orders } from '../../db/schema/index';
import type { Env } from '../../env';
import { sealDeliveryPayload } from '../../infra/credential-storage';
import { decryptSecret, encryptSecret, maskSecret } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { sendQueuedOrderEmails } from '../../infra/mail.outbox';
import {
  createOutboundWebhookRepo,
  deleteOutboundWebhookRepo,
  findOutboundWebhookByIdRepo,
  listEnabledOutboundWebhooksRepo,
  listOutboundWebhooksRepo,
  recordWebhookDeliveryResultRepo,
  updateOutboundWebhookRepo,
} from './webhooks.repo';

function assertSafeWebhookUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw Errors.validation('Webhook URL 格式无效');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Errors.validation('Webhook 仅支持 HTTP/HTTPS 协议');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.')
  ) {
    throw Errors.validation('出于 SSRF 安全限制，禁止配置本地或内网 IP 作为 Webhook 推送地址');
  }
  return parsed.toString();
}

/** 计算业务出站 Webhook HMAC-SHA256 签名（hex） */
export async function computeWebhookHmacHex(
  secret: string,
  timestamp: string,
  bodyText: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${bodyText}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function mapWebhookDto(env: Env, row: OutboundWebhookRow): Promise<OutboundWebhookDto> {
  const plain = row.secretEnc ? await decryptSecret(env, row.secretEnc).catch(() => '') : '';
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    has_secret: Boolean(plain),
    secret_masked: maskSecret(plain),
    events: safeJsonParse<BusinessWebhookEvent[]>(row.eventsJson || '[]', []),
    enabled: Number(row.enabled || 0) === 1,
    allow_fulfill_override: Number(row.allowFulfillOverride || 0) === 1,
    last_status: row.lastStatus ?? null,
    last_error: row.lastError || '',
    last_triggered_at: row.lastTriggeredAt ?? null,
    created_at: row.createdAt,
  };
}

export async function listAdminWebhooks(env: Env): Promise<{ webhooks: OutboundWebhookDto[] }> {
  const rows = await listOutboundWebhooksRepo(createDb(env.DB), 0);
  return { webhooks: await Promise.all(rows.map((r) => mapWebhookDto(env, r))) };
}

export async function createAdminWebhook(
  env: Env,
  input: {
    name: string;
    url: string;
    secret?: string;
    events: BusinessWebhookEvent[];
    enabled?: boolean;
    allow_fulfill_override?: boolean;
  }
) {
  const safeUrl = assertSafeWebhookUrl(input.url);
  const secretEnc = input.secret?.trim() ? await encryptSecret(env, input.secret.trim()) : '';
  const created = await createOutboundWebhookRepo(createDb(env.DB), {
    ownerAgentId: 0,
    name: input.name.trim(),
    url: safeUrl,
    secretEnc,
    eventsJson: JSON.stringify(Array.from(new Set(input.events))),
    enabled: input.enabled === false ? 0 : 1,
    allowFulfillOverride: input.allow_fulfill_override ? 1 : 0,
  });
  return { ok: true, webhook: await mapWebhookDto(env, created) };
}

export async function updateAdminWebhook(
  env: Env,
  id: number,
  input: Partial<{
    name: string;
    url: string;
    secret: string;
    events: BusinessWebhookEvent[];
    enabled: boolean;
    allow_fulfill_override: boolean;
  }>
) {
  const db = createDb(env.DB);
  const existing = await findOutboundWebhookByIdRepo(db, id, 0);
  if (!existing) throw Errors.notFound('Webhook 配置不存在');

  const patch: Partial<typeof import('../../db/schema/index').outboundWebhooks.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.url !== undefined) patch.url = assertSafeWebhookUrl(input.url);
  if (input.secret?.trim()) {
    patch.secretEnc = await encryptSecret(env, input.secret.trim());
  }
  if (input.events !== undefined) patch.eventsJson = JSON.stringify(Array.from(new Set(input.events)));
  if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0;
  if (input.allow_fulfill_override !== undefined) {
    patch.allowFulfillOverride = input.allow_fulfill_override ? 1 : 0;
  }

  const updated = await updateOutboundWebhookRepo(db, id, 0, patch);
  if (!updated) throw Errors.notFound('Webhook 配置不存在');
  return { ok: true, webhook: await mapWebhookDto(env, updated) };
}

export async function deleteAdminWebhook(env: Env, id: number) {
  const deleted = await deleteOutboundWebhookRepo(createDb(env.DB), id, 0);
  if (!deleted) throw Errors.notFound('Webhook 配置不存在');
  return { ok: true };
}

/** 向单个出站 Webhook 发送签名事件，并支持外部响应回填交付凭证 */
async function deliverSingleWebhook(
  env: Env,
  row: OutboundWebhookRow,
  event: BusinessWebhookEvent,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; status: number; error: string; fulfillPayload?: string }> {
  const db = createDb(env.DB);
  const bodyText = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
  const ts = String(Math.floor(Date.now() / 1000));
  const secret = row.secretEnc ? await decryptSecret(env, row.secretEnc).catch(() => '') : '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-AcctHub-Event': event,
    'X-AcctHub-Timestamp': ts,
    'User-Agent': 'AcctHub-Webhook/2.0',
  };
  if (secret) {
    headers['X-AcctHub-Signature'] = `sha256=${await computeWebhookHmacHex(secret, ts, bodyText)}`;
  }

  try {
    const res = await fetch(row.url, { method: 'POST', headers, body: bodyText });
    const text = await res.text().catch(() => '');
    const errMsg = res.ok ? '' : `HTTP ${res.status}: ${text.slice(0, 160)}`;
    await recordWebhookDeliveryResultRepo(db, row.id, res.status, errMsg);

    let fulfillPayload: string | undefined;
    if (res.ok && Number(row.allowFulfillOverride || 0) === 1 && text.trim().startsWith('{')) {
      const json = safeJsonParse<{ delivered_payload?: string }>(text, {});
      if (typeof json.delivered_payload === 'string' && json.delivered_payload.trim()) {
        fulfillPayload = json.delivered_payload.trim();
      }
    }
    return { ok: res.ok, status: res.status, error: errMsg, fulfillPayload };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络请求失败';
    await recordWebhookDeliveryResultRepo(db, row.id, 0, msg);
    return { ok: false, status: 0, error: msg };
  }
}

export async function testAdminWebhook(env: Env, id: number) {
  const row = await findOutboundWebhookByIdRepo(createDb(env.DB), id, 0);
  if (!row) throw Errors.notFound('Webhook 配置不存在');
  const res = await deliverSingleWebhook(env, row, 'order.delivered', {
    test: true,
    order_no: 'AH-TEST-WEBHOOK',
    product_title: '测试商品',
    quantity: 1,
    total_amount: 19.9,
  });
  return { ok: res.ok, status: res.status, error: res.error };
}

/** 广播业务出站事件（若外部开通服务同步返回 delivered_payload，自动更新订单交付凭证） */
export async function dispatchBusinessWebhookEvent(
  env: Env,
  event: BusinessWebhookEvent,
  payload: Record<string, unknown> & { order_no?: string }
): Promise<{ deliveredPayloadOverride?: string }> {
  const db = createDb(env.DB);
  const hooks = await listEnabledOutboundWebhooksRepo(db, 0);
  let override: string | undefined;

  for (const hook of hooks) {
    const subscribed = safeJsonParse<string[]>(hook.eventsJson || '[]', []);
    if (!subscribed.includes(event)) continue;
    const res = await deliverSingleWebhook(env, hook, event, payload);
    if (res.fulfillPayload && !override) {
      override = res.fulfillPayload;
    }
  }

  if (override && payload.order_no) {
    const sealed = await sealDeliveryPayload(env, payload.order_no, override);
    await db
      .update(orders)
      .set({
        status: 'delivered',
        deliveredPayload: sealed,
        deliveredAt: new Date().toISOString(),
      })
      .where(eq(orders.orderNo, payload.order_no));
  }

  return { deliveredPayloadOverride: override };
}

/** 外部系统异步开通完成后，凭 Webhook HMAC 签名主动回调回填订单交付凭证 */
export async function handleExternalFulfillCallback(
  env: Env,
  req: Request,
  bodyText: string,
  parsed: { order_no: string; delivered_payload: string }
) {
  const db = createDb(env.DB);
  const sigHeader = (req.headers.get('X-AcctHub-Signature') || '').replace(/^sha256=/i, '').trim();
  const tsHeader = (req.headers.get('X-AcctHub-Timestamp') || '').trim();
  if (!sigHeader || !tsHeader) {
    throw Errors.unauthorized('缺少 Webhook 签名头（X-AcctHub-Signature / X-AcctHub-Timestamp）');
  }
  const tsNum = Number(tsHeader);
  if (!Number.isFinite(tsNum) || Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) {
    throw Errors.unauthorized('Webhook 签名时间戳已过期');
  }

  const hooks = await listEnabledOutboundWebhooksRepo(db, 0);
  let verified = false;
  for (const h of hooks) {
    if (Number(h.allowFulfillOverride || 0) !== 1 || !h.secretEnc) continue;
    const secret = await decryptSecret(env, h.secretEnc).catch(() => '');
    if (!secret) continue;
    const expected = await computeWebhookHmacHex(secret, tsHeader, bodyText);
    if (expected === sigHeader) {
      verified = true;
      break;
    }
  }
  if (!verified) {
    throw Errors.unauthorized('Webhook 回填签名验证失败或未授权自动回填');
  }

  const [order] = await db.select().from(orders).where(eq(orders.orderNo, parsed.order_no)).limit(1);
  if (!order) throw Errors.notFound('订单不存在');
  const sealed = await sealDeliveryPayload(env, order.orderNo, parsed.delivered_payload);
  await db
    .update(orders)
    .set({
      status: 'delivered',
      deliveredPayload: sealed,
      deliveredAt: new Date().toISOString(),
    })
    .where(eq(orders.orderNo, order.orderNo));

  await sendQueuedOrderEmails(env, Number(order.agentId || 0), order.publicOrderNo || order.orderNo).catch(
    () => undefined
  );
  return { ok: true, order_no: order.orderNo, status: 'delivered' };
}
