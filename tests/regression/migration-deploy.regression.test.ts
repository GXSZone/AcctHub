import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const baseline = '0000_accthub_baseline.sql';

function script(name: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', name), ...args], {
    encoding: 'utf8',
    timeout: 90_000,
    ...opts,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function wrangler(...args: string[]) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args],
    {
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('部署与初始化', () => {
  it('[S46] 冷启动预览不会输出密码、校验值或其他输入凭据', () => {
    const result = script('init-prod.mjs', ['--env', 'staging', '--yes', '--dry-run'], {
      env: {
        ...process.env,
        ADMIN_EMAIL: 'operator@example.test',
        ADMIN_PASSWORD: 'preview-password-for-tests',
        ADMIN_SECRET: 'preview-secret-for-tests',
      },
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('DRY RUN');
    expect(result.output).not.toContain('operator@example.test');
    expect(result.output).not.toContain('preview-password-for-tests');
    expect(result.output).not.toContain('preview-secret-for-tests');
    expect(result.output).not.toMatch(/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/);
  });

  it('[B56] 部署预检拒绝缺失、意外新增或已修改的迁移文件', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'accthub-preflight-test-'));
    try {
      cpSync(join(root, 'migrations'), join(cwd, 'migrations'), { recursive: true });
      cpSync(join(root, 'wrangler.toml'), join(cwd, 'wrangler.toml'));
      const preflight = () => script('preflight-deploy.mjs', ['--env', 'production', '--dry-run'], { cwd });
      expect(preflight().status).toBe(0);
      const unknown = join(cwd, 'migrations', '0007_unknown.sql');
      writeFileSync(unknown, 'SELECT 1;');
      expect(preflight().status).toBe(1);
      rmSync(unknown);
      const migration = join(cwd, 'migrations', baseline);
      const contents = readFileSync(migration, 'utf8');
      writeFileSync(migration, `${contents}\n-- 被改动\n`);
      expect(preflight().status).toBe(1);
      rmSync(migration);
      expect(preflight().status).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true });
    }
  });

  it('[B25] 空 D1 应用基线后质保字段可用，重复执行保持已建立的库', () => {
    const state = mkdtempSync(join(tmpdir(), 'accthub-baseline-test-'));
    try {
      const migrate = () => script('migrate-db.mjs', ['--local', '--persist-to', state]);
      const query = (sql: string) =>
        wrangler('d1', 'execute', 'DB', '--local', '--persist-to', state, '--json', '--command', sql);
      const applied = migrate();
      expect(applied.status, applied.output).toBe(0);
      const schema =
        query(`SELECT name FROM pragma_table_info('orders') WHERE name LIKE 'warranty_%' ORDER BY name;
        SELECT name FROM pragma_index_list('orders')
          WHERE name IN ('uq_orders_main_checkout_key', 'uq_orders_subsite_checkout_key') AND "unique" = 1
          ORDER BY name;
        SELECT count(*) AS total FROM accthub_schema_migrations`);
      const expectedMigrationCount = (
        JSON.parse(readFileSync(join(process.cwd(), 'migrations', 'manifest.json'), 'utf8')) as {
          migrations: unknown[];
        }
      ).migrations.length;
      const expectedTotalRe = new RegExp(`"total":\\s*${expectedMigrationCount}`);
      expect(schema).toMatch(/warranty_days[\s\S]+warranty_summary[\s\S]+warranty_type/);
      expect(schema).toMatch(/uq_orders_main_checkout_key[\s\S]+uq_orders_subsite_checkout_key/);
      expect(schema).toMatch(expectedTotalRe);
      const repeat = migrate();
      expect(repeat.status, repeat.output).toBe(0);
      query('CREATE INDEX test_schema_drift ON orders (warranty_type)');
      const drift = migrate();
      expect(drift.status).toBe(1);
      expect(drift.output).toContain('结构漂移');
      expect(query('SELECT count(*) AS total FROM accthub_schema_migrations')).toMatch(expectedTotalRe);
    } finally {
      rmSync(state, { recursive: true });
    }
  }, 120_000);

  it('[S38][B25] 拒绝未知库与历史迁移账本，保留原有付款记录', () => {
    const state = mkdtempSync(join(tmpdir(), 'accthub-legacy-test-'));
    try {
      const migrate = () => script('migrate-db.mjs', ['--local', '--persist-to', state]);
      const query = (sql: string) =>
        wrangler('d1', 'execute', 'DB', '--local', '--persist-to', state, '--json', '--command', sql);
      query("CREATE TABLE payment_intents (status TEXT); INSERT INTO payment_intents VALUES ('paid');");
      const unknown = migrate();
      expect(unknown.status).toBe(1);
      expect(unknown.output).toContain('拒绝迁移');
      query(
        "CREATE TABLE d1_migrations (name TEXT); INSERT INTO d1_migrations VALUES ('0005_v4_audit_hardening.sql');"
      );
      const legacy = migrate();
      expect(legacy.status).toBe(1);
      expect(legacy.output).toContain('拒绝迁移');
      const unchanged = query(`SELECT status FROM payment_intents;
        SELECT count(*) AS total FROM sqlite_schema WHERE name='accthub_schema_migrations'`);
      expect(unchanged).toMatch(/"status":\s*"paid"/);
      expect(unchanged).toMatch(/"total":\s*0/);
    } finally {
      rmSync(state, { recursive: true });
    }
  }, 120_000);
});

it('[B56] 远程迁移要求显式指定 staging 或 production', () => {
  const result = script('migrate-db.mjs', ['--remote']);
  expect(result.status).toBe(1);
  expect(result.output).toContain('远端迁移必须显式指定 --env');
});
