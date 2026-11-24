import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/**
 * 将 SQLite 原始值转换为 node:sqlite 可绑定的参数类型
 */
function toSqlValue(val: unknown): SQLInputValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') return val;
  if (val instanceof Uint8Array) return val;
  return JSON.stringify(val);
}

/**
 * 将 Drizzle / D1 迁移脚本拆分为独立可执行 SQL 语句
 */
function splitMigrationSql(sqlText: string): string[] {
  const cleaned = sqlText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return cleaned
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 基于 Node 原生 node:sqlite 内存数据库实现的 Cloudflare D1Database 兼容测试适配器，
 * 100% 兼容 Drizzle ORM (drizzle-orm/d1) 与现有 D1 API，毫秒级执行真实 SQL 与迁移。
 */
export function createTestD1Database(options?: { applyMigrations?: boolean }): {
  d1: D1Database;
  rawDb: DatabaseSync;
  close: () => void;
} {
  const rawDb = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });

  if (options?.applyMigrations !== false) {
    const migrationsDir = join(process.cwd(), 'migrations');
    const sqlFiles = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of sqlFiles) {
      const sqlText = readFileSync(join(migrationsDir, file), 'utf8');
      rawDb.exec(sqlText);
    }
  }

  function makeStatement(query: string, boundParams: SQLInputValue[] = []): D1PreparedStatement {
    const stmtApi = {
      bind(...values: unknown[]): D1PreparedStatement {
        return makeStatement(query, values.map(toSqlValue));
      },

      async first<T = unknown>(colName?: string): Promise<T | null> {
        const prepared = rawDb.prepare(query);
        const row = prepared.get(...boundParams) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName !== undefined) {
          return (colName in row ? row[colName] : null) as T | null;
        }
        return { ...row } as T;
      },

      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const prepared = rawDb.prepare(query);
        const isReader = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(query) || /\bRETURNING\b/i.test(query);
        if (isReader) {
          const rows = prepared.all(...boundParams).map((r) => ({ ...(r as Record<string, unknown>) }));
          return {
            results: rows as T[],
            success: true,
            meta: {
              duration: 0,
              size_after: 0,
              rows_read: rows.length,
              rows_written: 0,
              last_row_id: 0,
              changed_db: false,
              changes: 0,
            },
          };
        }
        const info = prepared.run(...boundParams);
        return {
          results: [] as T[],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            changed_db: Number(info.changes) > 0,
            changes: Number(info.changes),
          },
        };
      },

      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const prepared = rawDb.prepare(query);
        const isReader = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(query) || /\bRETURNING\b/i.test(query);
        if (isReader) {
          const rows = prepared.all(...boundParams).map((r) => ({ ...(r as Record<string, unknown>) }));
          return {
            results: rows as T[],
            success: true,
            meta: {
              duration: 0,
              size_after: 0,
              rows_read: rows.length,
              rows_written: 0,
              last_row_id: 0,
              changed_db: false,
              changes: 0,
            },
          };
        }
        const info = prepared.run(...boundParams);
        return {
          results: [] as T[],
          success: true,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            changed_db: Number(info.changes) > 0,
            changes: Number(info.changes),
          },
        };
      },

      async raw<T = unknown[]>(opts?: { columnNames?: boolean }): Promise<T[]> {
        const prepared = rawDb.prepare(query) as ReturnType<DatabaseSync['prepare']> & {
          setReturnArrays?: (enabled: boolean) => void;
          columns?: () => Array<{ name: string }>;
        };
        if (typeof prepared.setReturnArrays === 'function') {
          prepared.setReturnArrays(true);
          // Node 24 启用 setReturnArrays(true) 后 prepared.all 运行时返回二维数组而非对象
          const matrix = prepared.all(...boundParams) as unknown as unknown[][];
          if (opts?.columnNames) {
            const cols = typeof prepared.columns === 'function' ? prepared.columns().map((c) => c.name) : [];
            return [cols, ...matrix] as unknown as T[];
          }
          return matrix as unknown as T[];
        }
        const rows = prepared.all(...boundParams) as Array<Record<string, unknown>>;
        if (rows.length === 0) return [];
        const cols = Object.keys(rows[0]);
        const matrix = rows.map((row) => cols.map((col) => row[col]));
        if (opts?.columnNames) {
          return [cols, ...matrix] as unknown as T[];
        }
        return matrix as unknown as T[];
      },
    };

    return stmtApi as unknown as D1PreparedStatement;
  }

  // 保持同一 D1 连接上并行提交的批处理各自拥有独立事务。
  let lastBatch: Promise<unknown> = Promise.resolve();
  const d1 = {
    prepare(query: string): D1PreparedStatement {
      return makeStatement(query, []);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const execution = lastBatch.then(async () => {
        rawDb.exec('BEGIN IMMEDIATE;');
        try {
          const out = await Promise.all(statements.map((stmt) => stmt.all<T>()));
          rawDb.exec('COMMIT;');
          return out;
        } catch (err) {
          rawDb.exec('ROLLBACK;');
          throw err;
        }
      });
      lastBatch = execution.catch(() => undefined);
      return execution;
    },
    async exec(query: string): Promise<D1ExecResult> {
      const parts = splitMigrationSql(query);
      for (const stmt of parts) {
        rawDb.exec(stmt);
      }
      return { count: parts.length, duration: 0 };
    },
    withSession() {
      return d1;
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;

  return {
    d1,
    rawDb,
    close: () => rawDb.close(),
  };
}
