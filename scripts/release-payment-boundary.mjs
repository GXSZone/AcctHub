import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const paymentBoundaryEnvironments = [
  { environment: 'staging', sandboxBinding: false },
  { environment: 'production', sandboxBinding: false },
  { environment: 'development', sandboxBinding: true },
];

const sandboxPaths = [
  ['GET', '/api/payments/sandbox/mock-gateway', '?intent=PAY12345678901234&provider=epay'],
  ['POST', '/api/payments/sandbox/simulate-pay'],
  ['POST', '/api/auth/topup-demo'],
  ['POST', '/api/account/recharge'],
];

export const expectedPaymentBoundary = paymentBoundaryEnvironments.map((profile) => ({
  ...profile,
  statuses: sandboxPaths.map(([method, path]) => ({ method, path, status: 404 })),
}));

// 禁用标记（如历史模拟流水前缀）会继续留在正式核销代码中。这里只查可执行入口、模拟 UI 和种子。
const sandboxImplementation = [
  'sandbox/simulate-pay',
  'sandbox/mock-gateway',
  'topup-demo',
  'accthub://sandbox-pay/',
  'SANDBOX CASHIER',
  'cshSandboxBtn',
  'demoCashierBadge',
  '沙盒测试收银台即时到账',
  '模拟支付单金额无效',
  '沙盒环境测试余额加款',
  '生产环境已关闭免回调沙盒直充',
  'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
  '0x000000000000000000000000000000000000dEaD',
  'admin123456',
  'demo123456',
  'up_live_demo_token_2026',
];

export function auditReleasePaymentBuild(dist) {
  const flags = JSON.parse(readFileSync(join(dist, 'accthub/wrangler.json'), 'utf8'));
  assert.notEqual(flags.upload_source_maps, true, '发布 Worker 不得上传源码映射');
  assert.deepEqual(flags.vars, { APP_ENV: 'production', SANDBOX_MODE: 'false' }, '发布构建配置含开发变量');
  for (const path of readdirSync(dist, { recursive: true })) {
    assert.ok(!/\.map$/i.test(path), `发布包包含源码映射：${path}`);
    if (!/\.(?:m?js|cjs|html|json|css)$/i.test(path)) continue;
    const content = readFileSync(join(dist, path), 'utf8');
    assert.ok(!content.includes('sourceMappingURL=data:'), `发布包包含内联源码映射：${path}`);
    assert.ok(!/\baccountRoutes\.post\(\s*['"]\/recharge['"]/.test(content), `发布包注册了沙盒直充：${path}`);
    for (const marker of sandboxImplementation) {
      assert.ok(!content.includes(marker), `发布包仍包含沙盒实现标记：${path} (${marker})`);
    }
  }
}

export async function verifySandboxRoutesAbsent(origin) {
  const statuses = [];
  for (const [method, path, query = ''] of sandboxPaths) {
    const response = await fetch(new URL(path + query, origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 404, `${method} ${path} 不应由发布 Worker 注册`);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.equal((await response.json()).code, 'NOT_FOUND', `${path} 未走未注册 API 的兜底`);
    statuses.push({ method, path, status: response.status });
  }
  return statuses;
}
