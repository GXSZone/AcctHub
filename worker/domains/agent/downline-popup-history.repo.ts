import { eq, sql } from 'drizzle-orm';
import { siteSettings } from '../../db/schema/core';
import type { AppDatabase } from '../../infra/db';

export interface DownlinePopupHistoryItem {
  id: string;
  version: string;
  enabled: boolean;
  frequency: string;
  title: string;
  content: string;
  sent_at: string;
}

const MAX_HISTORY_ITEMS = 20;
export const MAIN_DOWNLINE_POPUP_HISTORY_KEY = 'downline_popup_history';

export function agentDownlinePopupHistoryKey(agentId: number): string {
  return `downline_popup_history:agent:${agentId}`;
}

export function parseDownlinePopupHistory(raw?: string | null): DownlinePopupHistoryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DownlinePopupHistoryItem =>
        Boolean(item) && typeof item === 'object' && typeof (item as DownlinePopupHistoryItem).id === 'string'
    );
  } catch {
    return [];
  }
}

export async function loadDownlinePopupHistoryJsonRepo(db: AppDatabase, scopeKey: string): Promise<string> {
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, scopeKey))
    .limit(1);
  return row?.value || '[]';
}

async function saveHistoryListRepo(
  db: AppDatabase,
  scopeKey: string,
  items: DownlinePopupHistoryItem[]
): Promise<DownlinePopupHistoryItem[]> {
  const next = items.slice(0, MAX_HISTORY_ITEMS);
  const serialized = JSON.stringify(next);
  await db
    .insert(siteSettings)
    .values({ key: scopeKey, value: serialized })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: serialized, updatedAt: sql`datetime('now')` },
    });
  return next;
}

/** 推送直属下级弹窗时向头部追加去重历史快照（最多保留 20 条） */
export async function appendDownlinePopupHistoryRepo(
  db: AppDatabase,
  scopeKey: string,
  entry: Omit<DownlinePopupHistoryItem, 'id' | 'sent_at'>
): Promise<DownlinePopupHistoryItem[]> {
  const existing = parseDownlinePopupHistory(await loadDownlinePopupHistoryJsonRepo(db, scopeKey));
  if (entry.version && existing.some((item) => item.version === entry.version)) {
    return existing;
  }
  const item: DownlinePopupHistoryItem = {
    id: crypto.randomUUID(),
    version: entry.version,
    enabled: entry.enabled,
    frequency: entry.frequency,
    title: entry.title,
    content: entry.content,
    sent_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
  return saveHistoryListRepo(db, scopeKey, [item, ...existing]);
}

export async function removeDownlinePopupHistoryRepo(
  db: AppDatabase,
  scopeKey: string,
  historyId: string
): Promise<DownlinePopupHistoryItem[]> {
  const existing = parseDownlinePopupHistory(await loadDownlinePopupHistoryJsonRepo(db, scopeKey));
  return saveHistoryListRepo(
    db,
    scopeKey,
    existing.filter((item) => item.id !== historyId)
  );
}
