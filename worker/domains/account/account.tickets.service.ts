import {
  type BatchTotpVaultInput,
  type CreateTicketInput,
  type CreateTotpVaultInput,
  evaluateOrderWarranty,
  type ReplyTicketInput,
} from '@shared/index';
import type { AuthUser } from '../../db/types';
import type { Env, TenantContext } from '../../env';
import { decryptSecret, encryptSecret, generateBizNo } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { dispatchOpsNotification } from '../../infra/notify';
import { isEmailBlacklisted } from '../auth/auth.repo';
import { attachOrderInfoToTickets } from '../orders/order-snapshot.repo';
import {
  appendMemberTicketReply,
  closeMemberTicket,
  createSupportTicketWithFirstMessage,
  deleteUserTotpVaultRecord,
  findMemberOrderForTicket,
  findMemberTicketById,
  insertUserTotpVaultRecord,
  listMemberTickets,
  listTicketMessages,
  listUserTotpVaultRecords,
} from './account.repo';

function cleanBase32(input: string): string {
  const trimmed = String(input || '').trim();
  const uriMatch = trimmed.match(/[?&]secret=([^&#\s]+)/i) || trimmed.match(/^secret=([^&#\s]+)/i);
  const raw = uriMatch ? decodeURIComponent(uriMatch[1]) : trimmed;
  return raw
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
    .slice(0, 512);
}

/** 获取会员工单列表并挂载关联订单快照 */
export async function getMemberTickets(env: Env, user: AuthUser) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const tickets = await listMemberTickets(db, user.id);
  const enriched = await attachOrderInfoToTickets(env, tickets, false);
  return { tickets: enriched };
}

/** 会员提交新售后/咨询工单（严格校验订单归属与质保状态） */
export async function createMemberTicket(
  env: Env,
  user: AuthUser,
  tenant: TenantContext,
  input: CreateTicketInput
) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const subject = input.subject.trim();
  const content = input.content.trim();
  const orderNo = (input.order_no || '').trim();
  const category = input.category || 'after_sale';

  if (category === 'after_sale' && !orderNo) {
    throw Errors.validation('账号售后必须关联订单号，请在右侧下拉选择或填写对应订单号');
  }

  let matchedOrder: Awaited<ReturnType<typeof findMemberOrderForTicket>> | null = null;
  if (orderNo) {
    const currentSiteAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
    matchedOrder = await findMemberOrderForTicket(db, orderNo, user.id, currentSiteAgentId);
    if (!matchedOrder) {
      throw Errors.notFound(`未找到归属您账号的订单 ${orderNo}，请从下拉列表选择有效订单或核对订单号`);
    }
    if (matchedOrder.status === 'refunded' && category === 'after_sale') {
      throw Errors.validation(`订单 ${orderNo} 已完成退款，无法再发起账号售后换新申请`);
    }
  }

  const siteAgentId = matchedOrder?.agentId
    ? Number(matchedOrder.agentId)
    : tenant.isSubAgent && tenant.agentId
      ? tenant.agentId
      : 0;
  const ticketNo = generateBizNo('TK');

  const ticketId = await createSupportTicketWithFirstMessage(db, {
    ticketNo,
    siteAgentId,
    userId: user.id,
    contactEmail: user.email,
    orderNo,
    category,
    subject: subject.slice(0, 120),
    escalatedToAdmin: siteAgentId === 0 ? 1 : 0,
    senderName: user.display_name,
    content: content.slice(0, 3000),
  });

  const warrantyStatus = matchedOrder
    ? evaluateOrderWarranty(
        matchedOrder.warrantyType === 'first_login' ? matchedOrder.deliveredAt : matchedOrder.createdAt,
        {
          warranty_type: matchedOrder.warrantyType || matchedOrder.prodWarrantyType || 'full_period',
          warranty_days: matchedOrder.warrantyDays ?? matchedOrder.prodWarrantyDays ?? 30,
          warranty_summary: matchedOrder.warrantySummary || matchedOrder.prodWarrantySummary || '',
        }
      )
    : null;

  void dispatchOpsNotification(env, 'new_ticket', '新售后工单提醒', [
    `工单号：${ticketNo}`,
    `客户：${user.email}`,
    ...(matchedOrder
      ? [
          `关联订单：${matchedOrder.orderNo}（${matchedOrder.productTitle} · ${matchedOrder.specName}）`,
          `质保判定：${warrantyStatus?.badge_label || '未知'}`,
        ]
      : []),
    `标题：${subject}`,
  ]);

  return { ok: true, id: ticketId, ticket_no: ticketNo, warranty: warrantyStatus };
}

/** 获取单张工单详情及对话消息（严格校验 userId 防水平越权） */
export async function getMemberTicketDetail(env: Env, user: AuthUser, ticketId: number) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const ticket = await findMemberTicketById(db, ticketId, user.id);
  if (!ticket) throw Errors.notFound('工单不存在或无权查看');

  const [enrichedList, messages] = await Promise.all([
    attachOrderInfoToTickets(env, [ticket], true),
    listTicketMessages(db, ticketId),
  ]);
  return { ticket: enrichedList[0], messages };
}

