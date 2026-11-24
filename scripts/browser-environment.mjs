import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';
import { verifySandboxRoutesAbsent } from './release-payment-boundary.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const mailEndpoint = 'https://mail-fixture.accthub.test/inbox';

async function loginFixture(url, email, password) {
  const response = await fetch(new URL('/api/auth/login', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`浏览器测试账号 ${email} 登录失败 (${response.status})`);
  return (await response.json()).token;
}

async function buildFixture(workspace) {
  for (const file of [
    'src',
    'shared',
    'worker',
    'migrations',
    'index.html',
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'wrangler.toml',
  ]) {
    await cp(join(project, file), join(workspace, file), { recursive: true });
  }
  await symlink(join(project, 'node_modules'), join(workspace, 'node_modules'), 'junction');
  execFileSync(
    process.execPath,
    [join(workspace, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'sandbox'],
    {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 120_000,
    }
  );
  execFileSync(
    process.execPath,
    [join(project, 'scripts/migrate-db.mjs'), '--local', '--persist-to', join(workspace, 'state')],
    { cwd: workspace, timeout: 60_000, stdio: ['ignore', 'pipe', 'inherit'] }
  );
}

async function startInbox() {
  const messages = [];
  const inbox = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const to = url.searchParams.get('to');
    if (url.pathname !== '/inbox' || !to) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(messages.filter((message) => message.to === to)));
  });
  await new Promise((resolve, reject) => {
    inbox.once('error', reject);
    inbox.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${inbox.address().port}`,
    async receive(request) {
      if (request.url !== mailEndpoint || request.method !== 'POST')
        return new Response(null, { status: 502 });
      messages.push(await request.json());
      return new Response(null, { status: 202 });
    },
    close: () =>
      new Promise((resolve, reject) => {
        inbox.close((error) => (error ? reject(error) : resolve()));
        inbox.closeAllConnections();
      }),
  };
}

export async function startBrowserEnvironment({
  environment = 'development',
  startupOnly = false,
  sandboxBinding = !startupOnly,
} = {}) {
  const tempRoot = await realpath(tmpdir());
  const workspace = await mkdtemp(join(tempRoot, 'accthub-browser-'));
  let runtime;
  let inbox;
  const tearDown = async () => {
    const errors = (await Promise.allSettled([runtime?.dispose(), inbox?.close()])).filter(
      (outcome) => outcome.status === 'rejected'
    );
    const target = await realpath(workspace);
    const suffix = relative(tempRoot, target);
    if (suffix.startsWith('accthub-browser-') && !suffix.includes(sep)) {
      await rm(target, { recursive: true, force: true });
    }
    if (errors.length)
      throw new AggregateError(
        errors.map(({ reason }) => reason),
        '浏览器测试环境清理失败'
      );
  };
  try {
    await buildFixture(workspace, startupOnly);
    inbox = await startInbox();
    runtime = await unstable_startWorker({
      config: join(workspace, 'dist/accthub/wrangler.json'),
      build: { bundle: false },
      sendMetrics: false,
      bindings: {
        APP_ENV: { type: 'plain_text', value: environment },
        SANDBOX_MODE: { type: 'plain_text', value: String(sandboxBinding) },
        ...(startupOnly
          ? {
              ADMIN_SECRET: {
                type: 'plain_text',
                value: `startup-fixture-${randomUUID()}`,
                hidden: true,
              },
              DATA_ENCRYPTION_KEYS: {
                type: 'plain_text',
                value: JSON.stringify({
                  active: 'fixture',
                  keys: { fixture: randomBytes(32).toString('base64') },
                }),
                hidden: true,
              },
              DATA_FINGERPRINT_KEY: {
                type: 'plain_text',
                value: randomBytes(32).toString('base64'),
                hidden: true,
              },
            }
          : {}),
        JWT_SECRET: {
          type: 'plain_text',
          value: `browser-fixture-${randomUUID()}-${randomUUID()}`,
          hidden: true,
        },
      },
      dev: {
        server: { hostname: '127.0.0.1', port: 0 },
        inspector: false,
        persist: join(workspace, 'state'),
        outboundService: inbox.receive,
        watch: false,
        remote: false,
      },
    });
    const url = await runtime.url;
    const health = await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(30_000) });
    const healthBody = health.ok && (await health.json());
    if (healthBody?.runtime !== 'cloudflare-workers-edge' || healthBody.env !== environment) {
      throw new Error(`浏览器 Worker 健康检查失败 (${health.status})`);
    }
    if (startupOnly) {
      const setup = await fetch(new URL('/api/setup/status', url), { signal: AbortSignal.timeout(30_000) });
      const status = setup.ok && (await setup.json());
      if (
        status?.requires_setup !== true ||
        status.is_production !== true ||
        status.has_admin_secret !== true
      ) {
        throw new Error(`启动预检未确认 ${environment} 空 D1 和安装状态`);
      }
      return { close: tearDown, statuses: await verifySandboxRoutesAbsent(url) };
    } else {
      process.env.ACCTHUB_E2E_ADMIN_TOKEN = await loginFixture(url, 'admin@accthub.dev', 'admin123456');
      process.env.ACCTHUB_E2E_AGENT_TOKEN = await loginFixture(url, 'demo@accthub.dev', 'demo123456');
      const payment = await fetch(new URL('/api/admin/payment-plugins/epay', url), {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${process.env.ACCTHUB_E2E_ADMIN_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ enabled: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!payment.ok) throw new Error(`无法启用浏览器测试易支付沙盒 (${payment.status})`);
    }
    process.env.ACCTHUB_E2E_ORIGIN = url.origin;
    process.env.ACCTHUB_E2E_INBOX = inbox.origin;
    process.env.ACCTHUB_E2E_MAIL_ENDPOINT = mailEndpoint;
    console.log(`浏览器测试 Worker ${url.origin}，收件箱 ${inbox.origin}`);
    return tearDown;
  } catch (error) {
    await tearDown().catch((cleanupError) => {
      console.error(cleanupError);
    });
    throw error;
  }
}

export default function playwrightSetup() {
  return startBrowserEnvironment();
}
