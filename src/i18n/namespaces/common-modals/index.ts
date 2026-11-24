import { type SupportedLocale, useNamespace } from '../..';
import { type CommonModalsDict, commonModalsZhCN } from './zh-CN';

export type { CommonModalsDict };

const MODALS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<CommonModalsDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.commonModalsZhTW),
  en: () => import('./en').then((m) => m.commonModalsEn),
  ja: () => import('./ja').then((m) => m.commonModalsJa),
  ko: () => import('./ko').then((m) => m.commonModalsKo),
};

/** 全局弹窗、导航栏与冷启动向导按域懒加载 5 语种 Hook */
export function useCommonModalsI18n(): CommonModalsDict {
  return useNamespace(commonModalsZhCN, MODALS_LOADERS);
}