/** 会员回复工单（已关闭工单禁止回复） */
export async function replyMemberTicket(env: Env, user: AuthUser, ticketId: number, input: ReplyTicketInput) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const ticket = await findMemberTicketById(db, ticketId, user.id);
  if (!ticket) throw Errors.notFound('工单不存在');
  if (ticket.status === 'closed') throw Errors.validation('该工单已关闭，如需继续咨询请提交新工单');

  await appendMemberTicketReply(db, ticketId, user.display_name, input.content.trim().slice(0, 3000));
  return { ok: true };
}

/** 会员主动关闭自己的工单 */
export async function closeOwnTicket(env: Env, user: AuthUser, ticketId: number) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  await closeMemberTicket(db, ticketId, user.id);
  return { ok: true };
}

/** 查询云同步加密 2FA 密钥库并解密返回给所属会员 */
export async function listMemberTotpVault(env: Env, user: AuthUser) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const rows = await listUserTotpVaultRecords(db, user.id);
  const items = await Promise.all(
    rows.map(async (r) => ({
      id: String(r.id),
      issuer: r.issuer,
      account_name: r.accountName,
      secret: await decryptSecret(env, r.encryptedSecret),
      digits: r.digits || 6,
      period: r.period || 30,
      created_at: r.createdAt,
    }))
  );
  return { items: items.filter((i) => i.secret.length >= 8) };
}

/** 新增单条加密 2FA 密钥 */
export async function addMemberTotpVaultItem(env: Env, user: AuthUser, input: CreateTotpVaultInput) {
  const secret = cleanBase32(input.secret);
  if (secret.length < 8) throw Errors.validation('请输入有效的 Base32 2FA 密钥（至少 8 位）');

  const issuer = (input.issuer || 'AI 账号').trim().slice(0, 60);
  const accountName = (input.account_name || '').trim().slice(0, 120);
  const digits = input.digits === 8 ? 8 : 6;
  const period = input.period === 60 ? 60 : 30;
  const encryptedSecret = await encryptSecret(env, secret);

  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  const id = await insertUserTotpVaultRecord(db, {
    userId: user.id,
    issuer,
    accountName,
    encryptedSecret,
    digits,
    period,
  });

  return {
    ok: true,
    item: { id: String(id), issuer, account_name: accountName, secret, digits, period },
  };
}

/** 批量导入加密 2FA 密钥（单次最多 50 条） */
export async function batchImportMemberTotpVault(env: Env, user: AuthUser, input: BatchTotpVaultInput) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  let imported = 0;
  for (const raw of input.items.slice(0, 50)) {
    const secret = cleanBase32(raw.secret || '');
    if (secret.length < 8) continue;
    const encryptedSecret = await encryptSecret(env, secret);
    await insertUserTotpVaultRecord(db, {
      userId: user.id,
      issuer: (raw.issuer || '导入账号').trim().slice(0, 60),
      accountName: (raw.account_name || '').trim().slice(0, 120),
      encryptedSecret,
      digits: raw.digits === 8 ? 8 : 6,
      period: raw.period === 60 ? 60 : 30,
    });
    imported++;
  }
  return { ok: true, imported };
}

/** 删除属于当前会员的 2FA 密钥条目 */
export async function deleteMemberTotpVaultItem(env: Env, user: AuthUser, id: number) {
  const db = createDb(env.DB);
  if (await isEmailBlacklisted(db, user.email)) {
    throw Errors.forbidden('该账号已被列入平台黑名单，禁止执行此操作');
  }
  await deleteUserTotpVaultRecord(db, id, user.id);
  return { ok: true };
}
