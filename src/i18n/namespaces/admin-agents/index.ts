import { type SupportedLocale, useNamespace } from '../..';
import { type AdminAgentsDict, adminAgentsZhCN } from './zh-CN';

const ADMIN_AGENTS_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AdminAgentsDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminAgentsZhTW),
  en: () => import('./en').then((m) => m.adminAgentsEn),
  ja: () => import('./ja').then((m) => m.adminAgentsJa),
  ko: () => import('./ko').then((m) => m.adminAgentsKo),
};

/** 运营总控后台代理等级、防亏校验、SaaS 域名、提现与域名审核 5 语种 Hook */
export function useAdminAgentsI18n(): AdminAgentsDict {
  return useNamespace(adminAgentsZhCN, ADMIN_AGENTS_LOADERS);
}
