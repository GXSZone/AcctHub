import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync } from 'node:fs';

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  const paths = process.argv.slice(2).map((filename) => realpathSync(filename));
  if (paths.length !== 2 || paths[0] === paths[1]) throw new Error();
  const stats = paths.map((path) => statSync(path, { bigint: true }));
  if (
    stats.some((stat) => !stat.isFile() || stat.size === 0n) ||
    (stats[0].dev === stats[1].dev && stats[0].ino === stats[1].ino)
  ) {
    throw new Error();
  }
  const [beforeSha256, afterSha256] = await Promise.all(paths.map(digest));
  const status = beforeSha256 === afterSha256 ? 'unchanged' : 'changed';
  console.log(JSON.stringify({ status, beforeSha256, afterSha256 }, null, 2));
  process.exitCode = status === 'unchanged' ? 0 : 1;
} catch {
  console.error('恢复验证无法完成。请提供切换前后独立生成的两个数据库导出文件。');
  process.exitCode = 2;
}
