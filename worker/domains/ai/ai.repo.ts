import { like, sql } from 'drizzle-orm';
import { siteSettings } from '../../db/schema/index';
import type { AppDatabase } from '../../infra/db';

/** 读取全部 ai_* 前缀的站点配置键值（100% Drizzle ORM） */
export async function listAiSettingEntriesRepo(db: AppDatabase) {
  return db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(like(siteSettings.key, 'ai_%'));
}

/** 批量幂等写入 AI 引擎配置键值 */
export async function upsertAiSettingEntriesRepo(
  db: AppDatabase,
  entries: Array<[string, string]>
): Promise<void> {
  if (!entries.length) return;
  await db
    .insert(siteSettings)
    .values(entries.map(([key, value]) => ({ key, value })))
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: sql`excluded.value`, updatedAt: sql`datetime('now')` },
    });
}
