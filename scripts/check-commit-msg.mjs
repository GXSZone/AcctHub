import { readFileSync } from 'node:fs';

/**
 * Git 提交信息规范校验脚本
 *
 * 强制约束：
 * 1. 首行符合 Conventional Commits：type(scope)?: 描述
 * 2. 禁止 UTF-8 BOM 字符与无意义短语
 * 3. 描述内容必须包含简体中文字符，且标题长度不超过 80 个字符
 */

const ALLOWED_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

const HEADER_PATTERN = new RegExp(
  `^(${ALLOWED_TYPES.join('|')})(?:\\(([a-z0-9][a-z0-9._/-]*)\\))?:\\s+(.+)$`
);

/** 校验单条提交信息是否满足项目中文工程规范 */
export function validateCommitMessage(rawMessage) {
  const errors = [];
  if (!rawMessage?.trim()) {
    return { valid: false, errors: ['提交信息不能为空。'] };
  }

  if (rawMessage.startsWith('\uFEFF')) {
    errors.push('提交信息开头包含 UTF-8 BOM 字符，请移除后重试。');
  }

  const lines = rawMessage
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('#'));

  const header = (lines[0] || '').trim();
  if (!header) {
    return { valid: false, errors: ['提交信息首行不能为空。'] };
  }

  // 自动放行 Git 原生合并/回滚/变基临时提交
  if (/^(Merge |Revert "|fixup! |squash! )/.test(header)) {
    return { valid: true, errors: [] };
  }

  const match = header.match(HEADER_PATTERN);
  if (!match) {
    errors.push(
      `首行格式不符合规范，须为 "<type>(<scope>): <中文描述>"，允许的类型：${ALLOWED_TYPES.join(', ')}`
    );
  } else {
    const description = match[3].trim();
    if (!/[\u4e00-\u9fff]/.test(description)) {
      errors.push('提交描述必须使用简体中文编写（可保留必要的英文专有名词或路径）。');
    }
    if (description.length < 4) {
      errors.push('提交描述过于简短，请清晰说明本次改动意图（不少于 4 个字符）。');
    }
  }

  if (header.length > 80) {
    errors.push(`首行长度为 ${header.length}，建议精简至 80 个字符以内。`);
  }

  return { valid: errors.length === 0, errors };
}

const targetPath = process.argv[2];
if (targetPath) {
  const content = readFileSync(targetPath, 'utf8');
  const result = validateCommitMessage(content);
  if (!result.valid) {
    console.error('\n❌ Git 提交信息校验失败：\n');
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error('\n✅ 示例：feat(brand): 新增双卡叠放品牌标志与全场景预览图\n');
    process.exit(1);
  }
}
