/**
 * 代理分站工单新消息已读游标存储与未读判定工具
 */

import type { SupportTicketRecord } from '../../types';

const STORAGE_PREFIX = 'accthub.agent.ticket_seen.';

export type TicketSeenMap = Record<string, number>;

export function readAgentTicketSeenMap(agentId: number): TicketSeenMap {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${agentId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as TicketSeenMap) : {};
  } catch {
    return {};
  }
}

export function markAgentTicketSeen(agentId: number, ticketId: number, lastMessageId: number): TicketSeenMap {
  const current = readAgentTicketSeenMap(agentId);
  const key = String(ticketId);
  const nextVal = Math.max(Number(current[key] || 0), Number(lastMessageId || 0));
  const next = { ...current, [key]: nextVal };
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${agentId}`, JSON.stringify(next));
  } catch {
    // 忽略隐私模式下 localStorage 写入失败
  }
  return next;
}

/** 判定工单是否存在需要代理关注的新消息变动（新工单、顾客新回复或总控新回复） */
export function isAgentTicketUnread(ticket: SupportTicketRecord, seenMap: TicketSeenMap): boolean {
  const seenId = Number(seenMap[String(ticket.id)] || 0);
  const lastMsgId = Number(ticket.last_message_id || ticket.message_count || 0);
  const lastRole = ticket.last_sender_role;
  // 若代理自己刚发完最后一条消息，视为已处理无需角标
  if (lastRole === 'agent') return false;
  // 只要最新消息 ID 高于本地已读游标即亮角标（新工单 seenId = 0，自动高亮）
  if (lastMsgId > seenId) return true;
  // 未曾点开过的待跟进工单也保持角标提醒
  if (seenId === 0 && (ticket.status === 'open' || ticket.status === 'escalated')) return true;
  return false;
}
