import { type SupportedLocale, useNamespace } from '../..';
import { type CommerceDict, commerceZhCN } from './zh-CN';

export type { CommerceDict };

const COMMERCE_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<CommerceDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.commerceZhTW),
  en: () => import('./en').then((m) => m.commerceEn),
  ja: () => import('./ja').then((m) => m.commerceJa),
  ko: () => import('./ko').then((m) => m.commerceKo),
};

/** 营销商品形态（秒杀/口令/套餐/拼团/复购）5 语种 Hook */
export function useCommerceI18n(): CommerceDict {
  return useNamespace(commerceZhCN, COMMERCE_LOADERS);
}
