import { useNamespace } from '../../index';
import { type AdminNoticeDict, adminNoticeZhCN } from './zh-CN';

/** 公告中心管理 5 语种按需加载字典 Hook */
export function useAdminNoticeI18n(): AdminNoticeDict {
  return useNamespace(adminNoticeZhCN, {
    'zh-TW': () => import('./zh-TW').then((m) => m.adminNoticeZhTW),
    en: () => import('./en').then((m) => m.adminNoticeEn),
    ja: () => import('./ja').then((m) => m.adminNoticeJa),
    ko: () => import('./ko').then((m) => m.adminNoticeKo),
  });
}

export type { AdminNoticeDict };
