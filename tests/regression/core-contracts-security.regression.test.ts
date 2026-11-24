import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentWithdrawalInputSchema,
  aiOptimizeProductInputSchema,
  createOrderInputSchema,
  ERROR_CODE_I18N,
  ERROR_CODES,
  MAIL_PROVIDERS,
  resolveLocalizedField,
  resolveRequestLang,
  resolveRequestLocale,
  SUPPORTED_LOCALES,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  translateApiErrorMessage,
  UPSTREAM_AUTH_MODES,
  UPSTREAM_OUT_OF_STOCK_ACTIONS,
  UPSTREAM_SANDBOX_MODES,
  upsertUpstreamSourceSchema,
  WALLET_TX_TYPES,
} from '../../shared/index';
import { en } from '../../src/i18n/locales/en';
import { ja } from '../../src/i18n/locales/ja';
import { ko } from '../../src/i18n/locales/ko';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import { zhTW } from '../../src/i18n/locales/zh-TW';
import { verifyAndParseUpstreamWebhook } from '../../worker/domains/upstream/upstream.catalog.adapter';
import { signUpstreamParams } from '../../worker/domains/upstream/upstream.signer';
import { encryptSecret } from '../../worker/infra/crypto';
import { assertSafeOutboundUrl } from '../../worker/infra/http';

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (full.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('AcctHub 42 项审计问题永久回归测试套件', () => {
  it('1. 数据库迁移与 Schema 一致性：无冲突 0001_init.sql、无 upstream_sources.api_key 幽灵列（P0-11 回归）', () => {
    const root = process.cwd();
    expect(existsSync(join(root, 'migrations', '0000_accthub_baseline.sql'))).toBe(true);
    expect(existsSync(join(root, 'migrations', '0001_init.sql'))).toBe(false);

    const initSql = readFileSync(join(root, 'migrations', '0000_accthub_baseline.sql'), 'utf8');
    expect(initSql).toContain('`warranty_type` text');
    expect(initSql).toContain('`warranty_days` integer');
    expect(initSql).toContain('`warranty_summary` text');
    expect(initSql).toContain('uq_orders_reseller_idempotency');

    // 扫描 worker/ 下所有 TS 源码，严禁再引用已废弃的 s.api_key 或 upstream_sources ADD COLUMN api_key
    const workerFiles = collectTsFiles(join(root, 'worker'));
    for (const file of workerFiles) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\bs\.api_key\b/);
      expect(content).not.toMatch(/upstream_sources\s+ADD\s+COLUMN\s+api_key\b/i);
    }
  });

  it('2. 共享枚举与 Zod 契约全栈对齐：上游鉴权、工单状态、下单正整数数量、提现门槛（P0-07 / P1-16 回归）', () => {
    expect(UPSTREAM_AUTH_MODES).toContain('header_custom');
    expect(UPSTREAM_AUTH_MODES).toContain('acgfaka_sign');
    expect(UPSTREAM_OUT_OF_STOCK_ACTIONS).toContain('auto_unpublish');
    expect(UPSTREAM_SANDBOX_MODES).toContain('always_fail');
    expect(UPSTREAM_SANDBOX_MODES).toContain('always_async');
    expect(TICKET_STATUSES).toEqual(
      expect.arrayContaining(['open', 'agent_replied', 'escalated', 'admin_replied', 'resolved', 'closed'])
    );
    for (const st of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABELS[st]).toBeTruthy();
    }
    expect(MAIL_PROVIDERS).toContain('brevo');
    expect(MAIL_PROVIDERS).toContain('custom_webhook');
    expect(WALLET_TX_TYPES).toEqual(expect.arrayContaining(['cdk', 'refund', 'withdraw', 'withdraw_refund']));

    // 下单契约必须拒绝小数 quantity（如 1.01）、0、负数与超上限数量
    expect(
      createOrderInputSchema.safeParse({
        product_id: 1,
        quantity: 1.01,
        contact_email: 'user@example.com',
      }).success
    ).toBe(false);
    expect(
      createOrderInputSchema.safeParse({
        product_id: 1,
        quantity: 0,
        contact_email: 'user@example.com',
      }).success
    ).toBe(false);
    expect(
      createOrderInputSchema.safeParse({
        product_id: 1,
        quantity: 2,
        contact_email: 'user@example.com',
        custom_inputs: { target_account: 'demo@openai.com' },
      }).success
    ).toBe(true);

    // 提现最低金额必须 >= 10
    expect(
      agentWithdrawalInputSchema.safeParse({
        amount: 9.99,
        channel: 'alipay',
        account_info: 'test@alipay.com',
      }).success
    ).toBe(false);
    expect(
      agentWithdrawalInputSchema.safeParse({
        amount: 10,
        channel: 'alipay',
        account_info: 'test@alipay.com',
      }).success
    ).toBe(true);

    // 上游货源与 AI 契约兼容前端表单载荷
    expect(
      upsertUpstreamSourceSchema.safeParse({
        name: '测试上游',
        adapter_type: 'accthub_v1',
        base_url: 'https://upstream.example.com',
        auth_mode: 'header_custom',
        out_of_stock_action: 'auto_unpublish',
        sandbox_mode: 'always_async',
      }).success
    ).toBe(true);
    expect(
      aiOptimizeProductInputSchema.safeParse({
        product: { title: 'Claude Pro 独享席位' },
      }).success
    ).toBe(true);
  });

  it('3. SSRF 出站安全守卫：拦截云元数据、内网 IPv4/IPv6、本地环回与非 HTTP 协议（P1-06 回归）', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
    expect(() => assertSafeOutboundUrl('http://0.0.0.0:8080/api')).toThrow();
    expect(() => assertSafeOutboundUrl('http://metadata.google.internal/computeMetadata/v1/')).toThrow();
    expect(() => assertSafeOutboundUrl('http://127.0.0.1:9000/hook', false)).toThrow();
    expect(() => assertSafeOutboundUrl('http://localhost:3000/hook', false)).toThrow();
    expect(() => assertSafeOutboundUrl('http://10.0.0.12/admin', false)).toThrow();
    expect(() => assertSafeOutboundUrl('http://192.168.1.1/router', false)).toThrow();
    expect(() => assertSafeOutboundUrl('http://172.20.0.5/internal', false)).toThrow();
    expect(() => assertSafeOutboundUrl('http://[::1]:8080/test', false)).toThrow();
    expect(() => assertSafeOutboundUrl('file:///etc/passwd', false)).toThrow();

    expect(assertSafeOutboundUrl('https://api.resend.com/emails', false).hostname).toBe('api.resend.com');
  });

  it('4. 上游 Webhook 回调验签：严禁空白 webhook_secret 绕过验签（P0-02 回归）', async () => {
    const mockEnv = { APP_ENV: 'development', JWT_SECRET: 'test-jwt-secret-key-for-regression' } as never;
    const bodyObj = {
      out_trade_no: 'ORD-LOCAL-001',
      trade_no: 'UP-12345',
      status: 'delivered',
      cards: ['CARD-SECRET-001'],
    };

    // 当源未配置 webhook_secret_enc（空字符串）时，必须强制拒绝（verified: false）
    const emptySecretSource = {
      id: 1,
      adapter_type: 'accthub_v1',
      webhook_secret_enc: '',
      api_secret_enc: '',
      api_key_enc: '',
    };
    const resEmpty = await verifyAndParseUpstreamWebhook(
      mockEnv,
      emptySecretSource as never,
      bodyObj,
      new Headers()
    );
    expect(resEmpty.verified).toBe(false);

    // 配置了加密密钥但签名错误时必须拒绝
    const encryptedWhSec = await encryptSecret(mockEnv, 'whsec_test_strong_secret_key');
    const securedSource = {
      id: 1,
      adapter_type: 'accthub_v1',
      webhook_secret_enc: encryptedWhSec,
      api_secret_enc: '',
      api_key_enc: '',
    };
    const badHeaders = new Headers({ 'X-Webhook-Signature': 'deadbeef' });
    const resBad = await verifyAndParseUpstreamWebhook(mockEnv, securedSource as never, bodyObj, badHeaders);
    expect(resBad.verified).toBe(false);

    // 携带正确 HMAC-SHA256 签名时验签通过
    const validSig = await signUpstreamParams('hmac_sha256', bodyObj, 'whsec_test_strong_secret_key');
    const goodHeaders = new Headers({ 'X-Webhook-Signature': validSig });
    const resGood = await verifyAndParseUpstreamWebhook(
      mockEnv,
      securedSource as never,
      bodyObj,
      goodHeaders
    );
    expect(resGood.verified).toBe(true);
    expect(resGood.cards).toEqual(['CARD-SECRET-001']);
  });

  it('5. 国际化 i18n 5 语种全量对称性、translations_json 回退与 API 错误消息多语种校验（Phase 2 回归）', () => {
    // 校验 5 个独立语言包（zh-CN / zh-TW / en / ja / ko）词条键完全对称且非空
    const packs = { 'zh-CN': zhCN, 'zh-TW': zhTW, en, ja, ko };
    const baseKeys = Object.keys(zhCN).sort();
    for (const loc of SUPPORTED_LOCALES) {
      const pack = packs[loc];
      expect(Object.keys(pack).sort()).toEqual(baseKeys);
      for (const k of baseKeys) {
        expect(pack[k as keyof typeof zhCN].trim().length).toBeGreaterThan(0);
      }
    }

    // 校验所有标准 ERROR_CODES 均具备非空的 5 语种消息定义
    for (const code of Object.values(ERROR_CODES)) {
      for (const loc of SUPPORTED_LOCALES) {
        expect(ERROR_CODE_I18N[code][loc].trim().length).toBeGreaterThan(0);
      }
    }

    // 校验请求头 5 语种解析与 API 错误消息多语种转换
    expect(resolveRequestLang(new Headers({ 'X-Lang': 'en' }))).toBe('en');
    expect(resolveRequestLang(new Headers({ 'Accept-Language': 'en-US,en;q=0.9' }))).toBe('en');
    expect(resolveRequestLang(new Headers())).toBe('zh');
    expect(resolveRequestLocale(new Headers({ 'X-Lang': 'ja' }))).toBe('ja');
    expect(resolveRequestLocale(new Headers({ 'X-Lang': 'ko' }))).toBe('ko');
    expect(resolveRequestLocale(new Headers({ 'X-Lang': 'zh-TW' }))).toBe('zh-TW');

    expect(translateApiErrorMessage('当前代理分站已暂停营业', 'FORBIDDEN', 'en', 403)).toBe(
      'This partner storefront is currently suspended.'
    );
    expect(translateApiErrorMessage('当前代理分站已暂停营业', 'FORBIDDEN', 'ja', 403)).toContain(
      'パートナーストア'
    );
    expect(translateApiErrorMessage('账户钱包余额不足', 'INSUFFICIENT_BALANCE', 'ko', 402)).toContain(
      '지갑 잔액'
    );
    expect(translateApiErrorMessage('Product not found', 'NOT_FOUND', 'zh', 404)).toBe('商品不存在或已下架');

    // 校验 translations_json 三级自动回退（目标语种 -> 英文 -> 简体中文）
    const transJson = JSON.stringify({
      ja: { title: 'Claude Pro 専用シート' },
      en: { title: 'Claude Pro Dedicated Seat' },
    });
    expect(
      resolveLocalizedField({
        locale: 'ja',
        baseZh: 'Claude Pro 独享',
        translationsJson: transJson,
        field: 'title',
      })
    ).toBe('Claude Pro 専用シート');
    expect(
      resolveLocalizedField({
        locale: 'ko',
        baseZh: 'Claude Pro 独享',
        translationsJson: transJson,
        field: 'title',
      })
    ).toBe('Claude Pro Dedicated Seat');
    expect(
      resolveLocalizedField({
        locale: 'zh-TW',
        baseZh: 'Claude Pro 独享',
        translationsJson: transJson,
        field: 'title',
      })
    ).toBe('Claude Pro 独享');
  });
});
