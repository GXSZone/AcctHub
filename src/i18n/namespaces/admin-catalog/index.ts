import { type SupportedLocale, useNamespace } from '../..';
import { type AdminCatalogDict, adminCatalogZhCN } from './zh-CN';

const ADMIN_CATALOG_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AdminCatalogDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminCatalogZhTW),
  en: () => import('./en').then((m) => m.adminCatalogEn),
  ja: () => import('./ja').then((m) => m.adminCatalogJa),
  ko: () => import('./ko').then((m) => m.adminCatalogKo),
};

/** 运营总控后台商品列表、卡密库存库与分组分类管理 5 语种 Hook */
export function useAdminCatalogI18n(): AdminCatalogDict {
  return useNamespace(adminCatalogZhCN, ADMIN_CATALOG_LOADERS);
}
