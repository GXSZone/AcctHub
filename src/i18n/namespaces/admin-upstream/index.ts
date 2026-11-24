import { useNamespace } from '../../index';
import { type AdminUpstreamDict, adminUpstreamZhCN } from './zh-CN';

/** 上游直采与路由主面板 5 语种按需加载字典 Hook */
export function useAdminUpstreamI18n(): AdminUpstreamDict {
  return useNamespace(adminUpstreamZhCN, {
    'zh-TW': () => import('./zh-TW').then((m) => m.adminUpstreamZhTW),
    en: () => import('./en').then((m) => m.adminUpstreamEn),
    ja: () => import('./ja').then((m) => m.adminUpstreamJa),
    ko: () => import('./ko').then((m) => m.adminUpstreamKo),
  });
}

export type { AdminUpstreamDict };
