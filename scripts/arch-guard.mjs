import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * AcctHub 自动化架构守卫脚本（v3.0 零豁免硬门禁）
 *
 * 强制校验红线（以下 6 项硬门禁违规即阻断 CI / 提交，文件行数仅作软性评估参考）：
 * 1. 模块体积评估：> 600 行时发出软提醒，由开发者权衡高内聚与拆分的收益代价（不做硬拦截）
 * 2. 零裸 SQL 红线：全仓严禁出现 DB.prepare(，100% 使用 Drizzle ORM
 * 3. 后端分层纯净度：worker/domains/<domain>/*.routes.ts 禁直连 DB / 禁导入已废弃的 worker/lib/
 * 4. 前端分层纯净度：src/features/ 禁裸 fetch( 与导入已废弃的 src/lib/api
 * 5. 共享层纯净度：shared/ 禁导入 React / Hono 运行时依赖
 * 6. 5 语种语言包键对称检查：locales 与所有按域懒加载 namespaces/<ns> 的 5 语种文件键必须 100% 对齐
 * 7. 前端业务代码零硬编码中文红线：src/（除 src/i18n/ 与测试）严禁非注释 UI 中文字符
 */

const ROOT = process.cwd();
const SOFT_WARN_LINES = 600;

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function collectSourceFiles(dirs) {
  const results = [];
  for (const dir of dirs) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === 'node_modules' || entry === 'dist' || entry === '.wrangler') continue;
          stack.push(full);
        } else if (
          (full.endsWith('.ts') || full.endsWith('.tsx')) &&
          !full.endsWith('.test.ts') &&
          !full.endsWith('.test.tsx') &&
          !full.endsWith('.spec.ts') &&
          !full.endsWith('.spec.tsx') &&
          !full.endsWith('.d.ts')
        ) {
          results.push(full);
        }
      }
    }
  }
  return results.sort();
}

function extractLocaleKeys(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const matches = text.matchAll(/^\s*([a-zA-Z0-9_]+)\s*:/gm);
  return [...matches].map((m) => m[1]).sort();
}

