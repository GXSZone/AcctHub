import { type SupportedLocale, useNamespace } from '../..';
import { type OAuthDict, oauthZhCN } from './zh-CN';

export type { OAuthDict };

const OAUTH_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<OAuthDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.oauthZhTW),
  en: () => import('./en').then((m) => m.oauthEn),
  ja: () => import('./ja').then((m) => m.oauthJa),
  ko: () => import('./ko').then((m) => m.oauthKo),
};

/** 第三方 OAuth 授权登录 5 语种 Hook */
export function useOAuthI18n(): OAuthDict {
  return useNamespace(oauthZhCN, OAUTH_LOADERS);
}
