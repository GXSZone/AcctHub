import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'test-results', 'dependency-audit');
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error('请用项目固定版本的 pnpm run audit:dependencies 执行审计');

mkdirSync(output, { recursive: true });
for (const scope of ['prod', 'dev']) {
  const result = spawnSync(process.execPath, [pnpm, 'audit', `--${scope}`, '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  const report = join(output, `${scope}.json`);
  writeFileSync(report, result.stdout ?? '');
  if (result.stderr) console.error(result.stderr);
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exitCode = 1;
  console.log(`${scope} 审计退出码 ${result.status ?? '无'}，报告：${report}`);
}
