import { describe, expect, it } from 'vitest';
import { agents } from '../../worker/db/schema/index';
import { redeemMemberCdk } from '../../worker/domains/account/account.service';
import {
  recoverPendingAffiliateRewards,
  reservePromoBalanceForOrder,
  settleAffiliateRewardForOrder,
} from '../../worker/domains/account/affiliate.service';
import { reviewAgentWithdrawal } from '../../worker/domains/admin/admin.ops.service';
import { createAgentWithdrawal } from '../../worker/domains/agent/agent.downline.service';
import { rechargeAgentTier } from '../../worker/domains/agent/agent.store.service';
import { settleRecursiveOrderProfits } from '../../worker/domains/agent/settlement.service';
import { mapAgentRow } from '../../worker/domains/auth/auth.repo';
import { issueAuthSession } from '../../worker/domains/auth/auth.session';
import {
  finalizeProcessingOrderCas,
  releaseAbortedOrderSlotRepo,
} from '../../worker/domains/orders/orders.repo';
import {
  postBalanceOrderDebit,
  recoverImmediateOrderAborts,
  requestImmediateOrderAbort,
} from '../../worker/domains/orders/orders.wallet.repo';
import { markPaymentIntentExpired } from '../../worker/domains/payment/payment.order.repo';
import { executeFulfillForPaidIntent } from '../../worker/domains/payment/payment.recovery';
import { resolveTenantContext } from '../../worker/domains/tenant/tenant.service';
import type { Env } from '../../worker/env';
import { createDb } from '../../worker/infra/db';
import { createTestD1Database } from './helpers/test-d1';

function fixture() {
  const { rawDb, d1, close } = createTestD1Database();
  const env: Env = { DB: d1, APP_ENV: 'test', JWT_SECRET: 'test-wallet-events-secret-for-local-testing' };
  rawDb.exec(`INSERT INTO users (id, email, display_name, password_hash, balance, promo_balance)
    VALUES (1, 'buyer@example.test', 'Buyer', '-', 40, 20), (2, 'seller@example.test', 'Seller', '-', 0, 0)`);
  const user = {
    id: 1,
    email: 'buyer@example.test',
    role: 'user' as const,
    balance: 40,
    display_name: 'Buyer',
    site_agent_id: 0,
    total_recharged: 0,
  };
  const order = (status: string) =>
    rawDb
      .prepare(`INSERT INTO orders
    (order_no, user_id, contact_email, product_id, product_title, unit_price, total_amount, status)
    VALUES ('O1', 1, ?, 99999, 'Test', 30, 30, ?)`)
      .run(user.email, status);
  const balance = (id = 1) => rawDb.prepare('SELECT balance FROM users WHERE id = ?').get(id)?.balance;
  const promo = (id = 1) =>
    rawDb.prepare('SELECT promo_balance FROM users WHERE id = ?').get(id)?.promo_balance;
  const interrupt = (table: string) =>
    rawDb.exec(`CREATE TEMP TRIGGER fail_wallet_test BEFORE INSERT ON ${table}
    BEGIN SELECT RAISE(ABORT, 'wallet test interruption'); END;`);
  const restore = () => rawDb.exec('DROP TRIGGER fail_wallet_test');
  const intent = (
    intentNo: string,
    bizType: 'wallet_recharge' | 'agent_upgrade' | 'order',
    payload = '{}'
  ) => {
    rawDb
      .prepare(`INSERT INTO payment_intents (intent_no, biz_type, biz_ref, user_id, provider,
      amount_cny, pay_amount, status, fulfill_status, expires_at, created_at, payload_json, fulfill_lease_token, fulfill_lease_until)
      VALUES (?, ?, ?, 1, 'stripe', 10, 10, 'paid', 'processing', '2099-01-01', '2026-01-01 00:00:00', ?, ?, '2099-01-01')`)
      .run(intentNo, bizType, bizType === 'order' ? 'O1' : intentNo, payload, `lease-${intentNo}`);
    return rawDb
      .prepare('SELECT * FROM payment_intents WHERE intent_no = ?')
      .get(intentNo) as unknown as Parameters<typeof executeFulfillForPaidIntent>[1];
  };
  return { rawDb, db: createDb(d1), env, close, user, order, balance, promo, interrupt, restore, intent };
}

