import assert from 'node:assert/strict';
import { verifySandboxRoutesAbsent } from './release-payment-boundary.mjs';

function parseArgs(argv) {
  let targetEnv = 'production';
  let urlArg = process.env.RELEASE_URL || '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env' && argv[i + 1]) targetEnv = argv[++i];
    else if (argv[i] === '--url' && argv[i + 1]) urlArg = argv[++i];
  }
  if (!urlArg) {
    throw new Error('请通过 --url <origin> 或环境变量 RELEASE_URL 提供目标部署域名。');
  }
  return { targetEnv, origin: new URL(urlArg).origin };
}

async function main() {
  const { targetEnv, origin } = parseArgs(process.argv.slice(2));

  const health = await fetch(new URL('/api/health', origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(health.status, 200, '部署健康接口必须返回 200');
  const healthBody = await health.json();
  assert.equal(healthBody.runtime, 'cloudflare-workers-edge', '运行环境标识不符合 Cloudflare Workers');
  assert.equal(healthBody.env, targetEnv, `远端环境不匹配：预期 ${targetEnv}，实际 ${healthBody.env}`);
  assert.equal(healthBody.sandbox_mode, false, '线上部署禁止开启沙盒模式');

  const setup = await fetch(new URL('/api/setup/status', origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(setup.status, 200, '初始化状态接口必须返回 200');
  const status = await setup.json();
  assert.equal(status.is_production, true, '线上环境 is_production 必须为 true');

  const statuses = await verifySandboxRoutesAbsent(origin);
  const home = await fetch(new URL('/', origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(home.status, 200, '前端首页必须返回 200');
  assert.match(home.headers.get('content-type') ?? '', /^text\/html\b/);

  console.log(
    JSON.stringify({
      status: 'passed',
      origin,
      env: targetEnv,
      sandboxRoutesChecked: statuses.length,
    })
  );
}

main().catch((err) => {
  console.error(`远端部署健康探活失败：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
