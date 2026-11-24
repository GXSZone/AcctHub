import { useNamespace } from '../../index';
import { type AdminUpstreamDrawerDict, adminUpstreamDrawerZhCN } from './zh-CN';

/** 上游连接器配置抽屉 5 语种按需加载字典 Hook */
export function useAdminUpstreamDrawerI18n(): AdminUpstreamDrawerDict {
  return useNamespace(adminUpstreamDrawerZhCN, {
    'zh-TW': () => import('./zh-TW').then((m) => m.adminUpstreamDrawerZhTW),
    en: () => import('./en').then((m) => m.adminUpstreamDrawerEn),
    ja: () => import('./ja').then((m) => m.adminUpstreamDrawerJa),
    ko: () => import('./ko').then((m) => m.adminUpstreamDrawerKo),
  });
}

export type { AdminUpstreamDrawerDict };
