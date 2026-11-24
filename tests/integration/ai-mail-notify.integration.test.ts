import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paymentPlugins, siteMailConfigs, siteSettings, users } from '../../worker/db/schema/index';
import { updateSaasConfig } from '../../worker/domains/admin/admin.catalog.service';
import { updateAdminNotifyConfig } from '../../worker/domains/admin/admin.support.service';
import { saveAiConfigPublic, testAiConnection } from '../../worker/domains/ai/ai.service';
import { loadPaymentPluginConfig } from '../../worker/domains/payment/payment.gateway';
import { hashPassword } from '../../worker/infra/auth-crypto';
import {
  dispatchOrderDeliveryEmail,
  getSiteMailConfigSafe,
  listSiteMailLogs,
  saveSiteMailConfig,
} from '../../worker/infra/mail';
import { dispatchOpsNotification, getOpsNotifyConfig } from '../../worker/infra/notify';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('B7 垂直领域与基础设施集成测试：AI / Mail / Notify（真实 SQLite/D1 + Drizzle）', () => {
  let ctx: TestAppContext;
  let adminToken: string;

  beforeEach(async ({ task }) => {
    resetRateLimitBucketsForTest();
    ctx = createTestApp();
    if (task.name.startsWith('[S')) return;

    await ctx.db.insert(users).values({
      email: 'root-admin@example.com',
      displayName: '系统总控',
      passwordHash: await hashPassword('AdminPass123!'),
      role: 'admin',
      balance: 0,
    });
    const loginRes = await ctx.jsonRequest<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'root-admin@example.com', password: 'AdminPass123!' }),
    });
    adminToken = loginRes.data.token;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.close();
  });

  it('1. AI 引擎鉴权隔离、配置持久化与脱敏、清空密钥及大模型文案优化闭环', async () => {
    // 非管理员访问必须返回 403
    const unauth = await ctx.jsonRequest('/api/admin/ai/config');
    expect(unauth.status).toBe(403);

    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    // 更新配置并写入敏感 API Key
    const saveRes = await ctx.jsonRequest<{
      ok: boolean;
      config: { provider: string; model: string; has_api_key: boolean; api_key_masked: string };
    }>('/api/admin/ai/config', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({
        provider: 'openai_compatible',
        base_url: 'https://llm.example.test/v1',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        api_key: 'sk-test-secret-key-998877',
      }),
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.data.config.has_api_key).toBe(true);
    expect(saveRes.data.config.api_key_masked).not.toContain('998877');

    // Mock 外部 LLM HTTP 响应，验证连接测试与商品文案结构化 JSON 提取
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('llm.example.test')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: 'Claude Pro 独享成品号（30天质保）',
                    title_en: 'Claude Pro Private Account (30-Day Warranty)',
                    subtitle: '原邮独享、即买即发、支持 2FA 辅助登录',
                    tags: ['原邮独享', '即买即发'],
                    reasoning: '突出交付与质保卖点',
                  }),
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const optRes = await ctx.jsonRequest<{
      ok: boolean;
      suggestion: { title: string; tags: string[] };
    }>('/api/admin/ai/optimize-product', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        scope: 'titles',
        tone: 'editorial',
        product: { title: 'Claude 成品号' },
      }),
    });
    expect(optRes.status).toBe(200);
    expect(optRes.data.suggestion.title).toContain('Claude Pro');
    expect(optRes.data.suggestion.tags).toEqual(['原邮独享', '即买即发']);

    // 清空密钥后再次调用应返回 400 提示未配置 Key
    const clearRes = await ctx.jsonRequest<{ config: { has_api_key: boolean } }>('/api/admin/ai/config', {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ clear_api_key: true }),
    });
    expect(clearRes.status).toBe(200);
    expect(clearRes.data.config.has_api_key).toBe(false);

    const noKeyRes = await ctx.jsonRequest('/api/admin/ai/test', {
      method: 'POST',
      headers: authHeaders,
    });
    expect(noKeyRes.status).toBe(400);
  });

  it('2. 独立发卡邮箱多租户隔离、SSRF 内网拦截、加密脱敏与投递审计日志', async () => {
    // SSRF 防护：内网私有地址必须被拒绝
    await expect(
      saveSiteMailConfig(ctx.env, 0, {
        provider: 'custom_webhook',
        api_endpoint: 'http://127.0.0.1:8080/hook',
      })
    ).rejects.toThrow('安全拦截');

    await expect(
      saveSiteMailConfig(ctx.env, 0, {
        provider: 'custom_webhook',
        api_endpoint: 'http://169.254.169.254/latest/meta-data',
      })
    ).rejects.toThrow('安全拦截');

    // 主站 (ownerAgentId=0) 配置合法外网 Webhook 发信
    const saved = await saveSiteMailConfig(ctx.env, 0, {
      enabled: true,
      auto_send_order: true,
      provider: 'custom_webhook',
      from_name: 'AcctHub 官方发卡',
      from_email: 'noreply@accthub.example',
      api_key: 'mail_secret_token_abcdef',
      api_endpoint: 'https://mail-relay.example.test/send',
    });
    expect(saved.has_api_key).toBe(true);
    expect(saved.api_key_masked).not.toContain('abcdef');

    // 分站 (ownerAgentId=99) 必须完全隔离，不受主站配置影响
    const agentMail = await getSiteMailConfigSafe(ctx.env, 99);
    expect(agentMail.enabled).toBe(false);
    expect(agentMail.has_api_key).toBe(false);

    // Mock 发信并核验 email_delivery_logs 审计记录
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sendRes = await dispatchOrderDeliveryEmail(ctx.env, {
      ownerAgentId: 0,
      brandName: 'AcctHub',
      toEmail: 'buyer@example.com',
      orderNo: 'ORD-MAIL-001',
      productTitle: 'Claude Pro 月卡',
      specName: '标准版',
      quantity: 1,
      totalAmount: 129,
      deliveredPayload: 'demo@acct.ai----Pass123',
    });
    expect(sendRes.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const logs = await listSiteMailLogs(ctx.env, 0, 10);
    expect(logs).toHaveLength(1);
    expect(logs[0].order_no).toBe('ORD-MAIL-001');
    expect(logs[0].status).toBe('sent');
  });

  it('[S14] stores AI, Cloudflare and Telegram credentials as ciphertext', async () => {
    await saveAiConfigPublic(ctx.env, { api_key: 'synthetic-ai-credential' });
    await updateSaasConfig(ctx.env, { cf_saas_api_token: 'synthetic-cf-credential' });
    await updateAdminNotifyConfig(ctx.env, { tg_bot_token: 'synthetic-notify-credential' });
    for (const key of ['ai_api_key', 'cf_saas_api_token', 'notify_tg_bot_token']) {
      const [row] = await ctx.db.select().from(siteSettings).where(eq(siteSettings.key, key));
      expect(row.value).toMatch(/^v3\./);
    }
  });

  it('[S24] sends the configured Gemini key in its authentication header', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: '测试成功' }] } }] }));
    await saveAiConfigPublic(ctx.env, {
      provider: 'gemini',
      base_url: 'https://gemini.example.test/v1beta',
      api_key: 'gemini-test-key',
    });
    expect((await testAiConnection(ctx.env)).ok).toBe(true);
    const [target, outgoing] = fetchSpy.mock.calls[0];
    expect(new URL(String(target)).search).toBe('');
    expect(new Headers(outgoing?.headers).get('x-goog-api-key')).toBe('gemini-test-key');
  });

  it('[S29] 自定义邮件地址必须使用 HTTPS', async () => {
    await expect(
      saveSiteMailConfig(ctx.env, 0, {
        provider: 'custom_webhook',
        api_endpoint: 'http://mail.example.test/send',
      })
    ).rejects.toThrow(/HTTPS/i);
  });

  it.each(['resend', 'brevo', 'mailgun', 'custom_webhook'] as const)(
    '[S29] %s 的 307 响应不会触发跳转，投递保留待重试状态',
    async (provider) => {
      await saveSiteMailConfig(ctx.env, 0, {
        enabled: true,
        provider,
        from_email: 'noreply@example.test',
        api_key: 'synthetic-key',
        ...(provider === 'mailgun' ? { mailgun_domain: 'example.test' } : {}),
        ...(provider === 'custom_webhook' ? { api_endpoint: 'https://mail.example.test/send' } : {}),
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: 'https://redirect.example.test/never-send' },
        })
      );
      const result = await dispatchOrderDeliveryEmail(ctx.env, {
        ownerAgentId: 0,
        brandName: '测试',
        toEmail: 'buyer@example.test',
        orderNo: 'TEST',
        productTitle: '测试',
        specName: '测试',
        quantity: 1,
        totalAmount: 1,
        deliveredPayload: 'fixture',
      });
      expect(result).toMatchObject({ ok: false, mail_status: 'pending', error: '发信服务返回 HTTP 307' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0]?.[1]?.redirect).toBe('manual');
    }
  );

  it('[S34] clears the stored key when a different AI provider or endpoint is saved', async () => {
    const save = (body: Record<string, string>) => saveAiConfigPublic(ctx.env, body);
    await save({ base_url: 'https://llm.example.test/v1', api_key: 'scoped-synthetic-credential' });
    expect((await save({ base_url: 'https://LLM.example.test:443/v1/' })).has_api_key).toBe(true);
    expect((await save({ base_url: 'https://llm.example.test/v2' })).has_api_key).toBe(false);
    const transport = vi.spyOn(globalThis, 'fetch');
    await expect(testAiConnection(ctx.env)).rejects.toThrow('尚未配置');
    expect(transport).not.toHaveBeenCalled();
  });

  it('[S35] only exposes safe payment settings and keeps credentials on blank edits', async () => {
    const headers = await ctx.adminHeaders();
    await ctx.db.insert(paymentPlugins).values({
      id: 'stripe',
      name: 'Stripe',
      description: '测试支付配置',
      configJson: JSON.stringify({
        currency: 'usd',
        secret_key: 'fixture-private-key',
        webhook_secret: 'fixture-webhook-key',
      }),
    });
    const readOverview = () =>
      ctx.jsonRequest<{
        payment_plugins: Array<{
          id: string;
          config_json: string;
          secrets_configured: Record<string, boolean>;
        }>;
      }>('/api/admin/overview', { headers });
    const update = (config: Record<string, string>) =>
      ctx.jsonRequest('/api/admin/payment-plugins/stripe', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config }),
      });
    const overview = await readOverview();
    expect(overview.ok).toBe(true);
    expect(JSON.stringify(overview.data)).not.toContain('fixture-private-key');
    expect(JSON.stringify(overview.data)).not.toContain('fixture-webhook-key');
    const plugin = overview.data.payment_plugins.find(({ id }) => id === 'stripe');
    expect(JSON.parse(plugin?.config_json ?? '{}')).toMatchObject({ currency: 'usd' });
    expect(plugin?.secrets_configured).toEqual({ secret_key: true, webhook_secret: true });
    expect((await update({ currency: 'cny', secret_key: '' })).ok).toBe(true);
    expect((await update({ webhook_secret: 'replacement-key' })).ok).toBe(true);
    const [persisted] = await ctx.db.select().from(paymentPlugins).where(eq(paymentPlugins.id, 'stripe'));
    expect(JSON.parse(persisted.configJson).webhook_secret).toMatch(/^v3\./);
    expect(persisted.configJson).not.toContain('replacement-key');
    expect((await loadPaymentPluginConfig(ctx.env, 'stripe')).config).toMatchObject({
      currency: 'cny',
      secret_key: 'fixture-private-key',
      webhook_secret: 'replacement-key',
    });
  });

  it('[S29] refuses a legacy HTTP mail setting at dispatch', async () => {
    await ctx.db.insert(siteMailConfigs).values({
      ownerAgentId: 0,
      enabled: 1,
      provider: 'custom_webhook',
      apiEndpoint: 'http://mail.example.test/send',
      fromEmail: 'noreply@example.test',
    });
    const transport = vi.spyOn(globalThis, 'fetch');
    const result = await dispatchOrderDeliveryEmail(ctx.env, {
      ownerAgentId: 0,
      brandName: '测试',
      toEmail: 'buyer@example.test',
      orderNo: 'TEST',
      productTitle: '测试',
      specName: '测试',
      quantity: 1,
      totalAmount: 1,
      deliveredPayload: 'fixture',
    });
    expect(result.ok).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  });

  it('3. 运维告警通知按事件订阅过滤并安全推送 Webhook（异常绝不阻断主流程）', async () => {
    await ctx.db.insert(siteSettings).values([
      { key: 'notify_webhook_url', value: 'https://ops-hook.example.test/alert' },
      { key: 'notify_events_json', value: JSON.stringify(['new_order', 'upstream_alert']) },
      { key: 'notify_low_stock_threshold', value: '5' },
    ]);

    const cfg = await getOpsNotifyConfig(ctx.env);
    expect(cfg.lowStockThreshold).toBe(5);
    expect(cfg.events).toEqual(['new_order', 'upstream_alert']);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));

    // 未订阅事件 withdrawal 应静默跳过
    const skipped = await dispatchOpsNotification(ctx.env, 'withdrawal', '提现提醒', ['¥100']);
    expect(skipped.sentWebhook).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 已订阅事件 new_order 正常推送
    const sent = await dispatchOpsNotification(ctx.env, 'new_order', '新订单成交', ['ORD-1']);
    expect(sent.sentWebhook).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
