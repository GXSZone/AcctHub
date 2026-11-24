import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * AcctHub 发布产物打包脚本
 *
 * 将预构建的 Cloudflare Worker SSR 包、客户端静态资源、D1 官方迁移脚本及运维脚本
 * 打包为可分发的 `.tar.gz` 与 `.zip` 归档，并生成 `SHA256SUMS.txt` 校验清单。
 */

const ROOT = process.cwd();

function parseTagArg(argv, pkgVersion) {
  const idx = argv.indexOf('--tag');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1].trim();
  }
  return `v${pkgVersion}`;
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function main() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const tag = parseTagArg(process.argv.slice(2), pkg.version);
  const safeTag = tag.replace(/[^a-zA-Z0-9._-]/g, '-');
  const distDir = join(ROOT, 'dist');

  if (
    !existsSync(join(distDir, 'accthub', 'index.js')) ||
    !existsSync(join(distDir, 'client', 'index.html'))
  ) {
    console.error('❌ 未找到完整构建产物，请先执行 pnpm run build。');
    process.exit(1);
  }

  const releaseRoot = join(ROOT, 'release');
  const bundleName = `accthub-${safeTag}-dist`;
  const stageDir = join(releaseRoot, bundleName);
  const tarGzName = `${bundleName}.tar.gz`;
  const zipName = `${bundleName}.zip`;
  const tarGzPath = join(releaseRoot, tarGzName);
  const zipPath = join(releaseRoot, zipName);

  rmSync(stageDir, { recursive: true, force: true });
  rmSync(tarGzPath, { force: true });
  rmSync(zipPath, { force: true });
  mkdirSync(stageDir, { recursive: true });

  // 复制生产运行、迁移与发布核验所需的最小完备文件集
  const includePaths = [
    'dist',
    'migrations',
    'wrangler.toml',
    'package.json',
    'pnpm-lock.yaml',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'SECURITY.md',
    'scripts/baseline-schema.mjs',
    'scripts/init-prod.mjs',
    'scripts/migrate-db.mjs',
    'scripts/migration-manifest.mjs',
    'scripts/preflight-deploy.mjs',
    'scripts/release-health.mjs',
    'scripts/release-payment-boundary.mjs',
  ];

  for (const relPath of includePaths) {
    const src = join(ROOT, relPath);
    if (!existsSync(src)) {
      console.error(`❌ 缺少必需发布文件：${relPath}`);
      process.exit(1);
    }
    const dst = join(stageDir, relPath);
    mkdirSync(resolve(dst, '..'), { recursive: true });
    cpSync(src, dst, { recursive: true });
  }

  // 生成统一格式 tar.gz 包（Windows 10+ 内置 bsdtar 与 Linux/macOS 均原生支持）
  execFileSync('tar', ['-czf', tarGzPath, '-C', releaseRoot, bundleName], { stdio: 'inherit' });

  // 生成统一格式 zip 包（Windows 使用 PowerShell Compress-Archive，Unix 使用 zip CLI）
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -Path "${stageDir}" -DestinationPath "${zipPath}" -Force`,
      ],
      { stdio: 'inherit' }
    );
  } else {
    execFileSync('zip', ['-rq', zipPath, bundleName], { cwd: releaseRoot, stdio: 'inherit' });
  }

  // 写入标准 SHA-256 校验清单
  const checksumLines = [
    `${sha256File(tarGzPath)}  ${tarGzName}`,
    `${sha256File(zipPath)}  ${zipName}`,
    '',
  ].join('\n');
  writeFileSync(join(releaseRoot, 'SHA256SUMS.txt'), checksumLines, 'utf8');

  // 清理中间暂存目录，仅保留待发布压缩包与校验文件
  rmSync(stageDir, { recursive: true, force: true });

  console.log(`✅ 打包完成 (${tag})：`);
  console.log(`   - release/${tarGzName}`);
  console.log(`   - release/${zipName}`);
  console.log('   - release/SHA256SUMS.txt');
}

main();
