import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const staged = process.argv.slice(2).includes('--staged');

function run() {
  const tempRoot = realpathSync(tmpdir());
  for (let ancestor = tempRoot; ; ancestor = dirname(ancestor)) {
    const modules = join(ancestor, 'node_modules');
    if (existsSync(modules)) throw new Error(`上层目录存在 node_modules：${modules}`);
    if (dirname(ancestor) === ancestor) break;
  }

  const pnpm = process.env.npm_execpath;
  if (!pnpm) throw new Error('请用项目固定版本的 pnpm run install:verify 执行此门禁');

  const env = { ...process.env };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  if (pathKey) {
    env[pathKey] = env[pathKey]
      .split(delimiter)
      .filter((entry) => {
        if (!isAbsolute(entry)) return false;
        const fromRoot = relative(root, entry);
        return isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`);
      })
      .join(delimiter);
  }
  const isolated = mkdtempSync(join(tempRoot, 'accthub-clean-'));
  try {
    if (staged) {
      const prefix = `${isolated.replaceAll('\\', '/')}/`;
      execFileSync('git', ['checkout-index', '--all', `--prefix=${prefix}`], { cwd: root });
      // 提交钩子可能继承替代暂存区。子进程只读临时副本，不能修改原仓库。
      for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], {
        cwd: root,
        encoding: 'utf8',
      })
        .trim()
        .split(/\s+/))
        delete env[name];
      execFileSync('git', ['init', '--quiet'], { cwd: isolated, env });
    } else {
      const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
      });
      for (const file of new Set(files.split('\0').filter(Boolean))) {
        const source = join(root, file);
        if (!lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;
        const target = join(isolated, file);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
    }
    const { engines, packageManager } = JSON.parse(readFileSync(join(isolated, 'package.json'), 'utf8'));
    if (process.versions.node !== engines.node) {
      throw new Error(`需要 Node ${engines.node}，当前为 ${process.versions.node}`);
    }
    const pnpmVersion = execFileSync(process.execPath, [pnpm, '--version'], {
      cwd: isolated,
      env,
      encoding: 'utf8',
    }).trim();
    if (`pnpm@${pnpmVersion}` !== packageManager) {
      throw new Error(`需要 ${packageManager}，当前为 pnpm@${pnpmVersion}`);
    }
    console.log(`独立目录：${isolated}`);
    console.log(`工具版本：Node ${process.versions.node} / pnpm ${pnpmVersion}`);
    const options = { cwd: isolated, env, stdio: 'inherit' };
    execFileSync(process.execPath, [pnpm, 'install', '--frozen-lockfile'], options);
    execFileSync(process.execPath, [pnpm, 'run', 'typecheck'], options);
    if (staged) {
      for (const script of ['lint', 'arch:check', 'test', 'build']) {
        execFileSync(process.execPath, [pnpm, 'run', script], options);
      }
      execFileSync(process.execPath, ['scripts/baseline-schema.mjs'], options);
      execFileSync(
        process.execPath,
        [pnpm, 'exec', 'vitest', 'run', '--config', 'vitest.d1.config.ts'],
        options
      );
      execFileSync(process.execPath, [pnpm, 'run', 'test:e2e'], options);
      console.log('暂存区的提交门禁通过');
    }
    console.log('独立冻结安装及类型检查通过');
  } finally {
    rmSync(isolated, { recursive: true, force: true, maxRetries: 4 });
  }
}

try {
  run();
} catch (error) {
  console.error(`独立安装门禁失败：${error.message}`);
  process.exitCode = 1;
}
