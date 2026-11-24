import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { readVerifiedMigrations } from './migration-manifest.mjs';

const ledger = 'accthub_schema_migrations';
const createLedgerSql = `CREATE TABLE ${ledger} (
  name TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
const applicationObjects = "name NOT GLOB 'sqlite_*' AND name <> '_cf_KV'";
const schemaQuery = `SELECT name, type, tbl_name, sql FROM sqlite_schema WHERE ${applicationObjects} ORDER BY name, type`;

function verifySchema(liveObjects, appliedMigrations) {
  const expected = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    if (appliedMigrations.length) expected.exec(createLedgerSql);
    for (const { sql } of appliedMigrations) expected.exec(sql);
    const expectedObjects = expected.prepare(schemaQuery).all();
    const objectNames = new Set([...liveObjects, ...expectedObjects].map(({ name }) => name));
    for (const name of objectNames) {
      const actual = liveObjects.find((object) => object.name === name);
      const desired = expectedObjects.find((object) => object.name === name);
      if (
        !actual ||
        !desired ||
        actual.type !== desired.type ||
        actual.tbl_name !== desired.tbl_name ||
        actual.sql?.replace(/\r\n/g, '\n') !== desired.sql?.replace(/\r\n/g, '\n')
      ) {
        throw new Error(`拒绝迁移：检测到数据库结构漂移（${name}）。`);
      }
    }
  } finally {
    expected.close();
  }
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      env: { type: 'string' },
      'persist-to': { type: 'string' },
    },
  });
  if (Boolean(values.local) === Boolean(values.remote) || (values.remote && values['persist-to'])) {
    throw new Error('请选择 --local 或 --remote。仅本地迁移支持 --persist-to。');
  }
  if (values.remote && !values.env) {
    throw new Error('远端迁移必须显式指定 --env staging 或 --env production。');
  }
  if (values.env && !['staging', 'production'].includes(values.env)) {
    throw new Error('支持的远端环境为 staging 和 production');
  }
  const root = process.cwd();
  const files = readVerifiedMigrations(root);
  const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const args = ['d1', 'execute', 'DB', values.local ? '--local' : '--remote'];
  if (values.env) args.push('--env', values.env);
  if (values['persist-to']) args.push('--persist-to', values['persist-to']);

  function runWrangler(extraArgs, json) {
    return execFileSync(process.execPath, [wrangler, ...args, ...extraArgs], {
      encoding: 'utf8',
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      stdio: json ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    });
  }

  function query(...statements) {
    const results = JSON.parse(runWrangler(['--json', '--command', statements.join(';\n')], true));
    if (
      !Array.isArray(results) ||
      results.length !== statements.length ||
      results.some((result) => !result?.success || !Array.isArray(result.results))
    ) {
      throw new Error('D1 检查未返回有效结果');
    }
    return results.map((result) => result.results);
  }

  const ledgerQuery = `SELECT name, sha256 FROM ${ledger} ORDER BY name`;
  const [objects] = query(schemaQuery);
  if (objects.some(({ name }) => name === 'd1_migrations')) {
    throw new Error('拒绝迁移：目标数据库存在旧版 D1 迁移账本，请使用全新空库。');
  }
  const hasLedger = objects.some(({ name, type }) => name === ledger && type === 'table');
  if (!hasLedger && objects.length > 0) {
    throw new Error('拒绝迁移：目标数据库已有对象但缺少 AcctHub 迁移账本，请使用全新空库。');
  }
  const applied = hasLedger ? query(ledgerQuery)[0] : [];
  if (
    (hasLedger && applied.length === 0) ||
    applied.length > files.length ||
    applied.some(({ name, sha256 }, i) => name !== files[i]?.name || sha256 !== files[i]?.sha256)
  ) {
    throw new Error('拒绝迁移：目标数据库账本与当前迁移顺序或校验值不一致。');
  }

  const pending = files.slice(applied.length);
  verifySchema(objects, files.slice(0, applied.length));
  if (pending.length === 0) {
    console.log('D1 迁移已全部应用，账本校验通过。');
    return;
  }
  const tempDir = mkdtempSync(join(tmpdir(), 'accthub-migrate-'));
  try {
    for (const migration of pending) {
      const recordSql = `INSERT INTO ${ledger} (name, sha256) VALUES ('${migration.name}', '${migration.sha256}');`;
      const file = join(tempDir, migration.name);
      // D1 的单文件执行将建表与迁移账本一起应用。
      if (!hasLedger && migration === files[0]) {
        // 与建表处于同一事务，再确认库里没有新出现的对象。
        const freshRecord = `INSERT INTO ${ledger} (name, sha256)
          SELECT '${migration.name}', CASE WHEN EXISTS (
            SELECT 1 FROM sqlite_schema WHERE ${applicationObjects} AND name <> '${ledger}'
          ) THEN '' ELSE '${migration.sha256}' END;`;
        writeFileSync(file, `${createLedgerSql}\n${freshRecord}\n${migration.sql}\n`);
      } else {
        writeFileSync(file, `${migration.sql}\n${recordSql}\n`);
      }
      runWrangler(['--file', file, '--yes'], false);
    }
  } finally {
    rmSync(tempDir, { recursive: true });
  }
  const [confirmed, appliedObjects] = query(ledgerQuery, schemaQuery);
  if (
    confirmed.length !== files.length ||
    confirmed.some(({ name, sha256 }, i) => name !== files[i]?.name || sha256 !== files[i]?.sha256)
  ) {
    throw new Error('应用迁移后账本核对失败。');
  }
  verifySchema(appliedObjects, files);
  console.log(`已应用并核对 ${pending.length} 个 D1 迁移。`);
}

try {
  await main();
} catch (error) {
  console.error(`D1 迁移失败：${error.message}`);
  process.exitCode = 1;
}
