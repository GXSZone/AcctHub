import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readVerifiedMigrations } from './migration-manifest.mjs';

/**
 * AcctHub Cloudflare Staging / Production 上线前守卫自检脚本
 *
 * 用法：
 *   pnpm run deploy:preflight -- --env staging
 *   pnpm run deploy:preflight -- --env production --dry-run
 *   pnpm run deploy:preflight -- --env production --check-remote-secrets
 */

const ROOT = process.cwd();
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const DEFAULT_WEAK_JWT = 'accthub-edge-hmac-secret-change-in-prod';
const DEFAULT_WEAK_ADMIN = 'accthub-admin';
const REQUIRED_REMOTE_SECRETS = [
  'JWT_SECRET',
  'ADMIN_SECRET',
  'DATA_ENCRYPTION_KEYS',
  'DATA_FINGERPRINT_KEY',
];

function parseArgs(argv) {
  const out = {
    env: 'production',
    dryRun: false,
    checkRemoteSecrets: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env' && argv[i + 1]) {
      out.env = argv[++i].trim().toLowerCase();
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--check-remote-secrets') {
      out.checkRemoteSecrets = true;
    }
  }
  return out;
}

/** 轻量级 TOML 分段解析，提取目标环境段文本 */
function extractTomlSection(tomlContent, headerPattern) {
  const lines = tomlContent.split(/\r?\n/);
  const captured = [];
  let inTarget = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (/^\[/.test(line)) {
      inTarget = headerPattern.test(line);
      continue;
    }
    if (inTarget && line) {
      captured.push(line);
    }
  }
  return captured.join('\n');
}

function readTomlStringValue(sectionText, key) {
  const match = sectionText.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'));
  return match ? match[1].trim() : '';
}

