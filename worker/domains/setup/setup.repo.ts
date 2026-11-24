import { and, eq, sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { adminAuditLogs, paymentPlugins, siteSettings, users } from '../../db/schema/core';
import type { AppDatabase } from '../../infra/db';

export async function getSetupCompletionRepo(db: AppDatabase): Promise<boolean> {
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'system_initialized'))
    .limit(1);
  return row?.value === '1';
}

export async function getSetupAdminsRepo(db: AppDatabase) {
  return db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.siteAgentId, 0), eq(users.role, 'admin')))
    .limit(2);
}

const productionPlugins = [
  {
    id: 'epay',
    name: '易支付聚合收银台（支付宝 / 微信）',
    description: '标准 MD5 签名发单与异步回调核销',
    enabled: 0,
    configJson: JSON.stringify({ api_url: '', pid: '', key: '', pay_type: 'alipay' }),
  },
  {
    id: 'stripe',
    name: 'Stripe Checkout 国际信用卡',
    description: '全球 Visa / Mastercard / Apple Pay 托管收单',
    enabled: 0,
    configJson: JSON.stringify({
      publishable_key: '',
      secret_key: '',
      webhook_secret: '',
      currency: 'usd',
      usd_cny_rate: '7.2',
      hkd_cny_rate: '',
    }),
  },
  {
    id: 'usdt_trc20',
    name: 'USDT-TRC20 链上自动收款',
    description: '动态唯一 4 位小数防撞单与波场自动核单',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      trongrid_api_key: '',
    }),
  },
  {
    id: 'alipay_f2f',
    name: '支付宝官方当面付（RSA2 扫码）',
    description: '直连支付宝官方预下单接口生成收款二维码，纯边缘 RSA2 签名验签',
    enabled: 0,
    configJson: JSON.stringify({
      app_id: '',
      private_key: '',
      alipay_public_key: '',
      gateway_url: 'https://openapi.alipay.com/gateway.do',
    }),
  },
  {
    id: 'usdt_bep20',
    name: 'USDT BEP20（BSC 币安智能链）',
    description: '低 Gas 费 BSC 链上 4 位尾数防撞单与自动核单',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      explorer_api_key: '',
    }),
  },
  {
    id: 'usdt_erc20',
    name: 'USDT ERC20（以太坊主网）',
    description: '以太坊主网 4 位尾数防撞单与链上自动核单',
    enabled: 0,
    configJson: JSON.stringify({
      wallet_address: '',
      usdt_cny_rate: '7.25',
      rate_markup: '0.02',
      auto_fx: 'true',
      explorer_api_key: '',
    }),
  },
];

interface SetupAdmin {
  id: number;
  email: string;
  display_name: string;
  balance: number;
  total_recharged: number;
}

/** D1 依序提交整批语句，任一语句失败即回滚。批次内部重新校验凭据与安装状态。 */
export async function commitSystemSetupRepo(
  db: AppDatabase,
  input: {
    email: string;
    displayName: string;
    passwordHash: string;
    resume: boolean;
    brandName: string;
    brandTagline: string;
    ip: string;
    userAgent: string;
  }
): Promise<SetupAdmin | null> {
  const { email, passwordHash } = input;
  const pending = sql`NOT EXISTS (SELECT 1 FROM ${siteSettings} WHERE key = 'system_initialized' AND value = '1')`;
  const eligibleAdmin = sql`FROM ${users}
    WHERE site_agent_id = 0 AND role = 'admin' AND email = ${email} AND password_hash = ${passwordHash}
    AND (SELECT count(*) FROM ${users} WHERE site_agent_id = 0 AND role = 'admin') = 1 AND ${pending}`;
  const settings = [
    ['brand_name', input.brandName],
    ['brand_tagline', input.brandTagline],
    ['brand_tagline_en', input.brandTagline],
    ['announcement_banner', '欢迎光临 · 极速自动交付平台已就绪'],
    ['announcement_banner_en', 'Welcome · Automated digital fulfillment storefront is ready.'],
  ];
  const updateExisting = input.resume
    ? sql`DO NOTHING`
    : sql`DO UPDATE SET value = excluded.value, updated_at = datetime('now')`;
  const statements = [
    sql`INSERT INTO ${users} (site_agent_id, email, display_name, password_hash, role)
      SELECT 0, ${email}, ${input.displayName}, ${passwordHash}, 'admin'
      WHERE ${input.resume ? 0 : 1} AND ${pending}
      AND NOT EXISTS (SELECT 1 FROM ${users} WHERE site_agent_id = 0 AND role = 'admin')`,
    sql`SELECT id, email, display_name, balance, total_recharged ${eligibleAdmin}`,
    ...settings.map(
      ([key, value]) => sql`INSERT INTO ${siteSettings} (key, value)
      SELECT ${key}, ${value} ${eligibleAdmin} ON CONFLICT(key) ${updateExisting}`
    ),
    ...productionPlugins.map(
      (plugin) => sql`INSERT INTO ${paymentPlugins} (id, name, description, enabled, config_json)
      SELECT ${plugin.id}, ${plugin.name}, ${plugin.description}, ${plugin.enabled}, ${plugin.configJson}
      ${eligibleAdmin} ON CONFLICT(id) DO NOTHING`
    ),
    sql`INSERT INTO ${adminAuditLogs}
      (actor_user_id, actor_email, actor_role, action, target_type, target_id, summary, after_json, ip, user_agent)
      SELECT id, substr(email, 1, 120), 'admin', 'setup.initialize', 'system', CAST(id AS TEXT),
      ${`完成系统冷启动初始化（品牌：${input.brandName}）`},
      ${JSON.stringify({ admin_email: email, brand_name: input.brandName })},
      ${input.ip.slice(0, 64)}, ${input.userAgent.slice(0, 200)} ${eligibleAdmin}`,
    sql`INSERT INTO ${siteSettings} (key, value)
      SELECT 'system_initialized', '1' ${eligibleAdmin}
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ];
  // Drizzle D1 的 batch 无法绑定 raw 查询参数。用其 SQLite 方言生成参数化语句，再提交原子批次。
  const dialect = new SQLiteSyncDialect();
  const batch = statements.map((statement) => {
    const query = dialect.sqlToQuery(statement);
    return db.$client.prepare(query.sql).bind(...query.params);
  });
  const [, result] = await db.$client.batch<SetupAdmin>(batch);
  return result.results[0] ?? null;
}
