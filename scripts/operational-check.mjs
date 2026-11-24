import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const checks = [
  'wallet_drift',
  'duplicate_event',
  'refund_overdue',
  'order_undelivered',
  'delivery_mail_failed',
];

function observationSql(refundMinutes, deliveryMinutes) {
  // 单条 SELECT 在同一个数据库快照中完成核对。最终结果只包含渠道和计数。
  return `WITH
cash_totals AS (
  SELECT user_id, sum(round(amount * 100)) AS cents FROM wallet_transactions GROUP BY user_id
),
promo_totals AS (
  SELECT user_id, sum(round(amount * 100)) AS cents FROM promo_transactions GROUP BY user_id
),
wallet_drifts AS (
  SELECT 'site-' || u.site_agent_id || '-cash' AS channel
    FROM users u LEFT JOIN cash_totals t ON t.user_id = u.id
    WHERE round(u.balance * 100) <> coalesce(t.cents, 0)
  UNION ALL
  SELECT 'site-' || u.site_agent_id || '-promo'
    FROM users u LEFT JOIN promo_totals t ON t.user_id = u.id
    WHERE round(u.promo_balance * 100) <> coalesce(t.cents, 0)
  UNION ALL
  SELECT 'orphan-cash' FROM cash_totals t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL
  UNION ALL
  SELECT 'orphan-promo' FROM promo_totals t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL
),
duplicates AS (
  SELECT 'cash-' || type AS channel FROM wallet_transactions
    WHERE type IN ('recharge', 'cdk', 'order_pay', 'refund', 'commission_clawback', 'withdraw', 'withdraw_refund')
      AND trim(ref_no) <> '' AND amount <> 0
    GROUP BY CASE WHEN type = 'cdk' THEN 0 ELSE user_id END, type, ref_no HAVING count(*) > 1
  UNION ALL
  SELECT 'promo-reward' FROM promo_transactions WHERE type = 'reward' AND trim(ref_no) <> '' AND amount <> 0
    GROUP BY user_id, ref_no HAVING count(*) > 1
  UNION ALL
  SELECT 'promo-spend-refund' FROM (
    SELECT user_id, ref_no,
      sum(CASE WHEN type = 'spend' THEN 1 ELSE -1 END)
        OVER (PARTITION BY user_id, ref_no ORDER BY id) AS open_spends
    FROM promo_transactions WHERE type IN ('spend', 'refund') AND trim(ref_no) <> '' AND amount <> 0
  ) WHERE open_spends NOT IN (0, 1) GROUP BY user_id, ref_no
  UNION ALL
  SELECT 'commission-' || reward_type FROM commission_ledger WHERE trim(order_no) <> '' AND amount <> 0
    GROUP BY order_no, beneficiary_agent_id, source_agent_id, reward_type HAVING count(*) > 1
  UNION ALL
  SELECT 'payment-' || provider FROM payment_intents WHERE status = 'paid' AND trim(provider_trade_no) <> ''
    GROUP BY provider, provider_trade_no HAVING count(*) > 1
  UNION ALL
  SELECT 'refund-' || provider FROM order_refunds
    WHERE status = 'succeeded' AND route IN ('original_payment', 'wallet_compensation')
    GROUP BY provider, original_payment HAVING count(*) > 1
),
undelivered AS (
  SELECT
    o.channel || '/' || coalesce(p.provider, o.payment_method) || '/' ||
      CASE WHEN o.upstream_source_id IS NULL THEN 'local' ELSE 'source-' || o.upstream_source_id END AS channel
    FROM orders o
    LEFT JOIN payment_intents p ON p.intent_no = o.payment_intent_no AND p.biz_type = 'order' AND p.biz_ref = o.order_no
    WHERE (o.status IN ('paid', 'processing', 'upstream_pending', 'fulfillment_failed', 'delivered') OR p.status = 'paid')
      AND o.status <> 'refunded'
      AND (o.delivered_at IS NULL OR trim(o.delivered_payload) = '')
      AND (
        o.status = 'fulfillment_failed' OR
        coalesce(datetime(p.paid_at), datetime(o.created_at), '0001-01-01') <= datetime('now', '-${deliveryMinutes} minutes')
      )
      AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.order_no = o.order_no AND r.status = 'succeeded')
),
failed_delivery_mail AS (
  SELECT 'site-' || q.owner_agent_id || '-' || coalesce(m.provider, 'unconfigured') AS channel
    FROM mail_outbox q LEFT JOIN site_mail_configs m ON m.owner_agent_id = q.owner_agent_id
    WHERE q.scene IN ('order_delivery', 'order_resend', 'order_replacement')
      AND (q.status IN ('failed', 'disabled') OR (q.status = 'pending' AND trim(q.last_error) <> ''))
),
findings AS (
  SELECT 'wallet_drift' AS check_name, channel FROM wallet_drifts
  UNION ALL SELECT 'duplicate_event', channel FROM duplicates
  UNION ALL SELECT 'refund_overdue', provider FROM order_refunds
    WHERE status <> 'succeeded'
      AND coalesce(datetime(created_at), '0001-01-01') <= datetime('now', '-${refundMinutes} minutes')
  UNION ALL SELECT 'order_undelivered', channel FROM undelivered
  UNION ALL SELECT 'delivery_mail_failed', channel FROM failed_delivery_mail
)
SELECT check_name AS "check", channel, count(*) AS count
  FROM findings GROUP BY check_name, channel ORDER BY check_name, channel`;
}

