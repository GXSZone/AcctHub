import { type SupportedLocale, useNamespace } from '../..';
import { type AccountDict, accountZhCN } from './zh-CN';

const ACCOUNT_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AccountDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.accountZhTW),
  en: () => import('./en').then((m) => m.accountEn),
  ja: () => import('./ja').then((m) => m.accountJa),
  ko: () => import('./ko').then((m) => m.accountKo),
};

/** 会员中心与订单查询按域懒加载 5 语种 Hook */
export function useAccountI18n(): AccountDict {
  return useNamespace(accountZhCN, ACCOUNT_LOADERS);
}
