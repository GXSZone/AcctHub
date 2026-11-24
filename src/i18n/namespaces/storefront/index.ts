import { type SupportedLocale, useNamespace } from '../..';
import { type StorefrontDict, storefrontZhCN } from './zh-CN';

const STOREFRONT_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<StorefrontDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.storefrontZhTW),
  en: () => import('./en').then((m) => m.storefrontEn),
  ja: () => import('./ja').then((m) => m.storefrontJa),
  ko: () => import('./ko').then((m) => m.storefrontKo),
};

/** 商城详情、结账台与 2FA 工具按域懒加载 5 语种 Hook */
export function useStorefrontI18n(): StorefrontDict {
  return useNamespace(storefrontZhCN, STOREFRONT_LOADERS);
}
