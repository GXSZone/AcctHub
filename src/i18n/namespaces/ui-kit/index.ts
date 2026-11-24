import { useNamespace } from '../../index';
import { type UiKitDict, uiKitZhCN } from './zh-CN';

/** 通用 UI 原语、编辑器、品牌与商品预览 5 语种按需加载字典 Hook */
export function useUiKitI18n(): UiKitDict {
  return useNamespace(uiKitZhCN, {
    'zh-TW': () => import('./zh-TW').then((m) => m.uiKitZhTW),
    en: () => import('./en').then((m) => m.uiKitEn),
    ja: () => import('./ja').then((m) => m.uiKitJa),
    ko: () => import('./ko').then((m) => m.uiKitKo),
  });
}

export type { UiKitDict };