function checkRemoteWranglerSecrets(targetEnv) {
  const raw = execFileSync(
    process.execPath,
    [WRANGLER, 'secret', 'list', '--config', join(ROOT, 'wrangler.toml'), '--env', targetEnv],
    {
      encoding: 'utf8',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const parsed = JSON.parse(raw);
  const names = new Set(Array.isArray(parsed) ? parsed.map((item) => String(item.name || '')) : []);
  return names;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.env !== 'staging' && opts.env !== 'production') {
    console.error(`❌ 不支持的目标环境 "${opts.env}"，请指定 --env staging 或 --env production`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  const passes = [];

  // 1. 校验 migrations/ 迁移目录权威建表文件完整性
  try {
    const migrations = readVerifiedMigrations(ROOT);
    passes.push(`D1 迁移顺序和 SHA-256 校验通过（共 ${migrations.length} 个 SQL 文件）`);
  } catch (err) {
    errors.push(`迁移清单检查失败：${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. 校验 wrangler.toml 目标环境配置、D1 绑定与安全隔离
  const wranglerPath = join(ROOT, 'wrangler.toml');
  if (!existsSync(wranglerPath)) {
    errors.push('缺少根目录 wrangler.toml 配置文件。');
  } else {
    const toml = readFileSync(wranglerPath, 'utf8');
    const varsSection = extractTomlSection(toml, new RegExp(`^\\[env\\.${opts.env}\\.vars\\]$`));
    const d1Section = extractTomlSection(toml, new RegExp(`^\\[\\[env\\.${opts.env}\\.d1_databases\\]\\]$`));

    if (!varsSection) {
      errors.push(`wrangler.toml 缺少 [env.${opts.env}.vars] 配置段。`);
    } else {
      const appEnv = readTomlStringValue(varsSection, 'APP_ENV');
      if (appEnv !== opts.env) {
        errors.push(
          `[env.${opts.env}.vars] 中 APP_ENV 必须为 "${opts.env}"（当前为 "${appEnv || '未设置'}"）。`
        );
      } else {
        passes.push(`APP_ENV = "${appEnv}" 配置正确（S3 非开发强隔离生效）`);
      }

      const sandboxMode = readTomlStringValue(varsSection, 'SANDBOX_MODE').toLowerCase();
      if (sandboxMode === 'true') {
        errors.push(`[env.${opts.env}.vars] 严禁开启 SANDBOX_MODE = "true"，请设为 "false" 或删除该项。`);
      } else {
        passes.push('SANDBOX_MODE 沙盒模式已安全禁用');
      }

      const plainJwt = readTomlStringValue(varsSection, 'JWT_SECRET');
      const plainAdmin = readTomlStringValue(varsSection, 'ADMIN_SECRET');
      if (plainJwt || plainAdmin) {
        errors.push(
          `[env.${opts.env}.vars] 禁止明文写入 JWT_SECRET / ADMIN_SECRET，请改用 wrangler secret put --env ${opts.env}。`
        );
      } else {
        passes.push('wrangler.toml 未明文泄露密钥');
      }
    }

    if (!d1Section) {
      errors.push(`wrangler.toml 缺少 [[env.${opts.env}.d1_databases]] 绑定配置。`);
    } else {
      const dbId = readTomlStringValue(d1Section, 'database_id');
      const dbName = readTomlStringValue(d1Section, 'database_name');
      const isPlaceholder = !dbId || dbId.startsWith('REPLACE_WITH_') || dbId.startsWith('local-');
      if (isPlaceholder) {
        const msg = `[[env.${opts.env}.d1_databases]] (${dbName || 'DB'}) 的 database_id 仍是占位符 "${dbId || '空'}"，请先运行 wrangler d1 create ${dbName || `accthub-db-${opts.env}`} 并回填真实 ID。`;
        if (opts.dryRun) {
          warnings.push(`[dry-run 提示] ${msg}`);
        } else {
          errors.push(msg);
        }
      } else {
        passes.push(`D1 数据库绑定有效（${dbName} -> ${dbId}）`);
      }
    }
  }

  // 3. 若显式传入环境变量中的密钥，检查其强度合规性
  const envJwt = (process.env.JWT_SECRET || '').trim();
  if (envJwt && (envJwt === DEFAULT_WEAK_JWT || envJwt.length < 24)) {
    errors.push('环境变量 JWT_SECRET 不能使用默认值且长度必须 ≥ 24 个字符。');
  }
  const envAdmin = (process.env.ADMIN_SECRET || '').trim();
  if (envAdmin && envAdmin === DEFAULT_WEAK_ADMIN) {
    errors.push('环境变量 ADMIN_SECRET 禁止使用默认弱口令 "accthub-admin"。');
  }

  // 4. 远端 Wrangler Secrets 检测（显式指定 --check-remote-secrets，或非 dry-run 且持有 CF API Token 时执行）
  const hasCfToken = Boolean((process.env.CLOUDFLARE_API_TOKEN || '').trim());
  if (!opts.dryRun && (opts.checkRemoteSecrets || hasCfToken)) {
    try {
      const secretNames = checkRemoteWranglerSecrets(opts.env);
      const missing = REQUIRED_REMOTE_SECRETS.filter((key) => !secretNames.has(key));
      if (missing.length > 0) {
        errors.push(
          `远端环境 ${opts.env} 缺少必需 Secret：${missing.join(', ')}。请执行：\n` +
            missing.map((k) => `    pnpm exec wrangler secret put ${k} --env ${opts.env}`).join('\n')
        );
      } else {
        passes.push(`远端 ${opts.env} 已绑定必需的认证与数据加密密钥`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.checkRemoteSecrets) {
        errors.push(`查询远端 Wrangler Secrets 失败（请确认已登录或配置 CLOUDFLARE_API_TOKEN）：${msg}`);
      } else {
        warnings.push(`跳过远端 Secret 在线核查（未检测到有效 Wrangler 登录或权限）：${msg.split('\n')[0]}`);
      }
    }
  } else if (!opts.dryRun) {
    warnings.push(
      `请确认已在 Cloudflare 为 ${opts.env} 绑定 JWT_SECRET（>=24位）与 ADMIN_SECRET（非 accthub-admin）：\n` +
        `    pnpm exec wrangler secret put JWT_SECRET --env ${opts.env}\n` +
        `    pnpm exec wrangler secret put ADMIN_SECRET --env ${opts.env}`
    );
  }

  console.log(`\n🔍 AcctHub 部署前守卫预检（目标环境：${opts.env}${opts.dryRun ? ' | dry-run' : ''}）`);
  for (const ok of passes) console.log(`  ✅ ${ok}`);
  for (const warn of warnings) console.warn(`  ⚠️  ${warn}`);

  if (errors.length > 0) {
    console.error(`\n❌ 预检拦截到 ${errors.length} 项阻塞问题：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`\n🚀 [${opts.env}] 上线前配置预检通过。\n`);
}

main();
