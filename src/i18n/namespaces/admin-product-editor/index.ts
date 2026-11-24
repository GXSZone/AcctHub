import { type SupportedLocale, useNamespace } from '../..';
import { type AdminProductEditorDict, adminProductEditorZhCN } from './zh-CN';

const ADMIN_PRODUCT_EDITOR_LOADERS: Record<
  Exclude<SupportedLocale, 'zh-CN'>,
  () => Promise<AdminProductEditorDict>
> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.adminProductEditorZhTW),
  en: () => import('./en').then((m) => m.adminProductEditorEn),
  ja: () => import('./ja').then((m) => m.adminProductEditorJa),
  ko: () => import('./ko').then((m) => m.adminProductEditorKo),
};

/** 运营总控后台全功能商品编辑器（基础、规格、详情、AI 助手与 SKU 路由）5 语种 Hook */
export function useAdminProductEditorI18n(): AdminProductEditorDict {
  return useNamespace(adminProductEditorZhCN, ADMIN_PRODUCT_EDITOR_LOADERS);
}

export type { AdminProductEditorDict };
