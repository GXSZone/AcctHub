import { afterEach, describe, expect, it, vi } from 'vitest';
import { importAdminProductCards } from '../../worker/domains/admin/admin.product.service';
import { resendAdminOrderEmail } from '../../worker/domains/admin/admin.support.service';
import { upsertRestockSubscriptionRepo } from '../../worker/domains/storefront/storefront.repo';
import { sealDeliveryPayload } from '../../worker/infra/credential-storage';
import { dispatchOrderDeliveryEmail, saveSiteMailConfig } from '../../worker/infra/mail';
import { drainMailOutbox } from '../../worker/infra/mail.outbox';
import { createTestApp } from './helpers/test-app';

describe('邮件投递与补货订阅', () => {
  afterEach(() => vi.restoreAllMocks());

  const configure = (env: ReturnType<typeof createTestApp>['env'], owner: number) =>
    saveSiteMailConfig(env, owner, {
      enabled: true,
      provider: 'custom_webhook',
      from_name: `站点 ${owner}`,
      from_email: `shop${owner}@example.test`,
      api_endpoint: `https://inbox.example.test/${owner}`,
    });

  it('[B09] 同站重复订阅只保留一行，同邮箱跨站分别登记', async () => {
    const ctx = createTestApp();
    try {
      const item = { productId: 700, specId: 'annual', email: 'buyer@example.test' };
      await upsertRestockSubscriptionRepo(ctx.db, { ...item, siteAgentId: 0 });
      await upsertRestockSubscriptionRepo(ctx.db, { ...item, siteAgentId: 12 });
      await upsertRestockSubscriptionRepo(ctx.db, { ...item, siteAgentId: 12 });
      const rows = await ctx.d1.prepare('SELECT site_agent_id FROM restock_subscriptions ORDER BY id').all();
      expect(rows.results).toEqual([{ site_agent_id: 0 }, { site_agent_id: 12 }]);
    } finally {
      ctx.close();
    }
  });

  it('[B08] 精确补货规格的全部订阅入队，失败的收件人单独重试', async () => {
    const ctx = createTestApp();
    try {
      await configure(ctx.env, 0);
      await configure(ctx.env, 12);
      const seen: Array<{ to: string; from_name: string }> = [];
      let fail = true;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_request, init) => {
        const mail = JSON.parse(String(init?.body)) as (typeof seen)[number];
        seen.push(mail);
        return new Response(null, { status: fail && mail.to === 'user51@example.test' ? 503 : 200 });
      });
      for (let index = 0; index < 52; index++) {
        await upsertRestockSubscriptionRepo(ctx.db, {
          productId: 700,
          specId: 'annual',
          siteAgentId: index % 2 ? 12 : 0,
          email: `user${index}@example.test`,
        });
      }
      await upsertRestockSubscriptionRepo(ctx.db, {
        productId: 700,
        specId: 'month',
        siteAgentId: 0,
        email: 'other-spec@example.test',
      });
      const jobs: Promise<unknown>[] = [];
      await importAdminProductCards(ctx.env, 700, { spec_id: 'annual', lines: 'fake-card' }, (job) => {
        jobs.push(job);
      });
      await Promise.all(jobs);
      expect(seen).toHaveLength(52);
      expect(seen).toContainEqual(
        expect.objectContaining({ to: 'user51@example.test', from_name: '站点 12' })
      );
      expect(
        await ctx.d1
          .prepare('SELECT status FROM restock_subscriptions WHERE email = ?')
          .bind('user51@example.test')
          .first('status')
      ).toBe('queued');
      expect(
        await ctx.d1
          .prepare('SELECT status FROM restock_subscriptions WHERE email = ?')
          .bind('other-spec@example.test')
          .first('status')
      ).toBe('waiting');
      fail = false;
      await ctx.d1
        .prepare('UPDATE mail_outbox SET next_attempt_at = 0 WHERE status = ?')
        .bind('pending')
        .run();
      await drainMailOutbox(ctx.env);
      expect(seen).toHaveLength(53);
      expect(seen.at(-1)?.to).toBe('user51@example.test');
      expect(
        await ctx.d1
          .prepare('SELECT status FROM restock_subscriptions WHERE email = ?')
          .bind('user51@example.test')
          .first('status')
      ).toBe('notified');
    } finally {
      ctx.close();
    }
  });

  it('[MAIL] 相同订单交付在并发时只投递一次，失败后可从队列恢复全文', async () => {
    const ctx = createTestApp();
    try {
      await configure(ctx.env, 0);
      const seen: Array<{ to: string; text: string }> = [];
      let allowSend = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_request, init) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: allowSend ? 200 : 503 });
      });
      const message = {
        ownerAgentId: 0,
        brandName: '店铺',
        toEmail: 'buyer@example.test',
        orderNo: 'ACCT-PUBLIC-TEST',
        productTitle: '测试商品',
        specName: '年卡',
        quantity: 2,
        totalAmount: 18,
        deliveredPayload: 'fake-password <&>\nfake-code-two',
      };
      await Promise.all([
        dispatchOrderDeliveryEmail(ctx.env, message),
        dispatchOrderDeliveryEmail(ctx.env, message),
      ]);
      expect(seen).toHaveLength(1);
      const pending = await ctx.d1.prepare('SELECT payload FROM mail_outbox').first('payload');
      expect(pending).toBeTruthy();
      expect(pending).not.toContain('fake-password');
      allowSend = true;
      await ctx.d1.prepare('UPDATE mail_outbox SET next_attempt_at = 0').run();
      await drainMailOutbox(ctx.env);
      expect(seen).toHaveLength(2);
      expect(seen[1]?.to).toBe(message.toEmail);
      expect(seen[1]?.text).toContain(message.orderNo);
      expect(seen[1]?.text).toContain(message.deliveredPayload);
      expect(await ctx.d1.prepare('SELECT payload FROM mail_outbox').first('payload')).toBe('');
    } finally {
      ctx.close();
    }
  });

  it('[MAIL] 密码保护订单先发送公开单号，只有交付后的邮件才发送完整凭证，失败后可由后台重试', async () => {
    const ctx = createTestApp();
    try {
      await configure(ctx.env, 0);
      const seen: Array<{ to: string; text: string; scene: string }> = [];
      let failDelivery = true;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_request, init) => {
        const mail = JSON.parse(String(init?.body)) as (typeof seen)[number];
        seen.push(mail);
        return new Response(null, { status: failDelivery && mail.scene === 'order_delivery' ? 503 : 200 });
      });
      await ctx.d1
        .prepare(
          `INSERT INTO orders
          (order_no, public_order_no, contact_email, query_password_hash, product_id, product_title, unit_price, total_amount, status)
          VALUES (?, ?, ?, ?, 700, '年卡', 18, 18, 'processing')`
        )
        .bind('INTERNAL-901', 'PUBLIC-TEST-901', 'original@example.test', 'fake-query-password-hash')
        .run();
      await ctx.d1
        .prepare("UPDATE orders SET status = 'pending_payment' WHERE order_no = ?")
        .bind('INTERNAL-901')
        .run();
      await drainMailOutbox(ctx.env);
      expect(seen.map((mail) => mail.scene)).toEqual(['order_created']);
      expect(seen[0]?.text).toContain('PUBLIC-TEST-901');
      expect(seen[0]?.text).not.toContain('fake-query-password-hash');
      expect(seen[0]?.text).not.toContain('INTERNAL-901');

      const credentials = 'demo-account@example.test\nDemoPassword#123\n2FA:TESTSEED';
      await ctx.d1
        .prepare("UPDATE orders SET status = 'delivered', delivered_payload = ? WHERE order_no = ?")
        .bind(await sealDeliveryPayload(ctx.env, 'INTERNAL-901', credentials), 'INTERNAL-901')
        .run();
      await drainMailOutbox(ctx.env);
      expect(seen.map((mail) => mail.scene)).toEqual(['order_created', 'order_delivery']);
      expect(seen[1]?.to).toBe('original@example.test');
      expect(seen[1]?.text).toContain('PUBLIC-TEST-901');
      expect(seen[1]?.text).toContain(credentials);
      expect(seen[1]?.text).not.toContain('INTERNAL-901');
      failDelivery = false;
      await expect(resendAdminOrderEmail(ctx.env, 'INTERNAL-901')).resolves.toMatchObject({
        mail_status: 'sent',
      });
      expect(seen).toHaveLength(3);
      expect(seen[2]).toEqual(seen[1]);
      expect(
        await ctx.d1
          .prepare('SELECT status FROM orders WHERE order_no = ?')
          .bind('INTERNAL-901')
          .first('status')
      ).toBe('delivered');
    } finally {
      ctx.close();
    }
  });

  it('[MAIL] 换新邮件由队列重试成功后同步换新状态', async () => {
    const ctx = createTestApp();
    try {
      await configure(ctx.env, 0);
      await ctx.d1
        .prepare(
          `INSERT INTO orders
          (order_no, public_order_no, contact_email, product_id, product_title, unit_price, total_amount, status)
          VALUES ('INTERNAL-902', 'PUBLIC-TEST-902', 'buyer@example.test', 700, '年卡', 18, 18, 'processing')`
        )
        .run();
      const replacement = await ctx.d1
        .prepare(
          `INSERT INTO upstream_orders
          (idempotency_out_trade_no, source_id, status, purpose, replacement_order_no, replacement_mail_status)
          VALUES ('REPLACEMENT-902', 1, 'succeeded', 'after_sale_replace', 'INTERNAL-902', 'pending')
          RETURNING id`
        )
        .first<number>('id');
      expect(replacement).toBeGreaterThan(0);
      const send = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
      await expect(
        dispatchOrderDeliveryEmail(ctx.env, {
          ownerAgentId: 0,
          brandName: '店铺',
          toEmail: 'buyer@example.test',
          orderNo: 'PUBLIC-TEST-902',
          productTitle: '年卡',
          specName: '年付',
          quantity: 1,
          totalAmount: 0,
          deliveredPayload: 'fake-replacement',
          scene: 'order_replacement',
          eventKey: String(replacement),
        })
      ).resolves.toMatchObject({ mail_status: 'pending' });
      send.mockResolvedValueOnce(new Response(null, { status: 202 }));
      await ctx.d1
        .prepare("UPDATE mail_outbox SET next_attempt_at = 0 WHERE scene = 'order_replacement'")
        .run();
      await drainMailOutbox(ctx.env);
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        await ctx.d1
          .prepare("SELECT event_key, status FROM mail_outbox WHERE scene = 'order_replacement'")
          .first()
      ).toEqual({
        event_key: `order_replacement:PUBLIC-TEST-902:${replacement}`,
        status: 'sent',
      });
      expect(
        await ctx.d1
          .prepare('SELECT replacement_mail_status FROM upstream_orders WHERE id = ?')
          .bind(replacement)
          .first('replacement_mail_status')
      ).toBe('sent');
    } finally {
      ctx.close();
    }
  });
});
