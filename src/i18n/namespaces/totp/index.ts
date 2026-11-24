import { useNamespace } from '../../index';
import { type TotpDict, totpZhCN } from './zh-CN';

/** 2FA 工具模块 5 语种按需加载字典 Hook */
export function useTotpI18n(): TotpDict {
  return useNamespace(totpZhCN, {
    'zh-TW': () => import('./zh-TW').then((m) => m.totpZhTW),
    en: () => import('./en').then((m) => m.totpEn),
    ja: () => import('./ja').then((m) => m.totpJa),
    ko: () => import('./ko').then((m) => m.totpKo),
  });
}

export type { TotpDict };
