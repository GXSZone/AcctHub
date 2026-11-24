import type {
  AgentAnnouncementInput,
  AgentAnnouncementUpdateInput,
  AgentTicketEscalateInput,
  AgentTicketReplyInput,
} from '@shared/index';
import type { Env } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import {
  getSiteMailConfigSafe,
  listSiteMailLogs,
  saveSiteMailConfig,
  sendTestDeliveryEmail,
} from '../../infra/mail';
import { resendQueuedOrderEmail } from '../../infra/mail.outbox';
import { dispatchOpsNotification } from '../../infra/notify';
import { listTicketMessages } from '../account/account.repo';
import { attachOrderInfoToTickets } from '../orders/order-snapshot.repo';
import type { ActiveAgentContext } from './agent.guard';
import {
  createAgentAnnouncementRepo,
  deleteAgentAnnouncementRepo,
  escalateAgentTicketRepo,
  findAgentOrderWithProductWarranty,
  findAgentTicketByIdRepo,
  listAgentTicketsRepo,
  loadAgentNoticeSettingsData,
  replyAgentTicketRepo,
  updateAgentAnnouncementRepo,
} from './agent.ops.repo';
import { updateAgentBrandRecord } from './agent.repo';
import {
  agentDownlinePopupHistoryKey,
  appendDownlinePopupHistoryRepo,
  loadDownlinePopupHistoryJsonRepo,
  removeDownlinePopupHistoryRepo,
} from './downline-popup-history.repo';

/** 获取分站独立公告中心与直属上级下发的渠道通知 */
export async function getAgentNoticesCenter(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const parentAgentId = ctx.agent.parent_agent_id ? Number(ctx.agent.parent_agent_id) : 0;
  const [data, historyJson] = await Promise.all([
    loadAgentNoticeSettingsData(db, ctx.agent.id, parentAgentId),
    loadDownlinePopupHistoryJsonRepo(db, agentDownlinePopupHistoryKey(ctx.agent.id)),
  ]);

  let upstreamPopup = {
    enabled: false,
    title: '',
    content: '',
    frequency: 'once_per_day',
    version: '1',
    source_name: '主站官方',
  };

  if (parentAgentId === 0) {
    const map = data.upstreamSettingsMap;
    upstreamPopup = {
      enabled: map.downline_popup_enabled === 'true',
      title: map.downline_popup_title || '官方渠道专属通知',
      content: map.downline_popup_content || '',
      frequency: map.downline_popup_frequency || 'once_per_day',
      version: `main_dl_${map.downline_popup_version || '1'}`,
      source_name: map.brand_name ? `${map.brand_name} 官方` : '主站官方',
    };
  } else if (data.parentAgentPopupRow) {
    const p = data.parentAgentPopupRow;
    upstreamPopup = {
      enabled: Boolean(p.downlinePopupEnabled),
      title: p.downlinePopupTitle || '上级渠道专属通知',
      content: p.downlinePopupContent || '',
      frequency: p.downlinePopupFrequency || 'once_per_day',
      version: `agent_${parentAgentId}_dl_${p.downlinePopupVersion || '1'}`,
      source_name: p.brandName || '直属上级',
    };
  }

  return {
    settings: {
      announcement_banner: String(ctx.agent.announcement_banner || ''),
      ticker_enabled: ctx.agent.ticker_enabled === 0 ? 'false' : 'true',
      ticker_mode: String(ctx.agent.ticker_mode || 'vertical'),
      ticker_include_notices: ctx.agent.ticker_include_notices === 0 ? 'false' : 'true',
      popup_enabled: ctx.agent.popup_enabled ? 'true' : 'false',
      popup_title: String(ctx.agent.popup_title || ''),
      popup_content: String(ctx.agent.popup_content || ''),
      popup_frequency: String(ctx.agent.popup_frequency || 'once_per_day'),
      popup_version: String(ctx.agent.popup_version || '1'),
      downline_popup_enabled: ctx.agent.downline_popup_enabled ? 'true' : 'false',
      downline_popup_title: String(ctx.agent.downline_popup_title || ''),
      downline_popup_content: String(ctx.agent.downline_popup_content || ''),
      downline_popup_frequency: String(ctx.agent.downline_popup_frequency || 'once_per_day'),
      downline_popup_version: String(ctx.agent.downline_popup_version || '1'),
      downline_popup_history: historyJson,
    },
    announcements: data.myAnnouncements,
    upstream_notices: data.upstreamNotices,
    upstream_popup: upstreamPopup,
  };
}

