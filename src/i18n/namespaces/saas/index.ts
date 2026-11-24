import { type SupportedLocale, useNamespace } from '../..';
import { type SaasDict, saasZhCN } from './zh-CN';

export type { SaasDict };

const SAAS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<SaasDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.saasZhTW),
  en: () => import('./en').then((m) => m.saasEn),
  ja: () => import('./ja').then((m) => m.saasJa),
  ko: () => import('./ko').then((m) => m.saasKo),
};

/** SaaS 多租户域名授权、跨站 SSO、私有商品与自有收款 5 语种 Hook */
export function useSaasI18n(): SaasDict {
  return useNamespace(saasZhCN, SAAS_LOADERS);
}