function minutes(input, fallback) {
  if (input === undefined) return fallback;
  if (!/^[1-9]\d{0,4}$/.test(input)) throw new Error('观察时限须为 1 到 99999 的整数分钟');
  return Number(input);
}

function wranglerQuery(sql, values) {
  const wrangler = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const args = ['d1', 'execute', 'DB', values.local ? '--local' : '--remote', '--json', '--command', sql];
  if (values.env) args.push('--env', values.env);
  if (values['persist-to']) args.push('--persist-to', values['persist-to']);
  const output = execFileSync(process.execPath, [wrangler, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  const results = JSON.parse(output);
  if (!Array.isArray(results) || results.length !== 1 || results[0]?.success !== true) {
    throw new Error('D1 未返回有效查询结果');
  }
  return results[0].results;
}

async function main() {
  const { values } = parseArgs({
    options: {
      local: { type: 'boolean' },
      remote: { type: 'boolean' },
      snapshot: { type: 'string' },
      env: { type: 'string' },
      'persist-to': { type: 'string' },
      'refund-minutes': { type: 'string' },
      'delivery-minutes': { type: 'string' },
    },
  });
  if (
    [values.local, values.remote, values.snapshot].filter(Boolean).length !== 1 ||
    (values.remote ? !['staging', 'production'].includes(values.env) : values.env !== undefined) ||
    (values['persist-to'] !== undefined && !values.local)
  ) {
    throw new Error('请选择 --local、--snapshot <只读 SQLite> 或 --remote --env <staging|production>');
  }
  const thresholds = {
    refundMinutes: minutes(values['refund-minutes'], 60),
    deliveryMinutes: minutes(values['delivery-minutes'], 15),
  };
  const sql = observationSql(thresholds.refundMinutes, thresholds.deliveryMinutes);
  let findings;
  if (values.snapshot) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(values.snapshot, { readOnly: true });
    try {
      findings = db.prepare(sql).all();
    } finally {
      db.close();
    }
  } else {
    findings = wranglerQuery(sql, values);
  }
  if (
    !Array.isArray(findings) ||
    findings.some(
      (row) =>
        !checks.includes(row.check) ||
        typeof row.channel !== 'string' ||
        !row.channel ||
        !Number.isSafeInteger(row.count) ||
        row.count < 1
    )
  ) {
    throw new Error('查询结果不完整');
  }
  console.log(
    JSON.stringify(
      {
        status: findings.length ? 'blocked' : 'passed',
        environment: values.env ?? (values.snapshot ? 'snapshot' : 'local'),
        observedAt: new Date().toISOString(),
        thresholds,
        findings,
      },
      null,
      2
    )
  );
  process.exitCode = findings.length ? 1 : 0;
}

try {
  await main();
} catch {
  // Wrangler 或 SQLite 诊断可能含远端配置、命令参数或连接信息。
  console.error('运行验收无法完成。请检查参数、D1 绑定和迁移状态，再重新运行。');
  process.exitCode = 2;
}
