import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema/index';

export type AppDatabase = DrizzleD1Database<typeof schema> & { $client: D1Database };

/** 创建绑定全量 Schema 的 Drizzle D1 数据库客户端 */
export function createDb(d1: D1Database): AppDatabase {
  return drizzle(d1, { schema });
}
