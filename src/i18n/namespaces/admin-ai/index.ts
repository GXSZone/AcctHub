import { type SupportedLocale, useNamespace } from '../..';
import { type AdminAiDict, adminAiZhCN } from './zh-CN';

const ADMIN_AI_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AdminAiDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminAiZhTW),
  en: () => import('./en').then((m) => m.adminAiEn),
  ja: () => import('./ja').then((m) => m.adminAiJa),
  ko: () => import('./ko').then((m) => m.adminAiKo),
};

/** 运营总控 AI 文案引擎配置、接口测试与试写沙盒 5 语种 Hook */
export function useAdminAiI18n(): AdminAiDict {
  return useNamespace(adminAiZhCN, ADMIN_AI_LOADERS);
}

export type { AdminAiDict };
