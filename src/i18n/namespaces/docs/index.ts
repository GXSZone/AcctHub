import { type SupportedLocale, useNamespace } from '../..';
import { type DocsDict, docsZhCN } from './zh-CN';

const DOCS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<DocsDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.docsZhTW),
  en: () => import('./en').then((m) => m.docsEn),
  ja: () => import('./ja').then((m) => m.docsJa),
  ko: () => import('./ko').then((m) => m.docsKo),
};

/** 开放平台 API 文档按域懒加载 5 语种 Hook */
export function useDocsI18n(): DocsDict {
  return useNamespace(docsZhCN, DOCS_LOADERS);
}
