import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';

const cleanup: string[] = [];

function fixture(sql = '', migrated = true) {
  const dir = mkdtempSync(join(tmpdir(), 'accthub-ops-'));
  cleanup.push(dir);
  const filename = join(dir, 'database.sqlite');
  const db = new DatabaseSync(filename);
  try {
    if (migrated) db.exec(readFileSync('migrations/0000_accthub_baseline.sql', 'utf8'));
    db.exec(sql);
  } finally {
    db.close();
  }
  return filename;
}

function check(filename: string) {
  return spawnSync(process.execPath, ['scripts/operational-check.mjs', '--snapshot', filename], {
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('平账、有效补退后再扣、已确认退款和刚付款的订单通过，数据库字节不变', () => {
  const filename = fixture(`
    INSERT INTO users (id, email, display_name, password_hash, balance, promo_balance)
      VALUES (1, 'one@example.test', 'one', 'unused', 10, 1);
    INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_no)
      VALUES (1, 'recharge', 10, 10, 'intent-ok');
    INSERT INTO promo_transactions (user_id, type, amount, balance_after, ref_no)
      VALUES (1, 'reward', 3, 3, 'earned'), (1, 'spend', -2, 1, 'order-ok'),
        (1, 'refund', 2, 3, 'order-ok'), (1, 'spend', -2, 1, 'order-ok');
    INSERT INTO orders (order_no, contact_email, product_id, product_title, unit_price, total_amount)
      VALUES ('fresh', 'one@example.test', 1, 'stub', 1, 1);
    INSERT INTO order_refunds (order_no, operation_id, site_agent_id, mode, route, status, provider,
      original_payment, currency, amount, amount_cny, created_at)
      VALUES ('refunded', 'ok', 0, 'automatic', 'original_payment', 'succeeded',
        'stripe', 'charge-1', 'CNY', 1, 1, '2020-01-01');
    INSERT INTO site_mail_configs (owner_agent_id, provider) VALUES (8, 'mailgun');
    INSERT INTO mail_outbox (owner_agent_id, event_key, scene, status, attempts, last_error)
      VALUES (8, 'order_delivery:done', 'order_delivery', 'sent', 2, ''),
             (8, 'order_delivery:fresh', 'order_delivery', 'pending', 0, ''),
             (8, 'restock:1:0', 'restock_alert', 'pending', 2, 'error');
  `);
  const before = readFileSync(filename);
  const result = check(filename);
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'passed', findings: [] });
  expect(readFileSync(filename)).toEqual(before);
});

it('各账户正负误差相抵时仍报警，并按实际渠道报告超时及重复生效', () => {
  const result = check(
    fixture(`
    INSERT INTO users (id, email, display_name, password_hash, balance, promo_balance)
      VALUES (1, 'one@example.test', 'one', 'unused', 11, 2),
             (2, 'two@example.test', 'two', 'unused', 9, 0);
    INSERT INTO wallet_transactions (user_id, type, amount, balance_after, ref_no)
      VALUES (1, 'recharge', 5, 5, 'duplicate'), (1, 'recharge', 5, 10, 'duplicate'),
             (2, 'recharge', 10, 10, 'single');
    INSERT INTO promo_transactions (user_id, type, amount, balance_after, ref_no)
      VALUES (1, 'reward', 3, 3, 'earned'), (2, 'reward', 0, 0, '');
    INSERT INTO order_refunds (order_no, operation_id, site_agent_id, mode, route, status, provider,
      original_payment, currency, amount, amount_cny, created_at)
      VALUES ('refund', 'pending', 0, 'automatic', 'original_payment', 'unknown',
        'stripe', 'charge-2', 'CNY', 1, 1, '2020-01-01');
    INSERT INTO orders (order_no, contact_email, product_id, product_title, unit_price, total_amount,
      status, payment_method, channel, upstream_source_id, created_at)
      VALUES ('undelivered', 'one@example.test', 1, 'stub', 1, 1, 'upstream_pending',
        'epay', 'web', 7, '2020-01-01');
    INSERT INTO site_mail_configs (owner_agent_id, provider) VALUES (2, 'resend'), (9, 'mailgun');
    INSERT INTO mail_outbox (owner_agent_id, event_key, scene, status, attempts, last_error)
      VALUES (2, 'order_delivery:retry', 'order_delivery', 'pending', 1, 'private-email@example.test'),
             (9, 'order_replacement:terminal', 'order_replacement', 'failed', 1, '');
  `)
  );
  expect(result.status, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.status).toBe('blocked');
  expect(report.findings).toEqual(
    expect.arrayContaining([
      { check: 'wallet_drift', channel: 'site-0-cash', count: 2 },
      { check: 'wallet_drift', channel: 'site-0-promo', count: 1 },
      { check: 'duplicate_event', channel: 'cash-recharge', count: 1 },
      { check: 'refund_overdue', channel: 'stripe', count: 1 },
      { check: 'order_undelivered', channel: 'web/epay/source-7', count: 1 },
      { check: 'delivery_mail_failed', channel: 'site-2-resend', count: 1 },
      { check: 'delivery_mail_failed', channel: 'site-9-mailgun', count: 1 },
    ])
  );
  expect(result.stdout).not.toContain('private-email@example.test');
  expect(result.stdout).not.toContain('charge-2');
});

it('迁移缺失导致的查询失败关闭门禁', () => {
  const result = check(fixture('', false));
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('运行验收无法完成');
});