/** 更新分站公告轮播条、首页欢迎弹窗与下级渠道弹窗配置 */
export async function updateAgentNoticeSettings(
  env: Env,
  ctx: ActiveAgentContext,
  b: Record<string, string>
) {
  const db = createDb(env.DB);
  const patch: Record<string, unknown> = {};
  if (b.announcement_banner !== undefined) patch.announcementBanner = b.announcement_banner;
  if (b.ticker_enabled !== undefined) patch.tickerEnabled = b.ticker_enabled === 'false' ? 0 : 1;
  if (b.ticker_mode !== undefined) patch.tickerMode = b.ticker_mode === 'marquee' ? 'marquee' : 'vertical';
  if (b.ticker_include_notices !== undefined) {
    patch.tickerIncludeNotices = b.ticker_include_notices === 'false' ? 0 : 1;
  }
  if (b.popup_enabled !== undefined) patch.popupEnabled = b.popup_enabled === 'true' ? 1 : 0;
  if (b.popup_title !== undefined) patch.popupTitle = b.popup_title.trim().slice(0, 120);
  if (b.popup_content !== undefined) patch.popupContent = b.popup_content;
  if (b.popup_frequency !== undefined) patch.popupFrequency = b.popup_frequency;
  if (b.popup_version !== undefined) patch.popupVersion = b.popup_version;
  if (b.downline_popup_enabled !== undefined) {
    patch.downlinePopupEnabled = b.downline_popup_enabled === 'true' ? 1 : 0;
  }
  if (b.downline_popup_title !== undefined)
    patch.downlinePopupTitle = b.downline_popup_title.trim().slice(0, 120);
  if (b.downline_popup_content !== undefined) patch.downlinePopupContent = b.downline_popup_content;
  if (b.downline_popup_frequency !== undefined) patch.downlinePopupFrequency = b.downline_popup_frequency;
  if (b.downline_popup_version !== undefined) patch.downlinePopupVersion = b.downline_popup_version;

  if (Object.keys(patch).length > 0) {
    await updateAgentBrandRecord(db, ctx.agent.id, patch);
  }
  if (
    b.downline_popup_version &&
    b.downline_popup_version !== String(ctx.agent.downline_popup_version || '1') &&
    (b.downline_popup_enabled === 'true' || b.downline_popup_title || b.downline_popup_content)
  ) {
    await appendDownlinePopupHistoryRepo(db, agentDownlinePopupHistoryKey(ctx.agent.id), {
      version: String(b.downline_popup_version),
      enabled: b.downline_popup_enabled === 'true',
      frequency: String(b.downline_popup_frequency || 'once_per_day'),
      title: String(b.downline_popup_title || '').trim(),
      content: String(b.downline_popup_content || ''),
    });
  }
  return { ok: true };
}

export async function deleteAgentDownlinePopupHistory(env: Env, ctx: ActiveAgentContext, historyId: string) {
  const db = createDb(env.DB);
  const items = await removeDownlinePopupHistoryRepo(
    db,
    agentDownlinePopupHistoryKey(ctx.agent.id),
    historyId
  );
  return { ok: true, items };
}

export async function createAgentAnnouncement(
  env: Env,
  ctx: ActiveAgentContext,
  body: AgentAnnouncementInput
) {
  const db = createDb(env.DB);
  const id = await createAgentAnnouncementRepo(db, {
    ownerAgentId: ctx.agent.id,
    audience: body.audience,
    title: body.title.trim(),
    content: body.content.trim(),
    level: body.level || 'info',
    isPinned: body.is_pinned ? 1 : 0,
  });
  return { id, ok: true };
}

export async function updateAgentAnnouncement(
  env: Env,
  ctx: ActiveAgentContext,
  id: number,
  body: AgentAnnouncementUpdateInput
) {
  const db = createDb(env.DB);
  const patch: Record<string, unknown> = {};
  if (body.audience !== undefined) patch.audience = body.audience;
  if (body.title !== undefined) {
    patch.title = body.title;
    patch.titleEn = body.title;
  }
  if (body.content !== undefined) {
    patch.content = body.content;
    patch.contentEn = body.content;
  }
  if (body.level !== undefined) patch.level = body.level;
  if (body.is_pinned !== undefined) patch.isPinned = body.is_pinned ? 1 : 0;

  await updateAgentAnnouncementRepo(db, id, ctx.agent.id, patch);
  return { ok: true };
}

export async function deleteAgentAnnouncement(env: Env, ctx: ActiveAgentContext, id: number) {
  const db = createDb(env.DB);
  await deleteAgentAnnouncementRepo(db, id, ctx.agent.id);
  return { ok: true };
}

export async function getAgentMailConfig(env: Env, ctx: ActiveAgentContext) {
  const [config, logs] = await Promise.all([
    getSiteMailConfigSafe(env, ctx.agent.id),
    listSiteMailLogs(env, ctx.agent.id, 25),
  ]);
  return { config, logs };
}