function scanRepo() {
  const files = collectSourceFiles(['shared', 'src', 'worker']);
  const violations = [];
  const warnings = [];

  for (const fullPath of files) {
    const rel = toPosix(relative(ROOT, fullPath));
    const content = readFileSync(fullPath, 'utf8');
    const lineCount = content.split(/\r?\n/).length;

    // 1. 模块体积软评估（仅提示参考，不做机械硬拦截，需结合高内聚与拆分收益评估）
    if (lineCount > SOFT_WARN_LINES) {
      warnings.push(
        `[模块粒度评估] ${rel}: ${lineCount} 行（>${SOFT_WARN_LINES} 行，若核心逻辑高内聚可保持；否则可评估拆分）`
      );
    }

    // 2. 全仓零裸 SQL 红线
    const prepareMatches = content.match(/\bDB\.prepare\s*\(/g);
    if (prepareMatches && prepareMatches.length > 0) {
      violations.push(
        `[裸 SQL 违规] ${rel}: 检出 ${prepareMatches.length} 处 DB.prepare(，请改用 Drizzle ORM`
      );
    }

    // 3. 后端垂直领域路由层硬红线
    if (/^worker\/domains\/[^/]+\/[^/]+\.routes\.ts$/.test(rel)) {
      if (
        /from\s+['"][^'"]*worker\/infra\/db|from\s+['"][^'"]*\/infra\/db['"]|from\s+['"][^'"]*\/db\/client['"]/.test(
          content
        )
      ) {
        violations.push(`[后端分层违规] ${rel}: 路由层禁止直接操作数据库客户端，请通过 Service/Repo 调用`);
      }
      if (/from\s+['"][^'"]*\/lib\//.test(content)) {
        violations.push(`[后端分层违规] ${rel}: 新垂直领域路由禁止依赖已废弃的 worker/lib/`);
      }
    }

    // 4. 前端垂直功能模块硬红线
    if (rel.startsWith('src/features/')) {
      if (/\bfetch\s*\(/.test(content)) {
        violations.push(
          `[前端分层违规] ${rel}: src/features/ 禁止直接调用 fetch()，请经由 src/api/ 与 src/queries/`
        );
      }
      if (/from\s+['"][^'"]*\/lib\/api['"]/.test(content)) {
        violations.push(`[前端分层违规] ${rel}: src/features/ 禁止引用已废弃的巨石文件 src/lib/api.ts`);
      }
    }

    // 5. shared/ 纯净度硬红线
    if (rel.startsWith('shared/')) {
      if (/from\s+['"]react['"]|from\s+['"]hono['"]/.test(content)) {
        violations.push(`[共享层违规] ${rel}: shared/ 禁止导入 React 或 Hono 运行时依赖`);
      }
    }

    // 7. 前端业务代码零硬编码 UI 中文红线（src/i18n/ 词典目录除外）
    if (rel.startsWith('src/') && !rel.startsWith('src/i18n/')) {
      const stripped = content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\/.*$/gm, '');
      const zhMatches = stripped.match(/[\u4e00-\u9fa5]+/g);
      if (zhMatches && zhMatches.length > 0) {
        violations.push(
          `[前端硬编码中文违规] ${rel}: 检出 ${zhMatches.length} 处未收口中文（示例：${zhMatches[0]}），请迁入 src/i18n/namespaces/`
        );
      }
    }
  }

  // 6. 5 语种语言包键对称检查（覆盖主目录 locales 及所有按域懒加载 namespaces/<ns>）
  const checkLocaleDir = (dirPath, label) => {
    if (!existsSync(dirPath)) return;
    const locales = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
    const baseFile = join(dirPath, 'zh-CN.ts');
    if (!existsSync(baseFile)) {
      violations.push(`[国际化缺失] 缺少基准语言包 ${label}/zh-CN.ts`);
      return;
    }
    const baseKeys = extractLocaleKeys(baseFile);
    for (const loc of locales.slice(1)) {
      const target = join(dirPath, `${loc}.ts`);
      if (!existsSync(target)) {
        violations.push(`[国际化缺失] 缺少语言包文件 ${label}/${loc}.ts`);
        continue;
      }
      const keys = extractLocaleKeys(target);
      if (JSON.stringify(keys) !== JSON.stringify(baseKeys)) {
        violations.push(`[国际化键不对称] ${label}/${loc}.ts 与 zh-CN.ts 词条键不一致`);
      }
    }
  };

  checkLocaleDir(join(ROOT, 'src', 'i18n', 'locales'), 'src/i18n/locales');
  const namespacesRoot = join(ROOT, 'src', 'i18n', 'namespaces');
  if (existsSync(namespacesRoot)) {
    for (const ns of readdirSync(namespacesRoot)) {
      const nsDir = join(namespacesRoot, ns);
      if (statSync(nsDir).isDirectory()) {
        checkLocaleDir(nsDir, `src/i18n/namespaces/${ns}`);
      }
    }
  }

  return {
    totalFilesScanned: files.length,
    violations,
    warnings,
  };
}

const report = scanRepo();

if (report.warnings.length > 0) {
  console.warn(`⚠️  架构软提示（共 ${report.warnings.length} 项，不阻断）：`);
  for (const w of report.warnings) {
    console.warn(`  - ${w}`);
  }
}

if (report.violations.length > 0) {
  console.error(`❌ AcctHub 零豁免架构守卫拦截到 ${report.violations.length} 项违规：`);
  for (const v of report.violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
}

console.log(
  `✅ AcctHub 架构守卫通过（扫描 ${report.totalFilesScanned} 个文件 | 体积软提示 ${report.warnings.length} | 裸 SQL 0 | 硬红线违规 0）`
);
