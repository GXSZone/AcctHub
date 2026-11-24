import { type SupportedLocale, useNamespace } from '../..';
import { type AdminCoreDict, adminCoreZhCN } from './zh-CN';

const ADMIN_CORE_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AdminCoreDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminCoreZhTW),
  en: () => import('./en').then((m) => m.adminCoreEn),
  ja: () => import('./ja').then((m) => m.adminCoreJa),
  ko: () => import('./ko').then((m) => m.adminCoreKo),
};

/** 运营总控后台核心壳层、概览、订单、支付、配置与审计按域懒加载 5 语种 Hook */
export function useAdminCoreI18n(): AdminCoreDict {
  return useNamespace(adminCoreZhCN, ADMIN_CORE_LOADERS);
}

export type { AdminCoreDict };
