import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';

const cleanup: string[] = [];

function snapshots() {
  const directory = mkdtempSync(join(tmpdir(), 'accthub-ops-rollback-'));
  cleanup.push(directory);
  const before = join(directory, 'before.sqlite');
  const after = join(directory, 'after.sqlite');
  const db = new DatabaseSync(before);
  try {
    db.exec(`CREATE TABLE wallet_transactions (id INTEGER PRIMARY KEY, amount REAL);
      INSERT INTO wallet_transactions VALUES (1, 2.50);`);
  } finally {
    db.close();
  }
  copyFileSync(before, after);
  return { before, after };
}

function compare(before: string, after: string) {
  return spawnSync(process.execPath, ['scripts/operational-rollback.mjs', before, after], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('切换前后数据库导出内容一致时给出相同的 SHA-256', () => {
  const { before, after } = snapshots();
  const result = compare(before, after);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({ status: 'unchanged', beforeSha256: /^[a-f0-9]{64}$/ });
  expect(report.beforeSha256).toBe(report.afterSha256);
});

it('任何台账变动都会使恢复验证失败', () => {
  const { before, after } = snapshots();
  const db = new DatabaseSync(after);
  try {
    db.exec('UPDATE wallet_transactions SET amount = 3.25 WHERE id = 1');
  } finally {
    db.close();
  }
  const result = compare(before, after);
  expect(result.status, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.status).toBe('changed');
  expect(report.beforeSha256).not.toBe(report.afterSha256);
});

it('不能用同一个文件或缺失文件作为切换前后证据', () => {
  const { before, after } = snapshots();
  expect(compare(before, before).status).toBe(2);
  expect(compare(before, join(after, 'missing')).status).toBe(2);
});
