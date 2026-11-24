import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASELINE = '0000_accthub_baseline.sql';

function readMigrationFiles(root) {
  const dir = join(root, 'migrations');
  const names = readdirSync(dir)
    .filter((name) => /\.sql$/i.test(name))
    .sort();
  if (names[0] !== BASELINE) throw new Error(`缺少当前迁移基线 ${BASELINE}`);

  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'));
  if (journal.dialect !== 'sqlite' || journal.entries?.length !== names.length) {
    throw new Error('Drizzle 迁移日志与 SQL 文件数量不一致');
  }

  return names.map((name, index) => {
    const prefix = String(index).padStart(4, '0');
    const entry = journal.entries[index];
    if (
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(name) ||
      !name.startsWith(`${prefix}_`) ||
      entry.idx !== index ||
      `${entry.tag}.sql` !== name
    ) {
      throw new Error(`迁移顺序或 Drizzle 迁移日志不匹配：${name}`);
    }
    const sql = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n');
    if (!sql.trim()) throw new Error(`迁移文件为空：${name}`);
    return { name, sha256: createHash('sha256').update(sql).digest('hex'), sql };
  });
}

function manifestEntries(files) {
  return files.map(({ name, sha256 }) => ({ name, sha256 }));
}

export function readVerifiedMigrations(root) {
  const files = readMigrationFiles(root);
  const manifest = JSON.parse(readFileSync(join(root, 'migrations', 'manifest.json'), 'utf8'));
  const expected = manifestEntries(files);
  if (
    manifest.version !== 1 ||
    manifest.migrations?.length !== expected.length ||
    expected.some(({ name, sha256 }, i) => {
      const entry = manifest.migrations[i];
      return entry?.name !== name || entry.sha256 !== sha256;
    })
  ) {
    throw new Error('迁移文件与清单中的顺序或 SHA-256 校验值不一致');
  }
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const migrations = manifestEntries(readMigrationFiles(root));
    writeFileSync(
      join(root, 'migrations', 'manifest.json'),
      `${JSON.stringify({ version: 1, migrations }, null, 2)}\n`
    );
    console.log(`已生成 ${migrations.length} 个迁移文件的 SHA-256 清单。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
