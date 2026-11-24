import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { commonModalsEn } from '../i18n/namespaces/common-modals/en';
import { commonModalsJa } from '../i18n/namespaces/common-modals/ja';
import { commonModalsKo } from '../i18n/namespaces/common-modals/ko';
import { type CommonModalsDict, commonModalsZhCN } from '../i18n/namespaces/common-modals/zh-CN';
import { commonModalsZhTW } from '../i18n/namespaces/common-modals/zh-TW';
import type { BootstrapPayload } from '../types';
import { AuthModal } from './AuthModal';

const { useDictionary } = vi.hoisted(() => ({ useDictionary: vi.fn<() => CommonModalsDict>() }));

vi.mock('../i18n/namespaces/common-modals', () => ({ useCommonModalsI18n: useDictionary }));

vi.mock('react', async (load) => {
  const react = await load<typeof import('react')>();
  return {
    ...react,
    useState: (initial: unknown) => react.useState(initial === 'login' ? 'register' : initial),
  };
});

const storefront: BootstrapPayload = {
  settings: { brand_name: 'Test Store' },
  tenant: {
    isSubAgent: false,
    agentId: null,
    slug: null,
    brandName: null,
    brandTagline: null,
    markupPercent: 0,
    commissionRate: 0,
  },
  groups: [],
  counts: { featured: 0, all: 0 },
  announcements: [],
  payment_methods: [],
};

function renderRegistration(bootstrap: BootstrapPayload | undefined) {
  const html = renderToStaticMarkup(
    <AuthModal open bootstrap={bootstrap} onClose={vi.fn()} onSuccess={vi.fn()} />
  );
  return {
    label: html.match(/<button[^>]*\btype="submit"[^>]*>([^<]*)<\/button>/)?.[1],
    subtitle: html.match(/<h2[^>]*id="auth-dialog-title"[^>]*>[^<]*<\/h2><p[^>]*>([^<]*)<\/p>/)?.[1],
  };
}

const locales = [
  { locale: 'zh-CN', dictionary: commonModalsZhCN, submitLabel: '注册', sandboxLabel: '沙盒' },
  { locale: 'zh-TW', dictionary: commonModalsZhTW, submitLabel: '註冊', sandboxLabel: '沙箱' },
  { locale: 'en', dictionary: commonModalsEn, submitLabel: 'Register', sandboxLabel: 'sandbox' },
  { locale: 'ja', dictionary: commonModalsJa, submitLabel: '登録', sandboxLabel: 'サンドボックス' },
  { locale: 'ko', dictionary: commonModalsKo, submitLabel: '회원가입', sandboxLabel: '샌드박스' },
];

it.each(locales)('[B52] $locale 注册按钮只显示注册，赠金说明取自公开注册权益', (locale) => {
  useDictionary.mockReturnValue(locale.dictionary);

  for (const bootstrap of [undefined, storefront, { ...storefront, registration: { welcome_credit: 0 } }]) {
    const form = renderRegistration(bootstrap);
    expect(form.label).toBe(locale.submitLabel);
    expect(form.subtitle).toBe(locale.dictionary.authRegisterSub);
    expect(form.subtitle).not.toContain('¥');
  }

  const sandbox = renderRegistration({ ...storefront, registration: { welcome_credit: 37 } });
  expect(sandbox.label).toBe(locale.submitLabel);
  expect(sandbox.subtitle).toMatch(/¥\s*37/);
  expect(sandbox.subtitle).toContain(locale.sandboxLabel);
});

it('分站开启邀请有礼时渲染推荐码输入框，关闭时隐藏', () => {
  useDictionary.mockReturnValue(commonModalsZhCN);
  const enabledHtml = renderToStaticMarkup(
    <AuthModal
      open
      bootstrap={{
        ...storefront,
        settings: { brand_name: 'Sub Store', affiliate_enabled: '1' },
        tenant: { ...storefront.tenant, isSubAgent: true, agentId: 1, slug: 'sub' },
      }}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
  expect(enabledHtml).toContain('id="auth-ref-code"');

  const disabledHtml = renderToStaticMarkup(
    <AuthModal
      open
      bootstrap={{
        ...storefront,
        settings: { brand_name: 'Sub Store', affiliate_enabled: '0' },
        tenant: { ...storefront.tenant, isSubAgent: true, agentId: 1, slug: 'sub' },
      }}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />
  );
  expect(disabledHtml).not.toContain('id="auth-ref-code"');
});