export async function saveAgentMailConfig(env: Env, ctx: ActiveAgentContext, body: Record<string, unknown>) {
  try {
    const config = await saveSiteMailConfig(env, ctx.agent.id, {
      enabled: body.enabled !== undefined ? Boolean(body.enabled) : undefined,
      auto_send_order: body.auto_send_order !== undefined ? Boolean(body.auto_send_order) : undefined,
      auto_send_restock: body.auto_send_restock !== undefined ? Boolean(body.auto_send_restock) : undefined,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      from_name: typeof body.from_name === 'string' ? body.from_name : undefined,
      from_email: typeof body.from_email === 'string' ? body.from_email : undefined,
      reply_to: typeof body.reply_to === 'string' ? body.reply_to : undefined,
      api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
      clear_api_key: Boolean(body.clear_api_key),
      api_endpoint: typeof body.api_endpoint === 'string' ? body.api_endpoint : undefined,
      mailgun_domain: typeof body.mailgun_domain === 'string' ? body.mailgun_domain : undefined,
      footer_note: typeof body.footer_note === 'string' ? body.footer_note : undefined,
    });
    return { ok: true, config };
  } catch (err) {
    throw Errors.validation(err instanceof Error ? err.message : '保存分站发卡邮箱配置失败');
  }
}

export async function sendAgentTestMail(env: Env, ctx: ActiveAgentContext, toEmail: string) {
  const res = await sendTestDeliveryEmail(env, ctx.agent.id, toEmail, ctx.agent.brand_name || '合作商城');
  if (!res.ok) throw Errors.validation(`测试发信失败：${res.error || '未知错误'}`);
  return { ok: true, provider: res.provider };
}

export async function resendAgentOrderEmail(
  env: Env,
  ctx: ActiveAgentContext,
  orderNo: string,
  _originUrl?: string
) {
  const db = createDb(env.DB);
  const found = await findAgentOrderWithProductWarranty(db, orderNo, ctx.agent.id);
  if (!found) throw Errors.notFound('订单不存在或非本店成交订单');

  const order = found.order;
  if (order.status !== 'delivered' || !order.deliveredPayload) {
    throw Errors.conflict('订单尚无可补发的交付凭证');
  }
  if (!order.publicOrderNo) {
    throw Errors.conflict('该历史订单没有公开查单号，请通过原订单账号查询');
  }
  const result = await resendQueuedOrderEmail(env, order.id, ctx.agent.id, order.publicOrderNo);
  return { ok: true, to: order.contactEmail, mail_status: result.mail_status };
}

export async function listAgentTickets(env: Env, ctx: ActiveAgentContext) {
  const db = createDb(env.DB);
  const rows = await listAgentTicketsRepo(db, ctx.agent.id);
  const enriched = await attachOrderInfoToTickets(env, rows, false);
  return { tickets: enriched };
}

export async function getAgentTicketDetail(env: Env, ctx: ActiveAgentContext, ticketId: number) {
  const db = createDb(env.DB);
  const ticket = await findAgentTicketByIdRepo(db, ticketId, ctx.agent.id);
  if (!ticket) throw Errors.notFound('工单不存在或非本店工单');
  const [enrichedList, messages] = await Promise.all([
    attachOrderInfoToTickets(env, [ticket], true),
    listTicketMessages(db, ticketId),
  ]);
  return { ticket: enrichedList[0], messages };
}

export async function replyAgentTicket(
  env: Env,
  ctx: ActiveAgentContext,
  ticketId: number,
  body: AgentTicketReplyInput
) {
  const db = createDb(env.DB);
  const ticket = await findAgentTicketByIdRepo(db, ticketId, ctx.agent.id);
  if (!ticket) throw Errors.notFound('工单不存在或非本店工单');
  if (ticket.status === 'closed') throw Errors.validation('该工单已关闭，无法继续回复');

  const nextStatus = body.mark_resolved ? 'resolved' : 'agent_replied';
  await replyAgentTicketRepo(
    db,
    ticketId,
    `${ctx.agent.brand_name} 站长`,
    body.content.trim().slice(0, 3000),
    nextStatus
  );
  return { ok: true, status: nextStatus };
}

export async function escalateAgentTicket(
  env: Env,
  ctx: ActiveAgentContext,
  ticketId: number,
  body: AgentTicketEscalateInput
) {
  const db = createDb(env.DB);
  const ticket = await findAgentTicketByIdRepo(db, ticketId, ctx.agent.id);
  if (!ticket) throw Errors.notFound('工单不存在或非本店工单');
  if (ticket.status === 'closed') throw Errors.validation('该工单已关闭，无法升级转交');

  const note = (body.note || '').trim() || '涉及卡密核验或退款回库，分站长已一键转交平台总控介入处理。';
  await escalateAgentTicketRepo(db, ticketId, note.slice(0, 500));

  void dispatchOpsNotification(env, 'new_ticket', '分站工单升级转交总控', [
    `工单号：${ticket.ticket_no}`,
    `来源分站：${ctx.agent.brand_name} (@${ctx.agent.slug})`,
    ...(ticket.order_no ? [`关联订单：${ticket.order_no}`] : []),
    `标题：${ticket.subject}`,
    `转交说明：${note}`,
  ]);

  return { ok: true, status: 'escalated' };
}