describe('资金业务事件', () => {
  it.each(['web', 'reseller_api'])(
    '[余额购单] %s 扣款和退款故障均回滚，退款失败保留订单并可恢复',
    async (channel) => {
      const f = fixture();
      try {
        f.order('processing');
        f.rawDb.prepare("UPDATE orders SET channel = ?, payment_method = 'balance'").run(channel);
        const debit = () =>
          postBalanceOrderDebit(f.db, { orderNo: 'O1', userId: 1, amount: 30, note: 'order debit' });
        f.interrupt('wallet_transactions');
        await expect(debit()).rejects.toThrow(/wallet test interruption/);
        expect(f.balance()).toBe(40);
        f.restore();
        await expect(debit()).resolves.toBe(true);
        await expect(debit()).resolves.toBe(false);
        expect(f.balance()).toBe(10);
        f.interrupt('wallet_transactions');
        await expect(requestImmediateOrderAbort(f.db, 'O1')).rejects.toThrow(/wallet test interruption/);
        await releaseAbortedOrderSlotRepo(f.db, 'O1');
        expect(f.balance()).toBe(10);
        expect(f.rawDb.prepare('SELECT status FROM orders').get()?.status).toBe('processing');
        f.restore();
        await recoverImmediateOrderAborts(f.db);
        await recoverImmediateOrderAborts(f.db);
        expect(f.balance()).toBe(40);
        expect(f.rawDb.prepare('SELECT status FROM orders').get()?.status).toBe('refunded');
        expect(f.rawDb.prepare('SELECT type, amount FROM wallet_transactions ORDER BY id').all()).toEqual([
          { type: 'order_pay', amount: -30 },
          { type: 'refund', amount: 30 },
        ]);
      } finally {
        f.close();
      }
    }
  );

  it('[S05] 缺货退款流水写入失败时保留可恢复状态且余额不变', async () => {
    const f = fixture();
    try {
      f.order('pending_payment');
      const intent = f.intent('P1', 'order');
      const fulfill = () => executeFulfillForPaidIntent(f.env, intent, '', { allowProcessingRecovery: true });
      f.interrupt('wallet_transactions');
      await expect(fulfill()).rejects.toThrow(/wallet test interruption/);
      expect(f.balance()).toBe(40);
      f.restore();
      await fulfill();
      await fulfill();
      expect(f.balance()).toBe(70);
      expect(f.rawDb.prepare("SELECT status FROM orders WHERE order_no = 'O1'").get()?.status).toBe(
        'refunded'
      );
    } finally {
      f.close();
    }
  });

  it('[S06] 充值流水写入失败时回滚且仅可入账一次', async () => {
    const f = fixture();
    try {
      const row = f.intent('P1', 'wallet_recharge') as unknown as Parameters<
        typeof executeFulfillForPaidIntent
      >[1];
      f.interrupt('wallet_transactions');
      await expect(executeFulfillForPaidIntent(f.env, row, '')).rejects.toThrow();
      expect(f.balance()).toBe(40);
      f.restore();
      await executeFulfillForPaidIntent(f.env, row, '');
      await executeFulfillForPaidIntent(f.env, row, '');
      expect(f.balance()).toBe(50);
      expect(
        f.rawDb.prepare("SELECT fulfill_status FROM payment_intents WHERE intent_no = 'P1'").get()
          ?.fulfill_status
      ).toBe('done');
    } finally {
      f.close();
    }
  });

  it('[S12] 分润台账失败时回滚钱包和代理收入，重入使用首次已结算金额', async () => {
    const f = fixture();
    try {
      f.order('processing');
      f.rawDb.exec(`INSERT INTO agents (id, user_id, slug, brand_name, api_key)
        VALUES (1, 2, 'seller', 'Seller', 'test-key')`);
      const params = {
        env: f.env,
        orderNo: 'O1',
        sellingAgentId: 1,
        baseMainTotal: 10,
        totalAmount: 30,
        mode: 'retail' as const,
      };
      f.interrupt('commission_ledger');
      await expect(settleRecursiveOrderProfits(params)).rejects.toThrow();
      expect(f.balance(2)).toBe(0);
      f.restore();
      expect((await settleRecursiveOrderProfits(params)).totalSettledToChain).toBe(21);
      expect((await settleRecursiveOrderProfits({ ...params, totalAmount: 40 })).totalSettledToChain).toBe(
        21
      );
      expect(f.balance(2)).toBe(21);
      expect(f.rawDb.prepare('SELECT total_revenue FROM agents WHERE id = 1').get()?.total_revenue).toBe(30);
    } finally {
      f.close();
    }
  });

  it('[S13] 推广金扣减和消费流水一并回滚并只提交一次', async () => {
    const f = fixture();
    try {
      f.order('processing');
      const params = { userId: 1, maxPayableAmount: 15, orderNo: 'O1', productTitle: 'Test' };
      f.interrupt('promo_transactions');
      await expect(reservePromoBalanceForOrder(f.db, params)).rejects.toThrow();
      expect(f.promo()).toBe(20);
      f.restore();
      expect(await reservePromoBalanceForOrder(f.db, params)).toBe(15);
      expect(await reservePromoBalanceForOrder(f.db, params)).toBe(15);
      expect(f.promo()).toBe(5);
    } finally {
      f.close();
    }
  });

  it('[S13] 过期退回推广金失败时支付单和订单都保留待付款状态', async () => {
    const f = fixture();
    try {
      f.order('processing');
      await reservePromoBalanceForOrder(f.db, {
        userId: 1,
        maxPayableAmount: 15,
        orderNo: 'O1',
        productTitle: 'Test',
      });
      f.intent('P1', 'order');
      f.rawDb.exec(`
        UPDATE payment_intents SET status = 'pending', fulfill_status = 'none', expires_at = '2000-01-01' WHERE intent_no = 'P1';
        UPDATE orders SET payment_intent_no = 'P1', status = 'pending_payment' WHERE order_no = 'O1';
      `);
      const expire = () => markPaymentIntentExpired(f.db, 'P1');
      f.interrupt('promo_transactions');
      await expect(expire()).rejects.toThrow(/wallet test interruption/);
      expect(f.promo()).toBe(5);
      expect(f.rawDb.prepare('SELECT status FROM orders').get()?.status).toBe('pending_payment');
      expect(f.rawDb.prepare('SELECT status FROM payment_intents').get()?.status).toBe('pending');
      f.restore();
      await expect(expire()).resolves.toBe(true);
      await expect(expire()).resolves.toBe(false);
      expect(f.promo()).toBe(20);
      expect(f.rawDb.prepare('SELECT status FROM orders').get()?.status).toBe('expired');
      expect(f.rawDb.prepare('SELECT status FROM payment_intents').get()?.status).toBe('expired');
    } finally {
      f.close();
    }
  });

  it('[S15] 同额同时间的两笔升级款以支付单号分别记录', async () => {
    const f = fixture();
    try {
      const p1 = f.intent('P1', 'agent_upgrade') as unknown as Parameters<
        typeof executeFulfillForPaidIntent
      >[1];
      const p2 = f.intent('P2', 'agent_upgrade') as unknown as Parameters<
        typeof executeFulfillForPaidIntent
      >[1];
      f.interrupt('recharge_records');
      await expect(executeFulfillForPaidIntent(f.env, p1, '')).rejects.toThrow();
      expect(f.rawDb.prepare('SELECT total_recharged FROM users WHERE id = 1').get()?.total_recharged).toBe(
        0
      );
      f.restore();
      for (const row of [p1, p1, p2]) await executeFulfillForPaidIntent(f.env, row, '');
      expect(f.rawDb.prepare('SELECT total_recharged FROM users WHERE id = 1').get()?.total_recharged).toBe(
        20
      );
      expect(f.rawDb.prepare('SELECT count(*) as n FROM recharge_records WHERE user_id = 1').get()?.n).toBe(
        2
      );
    } finally {
      f.close();
    }
  });

  it('[S26] 充值卡只有在钱包入账和流水成功时才核销', async () => {
    const f = fixture();
    try {
      f.rawDb.exec("INSERT INTO recharge_cdks (code, amount) VALUES ('TESTCDK', 10)");
      f.interrupt('wallet_transactions');
      const redeem = () =>
        redeemMemberCdk(f.env, new Request('http://localhost'), f.user, { code: 'TESTCDK' });
      await expect(redeem()).rejects.toThrow();
      expect(f.balance()).toBe(40);
      expect(f.rawDb.prepare('SELECT status FROM recharge_cdks').get()?.status).toBe('available');
      f.restore();
      await expect(redeem()).resolves.toMatchObject({ balance: 50 });
      await expect(redeem()).rejects.toThrow();
      expect(f.balance()).toBe(50);
    } finally {
      f.close();
    }
  });

  it('[S31] 推广返佣失败没有已结算记录，恢复后只派发一次', async () => {
    const f = fixture();
    try {
      f.order('processing');
      f.rawDb.exec('UPDATE users SET referred_by_user_id = 2 WHERE id = 1');
      f.interrupt('affiliate_ledgers');
      await expect(finalizeProcessingOrderCas(f.db, 'O1', { status: 'delivered' })).rejects.toThrow(
        /wallet test interruption/
      );
      expect(f.rawDb.prepare('SELECT status FROM orders').get()?.status).toBe('processing');
      f.restore();
      await expect(finalizeProcessingOrderCas(f.db, 'O1', { status: 'delivered' })).resolves.toMatchObject({
        updated: true,
      });
      f.interrupt('promo_transactions');
      await expect(settleAffiliateRewardForOrder(f.env, 'O1')).rejects.toThrow();
      expect(f.promo(2)).toBe(0);
      expect(f.rawDb.prepare('SELECT status, reward_amount FROM affiliate_ledgers').get()).toEqual({
        status: 'pending',
        reward_amount: 1.5,
      });
      f.restore();
      f.rawDb.exec(
        "INSERT INTO site_settings (key, value) VALUES ('affiliate_commission_rate', '0.4'), ('affiliate_enabled', '0') ON CONFLICT (key) DO UPDATE SET value = excluded.value"
      );
      await expect(recoverPendingAffiliateRewards(f.env)).resolves.toBe(1);
      await expect(settleAffiliateRewardForOrder(f.env, 'O1')).resolves.toBe(0);
      expect(f.promo(2)).toBe(1.5);
    } finally {
      f.close();
    }
  });

  it('[S39] 提现冻结失败不扣款，驳回退款失败保留待审核', async () => {
    const f = fixture();
    try {
      f.rawDb.exec(`INSERT INTO agents (id, user_id, slug, brand_name, api_key)
        VALUES (1, 1, 'buyer', 'Buyer', 'test-key')`);
      const agentRow = await f.db.select().from(agents).get();
      if (!agentRow) throw new Error('missing test agent');
      const ctx = {
        agent: mapAgentRow(agentRow),
        agentRow,
        user: f.user,
        tier: null,
        tenant: await resolveTenantContext(new Request('http://localhost/'), f.env),
      };
      const withdraw = () =>
        createAgentWithdrawal(f.env, ctx, { amount: 20, channel: 'alipay', account_info: 'test' });
      f.interrupt('agent_withdrawals');
      await expect(withdraw()).rejects.toThrow();
      expect(f.balance()).toBe(40);
      f.restore();
      const created = await withdraw();
      expect(f.balance()).toBe(20);
      f.interrupt('wallet_transactions');
      const reject = () => reviewAgentWithdrawal(f.env, created.id, { action: 'rejected' });
      await expect(reject()).rejects.toThrow();
      expect(f.rawDb.prepare('SELECT status FROM agent_withdrawals').get()?.status).toBe('pending');
      expect(f.balance()).toBe(20);
      f.restore();
      await reject();
      expect(f.balance()).toBe(40);
      expect(
        f.rawDb.prepare('SELECT ref_no FROM wallet_transactions ORDER BY id LIMIT 1').get()?.ref_no
      ).toBe(`WD-${created.id}`);
      await expect(reject()).rejects.toThrow();
    } finally {
      f.close();
    }
  });

  it('[B14] 使用余额升级产生唯一对应支出，流水失败时不给已付升级', async () => {
    const f = fixture();
    try {
      f.rawDb.exec(`INSERT INTO agent_tiers (id, code, name, min_recharge)
        VALUES (99, 'TEST', 'Test Tier', 25)`);
      const token = await issueAuthSession(f.db, f.env, {
        id: 1,
        role: 'user',
        siteAgentId: 0,
        sessionVersion: 0,
      });
      const req = new Request('http://localhost/api/agent/recharge', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const tenant = await resolveTenantContext(req, f.env);
      const retry = () =>
        rechargeAgentTier(f.env, req, tenant, {
          target_tier_id: 99,
          payment_method: 'balance',
        });
      f.interrupt('wallet_transactions');
      await expect(retry()).rejects.toThrow();
      expect(f.balance()).toBe(40);
      expect(f.rawDb.prepare('SELECT count(*) AS n FROM recharge_records').get()?.n).toBe(0);
      f.restore();
      f.interrupt('agents');
      await expect(retry()).rejects.toThrow();
      expect(f.balance()).toBe(40);
      expect(f.rawDb.prepare('SELECT count(*) AS n FROM recharge_records').get()?.n).toBe(0);
      f.restore();
      await retry();
      expect(f.balance()).toBe(15);
      expect(
        f.rawDb.prepare("SELECT amount FROM wallet_transactions WHERE type = 'agent_upgrade'").get()?.amount
      ).toBe(-25);
    } finally {
      f.close();
    }
  });
});
