import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';

function setupEndpoint(urlString, local) {
  const url = new URL(urlString);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:'))
  ) {
    throw new Error('安装地址必须使用 HTTPS，本地回环地址可以使用 HTTP。');
  }
  return new URL('/api/setup/initialize', url);
}

async function main() {
  const { values: opts } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      env: { type: 'string', default: 'production' },
      url: { type: 'string' },
      local: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
  });
  if (!['staging', 'production'].includes(opts.env)) throw new Error('请选择 staging 或 production。');

  if (opts['dry-run']) {
    console.log(`[DRY RUN] 目标环境：${opts.local ? '本地' : opts.env}`);
    console.log('POST /api/setup/initialize（所有输入已隐藏）');
    console.log('在一个 D1 批次内初始化管理员、站点配置、支付插件和安装标志。');
    return;
  }

  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('请通过 ADMIN_PASSWORD 提供 8 至 128 位管理员密码。');
  }
  if (!secret) throw new Error('请通过 ADMIN_SECRET 提供安装口令。');

  const rl = opts.yes ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const url =
      opts.url ||
      process.env.ACCTHUB_SETUP_URL ||
      (opts.local ? 'http://localhost:5173' : await rl?.question('请输入目标站点 HTTPS 地址: '));
    if (!url) throw new Error('请通过 --url 或 ACCTHUB_SETUP_URL 提供已部署的 AcctHub 站点地址。');
    const endpoint = setupEndpoint(url, opts.local);
    const email = (process.env.ADMIN_EMAIL || (await rl?.question('请输入首位超级管理员邮箱: ')) || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请提供有效的管理员邮箱。');
    const body = {
      setup_secret: secret,
      admin_email: email,
      admin_password: password,
      admin_display_name: process.env.ADMIN_DISPLAY_NAME || undefined,
      brand_name: process.env.BRAND_NAME || undefined,
      brand_tagline: process.env.BRAND_TAGLINE || undefined,
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`安装接口返回 HTTP ${response.status}。`);
    const result = await response.json();
    if (result.ok !== true || result.initialized !== true) throw new Error('安装接口未确认系统初始化。');
    console.log('冷启动初始化完成（system_initialized=1）。');
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error('初始化失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
