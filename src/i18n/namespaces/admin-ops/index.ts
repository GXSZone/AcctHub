import { type SupportedLocale, useNamespace } from '../..';
import { type AdminOpsDict, adminOpsZhCN } from './zh-CN';

const ADMIN_OPS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AdminOpsDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminOpsZhTW),
  en: () => import('./en').then((m) => m.adminOpsEn),
  ja: () => import('./ja').then((m) => m.adminOpsJa),
  ko: () => import('./ko').then((m) => m.adminOpsKo),
};

/** 运营总控后台财务对账、帮助文章、营销券CDK、告警通知与工单中心 5 语种 Hook */
export function useAdminOpsI18n(): AdminOpsDict {
  return useNamespace(adminOpsZhCN, ADMIN_OPS_LOADERS);
}
