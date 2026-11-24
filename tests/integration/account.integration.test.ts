import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categories,
  categoryGroups,
  orders,
  paymentPlugins,
  products,
  rechargeCdks,
  userTotpVault,
} from '../../worker/db/schema/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B4 垂直领域集成测试：Account / Wallet / CDK / Tickets / TOTP Vault（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let tokenA: string;
  let userAId: number;
  let tokenB: string;

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();

    await ctx.db.insert(paymentPlugins).values({
      id: 'usdt_trc20',
      name: 'USDT TRC20',
      description: '链上自动核单',
      enabled: 1,
      configJson: JSON.stringify({ usdt_cny_rate: 7.2 }),
    });

    await ctx.db.insert(rechargeCdks).values({
      code: 'CDK-TEST-100',
      amount: 100,
      status: 'available',
    });

    const regA = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'member-a@example.com', password: 'PasswordA123!' }),
    });
    tokenA = regA.data.token;
    userAId = regA.data.user.id;

    const regB = await ctx.jsonRequest<{ token: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'member-b@example.com', password: 'PasswordB123!' }),
    });
    tokenB = regB.data.token;
  });

  afterEach(() => {
    ctx.close();
  });

  it('1. 充值 CDK 原子兑换防双花 + USDT TRC20 并发双单 4 位唯一尾数防撞单入账', async () => {
    // 1.1 CDK 正常兑换入账
    const cdk1 = await ctx.jsonRequest<{ added: number; balance: number }>('/api/account/redeem-cdk', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ code: 'cdk-test-100' }),
    });
    expect(cdk1.status).toBe(200);
    expect(cdk1.data.added).toBe(100);
    expect(cdk1.data.balance).toBe(150);

    // 1.2 重复兑换同一 CDK 被原子拦截返回 409
    const cdkDup = await ctx.jsonRequest('/api/account/redeem-cdk', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ code: 'CDK-TEST-100' }),
    });
    expect(cdkDup.status).toBe(409);

    // 1.3 连续创建 2 笔同金额 USDT 充值单，分配互不相同的 4 位小数尾数金额
    const r1 = await ctx.jsonRequest<{ payment_intent: { intent_no: string; pay_amount: number } }>(
      '/api/account/recharge/intent',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ amount: 50, payment_method: 'usdt_trc20' }),
      }
    );
    const r2 = await ctx.jsonRequest<{ payment_intent: { intent_no: string; pay_amount: number } }>(
      '/api/account/recharge/intent',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ amount: 50, payment_method: 'usdt_trc20' }),
      }
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.data.payment_intent.pay_amount).not.toBe(r2.data.payment_intent.pay_amount);

    // 模拟第 1 笔 USDT 回调入账，验证余额与账单流水
    const sim = await ctx.jsonRequest('/api/payments/sandbox/simulate-pay', {
      method: 'POST',
      body: JSON.stringify({ intent_no: r1.data.payment_intent.intent_no }),
    });
    expect(sim.status).toBe(200);

    const txRes = await ctx.jsonRequest<{ balance: number; transactions: Array<{ type: string }> }>(
      '/api/account/transactions?type=recharge',
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    expect(txRes.status).toBe(200);
    expect(txRes.data.balance).toBe(200); // 50 + 100 CDK + 50 USDT
    expect(txRes.data.transactions.length).toBeGreaterThanOrEqual(2);
  });

  it('2. 售后工单严格订单归属校验、多轮回复、关闭与跨用户水平越权拦截', async () => {
    const [grp] = await ctx.db
      .insert(categoryGroups)
      .values({ slug: 'g1', name: '分组', sortOrder: 1 })
      .returning();
    const [cat] = await ctx.db
      .insert(categories)
      .values({ groupId: grp.id, slug: 'c1', name: '分类', sortOrder: 1 })
      .returning();
    const [prod] = await ctx.db
      .insert(products)
      .values({ categoryId: cat.id, slug: 'p1', title: '测试产品', basePrice: 20 })
      .returning();

    await ctx.db.insert(orders).values({
      orderNo: 'AH-USER-A-001',
      userId: userAId,
      contactEmail: 'member-a@example.com',
      productId: prod.id,
      productTitle: '测试产品',
      specId: 'default',
      specName: '标准版',
      quantity: 1,
      unitPrice: 20,
      totalAmount: 20,
      status: 'delivered',
    });

    // 售后工单缺少订单号被拒 400
    const noOrd = await ctx.jsonRequest('/api/account/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ category: 'after_sale', subject: '无法登录', content: '请帮忙处理' }),
    });
    expect(noOrd.status).toBe(400);

    // 会员 B 试图用会员 A 的订单号提售后工单被拦截 404
    const crossOrd = await ctx.jsonRequest('/api/account/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({
        category: 'after_sale',
        order_no: 'AH-USER-A-001',
        subject: '冒领售后',
        content: '越权测试',
      }),
    });
    expect(crossOrd.status).toBe(404);

    // 会员 A 正常提交工单 -> 查看详情 -> 回复 -> 关闭 -> 关闭后再回复被拒
    const created = await ctx.jsonRequest<{ id: number; ticket_no: string }>('/api/account/tickets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        category: 'after_sale',
        order_no: 'AH-USER-A-001',
        subject: '账号掉订阅',
        content: '刚登录发现会员到期',
      }),
    });
    expect(created.status).toBe(200);
    const tid = created.data.id;

    // 会员 B 越权查看会员 A 工单返回 404
    const idor = await ctx.jsonRequest(`/api/account/tickets/${tid}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    expect(idor.status).toBe(404);

    const detail = await ctx.jsonRequest<{
      ticket: { order_info: { order_no: string } };
      messages: unknown[];
    }>(`/api/account/tickets/${tid}`, { headers: { Authorization: `Bearer ${tokenA}` } });
    expect(detail.status).toBe(200);
    expect(detail.data.ticket.order_info.order_no).toBe('AH-USER-A-001');
    expect(detail.data.messages.length).toBe(1);

    const reply = await ctx.jsonRequest(`/api/account/tickets/${tid}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ content: '补充截图信息' }),
    });
    expect(reply.status).toBe(200);

    const close = await ctx.jsonRequest(`/api/account/tickets/${tid}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(close.status).toBe(200);

    const replyClosed = await ctx.jsonRequest(`/api/account/tickets/${tid}/reply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ content: '关闭后再发' }),
    });
    expect(replyClosed.status).toBe(400);
  });

  it('3. 安全改密、昵称更新与加密 2FA TOTP 保险箱隔离验证', async () => {
    const prof = await ctx.jsonRequest<{ display_name: string }>('/api/account/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ display_name: '尊贵VIP会员' }),
    });
    expect(prof.status).toBe(200);
    expect(prof.data.display_name).toBe('尊贵VIP会员');

    const badPwd = await ctx.jsonRequest('/api/account/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ current_password: 'WrongPassword', new_password: 'NewPassword456!' }),
    });
    expect(badPwd.status).toBe(400);

    const okPwd = await ctx.jsonRequest('/api/account/password', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ current_password: 'PasswordA123!', new_password: 'NewPassword456!' }),
    });
    expect(okPwd.status).toBe(200);
    const revoked = await ctx.request('/api/account/totp-vault', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(revoked.status).toBe(401);
    const login = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'member-a@example.com', password: 'NewPassword456!' }),
    });
    expect(login.status).toBe(200);
    tokenA = login.data.token;

    // 新增加密 2FA 密钥（支持 otpauth URI 提取），验证落库加密且跨用户不可删除
    const addTotp = await ctx.jsonRequest<{ item: { id: string; secret: string } }>(
      '/api/account/totp-vault',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
          issuer: 'OpenAI',
          account_name: 'member-a@example.com',
          secret: 'otpauth://totp/OpenAI:a?secret=JBSWY3DPEHPK3PXP&issuer=OpenAI',
        }),
      }
    );
    expect(addTotp.status).toBe(200);
    expect(addTotp.data.item.secret).toBe('JBSWY3DPEHPK3PXP');

    // 验证数据库密文不是明文
    const rawVault = await ctx.db.select().from(userTotpVault).where(eq(userTotpVault.userId, userAId));
    expect(rawVault.length).toBe(1);
    expect(rawVault[0].encryptedSecret).not.toContain('JBSWY3DPEHPK3PXP');

    // 会员 B 试图删除会员 A 的 2FA 条目无效
    await ctx.jsonRequest(`/api/account/totp-vault/${addTotp.data.item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const listA = await ctx.jsonRequest<{ items: Array<{ id: string; secret: string }> }>(
      '/api/account/totp-vault',
      { headers: { Authorization: `Bearer ${tokenA}` } }
    );
    expect(listA.data.items.length).toBe(1);
    expect(listA.data.items[0].secret).toBe('JBSWY3DPEHPK3PXP');
    expect(listA.headers.get('Cache-Control')).toBe('no-store');

    // 汇总接口校验
    const summary = await ctx.jsonRequest<{ balance: number; totp_count: number }>('/api/account/summary', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(summary.status).toBe(200);
    expect(summary.headers.get('Cache-Control')).toBe('no-store');
    expect(summary.data.totp_count).toBe(1);
  });
});
