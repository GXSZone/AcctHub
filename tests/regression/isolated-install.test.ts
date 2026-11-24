import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('[E01] 冻结安装门禁拒绝从临时目录上层解析依赖', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'accthub-e01-test-'));
  try {
    const contaminatedModules = join(fixture, 'node_modules');
    const temp = join(fixture, 'temp');
    mkdirSync(contaminatedModules);
    mkdirSync(temp);

    const command = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../scripts/verify-clean-install.mjs', import.meta.url))],
      {
        encoding: 'utf8',
        env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp },
      }
    );

    expect(command.status).toBe(1);
    expect(command.stderr).toContain('上层目录存在 node_modules');
    expect(command.stderr).toContain(contaminatedModules);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
