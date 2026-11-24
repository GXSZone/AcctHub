import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { readVerifiedMigrations } from './migration-manifest.mjs';

const root = process.cwd();
const migrations = join(root, 'migrations');
const baseline = '0000_accthub_baseline.sql';
const snapshot = 'meta/0000_snapshot.json';
const journal = 'meta/_journal.json';
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function main() {
  const { values } = parseArgs({
    options: { 'write-unreleased': { type: 'boolean' }, report: { type: 'string' } },
  });
  const write = values['write-unreleased'];
  if (write && values.report) throw new Error('更新基线时不能生成验收报告');
  const target = mkdtempSync(join(tmpdir(), 'accthub-drizzle-baseline-'));
  try {
    const currentJournal = JSON.parse(read(join(migrations, journal)));
    if (currentJournal.entries.length !== 1 || currentJournal.entries[0].tag !== '0000_accthub_baseline') {
      throw new Error('此命令只处理尚未新增后续迁移的单一基线。');
    }
    execFileSync(process.execPath, [
      join(root, 'node_modules/drizzle-kit/bin.cjs'),
      'generate',
      '--dialect',
      'sqlite',
      '--schema',
      './worker/db/schema/index.ts',
      '--out',
      target,
      '--name',
      'accthub_baseline',
    ]);
    const triggers = read(join(root, 'worker/db/schema/baseline-triggers.sql'));
    const generatedSql = `${read(join(target, baseline)).trimEnd()}--> statement-breakpoint\n${triggers.trimEnd()}\n`;
    const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    try {
      db.exec(generatedSql);
    } finally {
      db.close();
    }

    // 更新尚未发布的基线时，沿用首次生成的日志时间和快照标识。
    const currentSnapshot = JSON.parse(read(join(migrations, snapshot)));
    const generatedSnapshot = JSON.parse(read(join(target, snapshot)));
    generatedSnapshot.id = currentSnapshot.id;
    const generatedJournal = JSON.parse(read(join(target, journal)));
    generatedJournal.entries[0].when = currentJournal.entries[0].when;

    if (write) {
      writeFileSync(join(migrations, baseline), generatedSql);
      writeFileSync(join(migrations, snapshot), JSON.stringify(generatedSnapshot, null, 2));
      writeFileSync(join(migrations, journal), JSON.stringify(generatedJournal, null, 2));
      execFileSync(process.execPath, [join(root, 'scripts/migration-manifest.mjs')], { stdio: 'inherit' });
    } else {
      const files = readVerifiedMigrations(root);
      if (
        read(join(migrations, baseline)) !== generatedSql ||
        JSON.stringify(currentSnapshot) !== JSON.stringify(generatedSnapshot) ||
        JSON.stringify(currentJournal) !== JSON.stringify(generatedJournal)
      ) {
        throw new Error('基线 SQL、快照或日志与当前 Drizzle 表结构和触发器不一致。');
      }
      if (values.report) {
        const report = {
          status: 'passed',
          manifestSha256: createHash('sha256')
            .update(readFileSync(join(migrations, 'manifest.json')))
            .digest('hex'),
          migrations: files.map(({ name, sha256 }) => ({ name, sha256 })),
        };
        writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      }
      console.log('基线 SQL、Drizzle 快照、日志和迁移摘要核对通过。');
    }
  } finally {
    rmSync(target, { recursive: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
