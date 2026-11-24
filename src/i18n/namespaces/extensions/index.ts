import { type SupportedLocale, useNamespace } from '../..';
import { type ExtensionsDict, extensionsZhCN } from './zh-CN';

export type { ExtensionsDict };

const EXTENSIONS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<ExtensionsDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.extensionsZhTW),
  en: () => import('./en').then((m) => m.extensionsEn),
  ja: () => import('./ja').then((m) => m.extensionsJa),
  ko: () => import('./ko').then((m) => m.extensionsKo),
};

/** 扩展高级能力（选号/多币种/Webhook/2FA/会员价）5 语种 Hook */
export function useExtensionsI18n(): ExtensionsDict {
  return useNamespace(extensionsZhCN, EXTENSIONS_LOADERS);
}
