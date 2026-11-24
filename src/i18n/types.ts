import type { SupportedLocale } from '@shared/constants/enums';

export type { SupportedLocale };

export interface LocaleOption {
  code: SupportedLocale;
  label: string;
  shortLabel: string;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'zh-CN', label: '简体中文', shortLabel: '简' },
  { code: 'zh-TW', label: '繁體中文', shortLabel: '繁' },
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'ja', label: '日本語', shortLabel: 'JA' },
  { code: 'ko', label: '한국어', shortLabel: 'KO' },
] as const;

export interface I18nMessages {
  navShopShort: string;
  navOrders: string;
  navOrdersShort: string;
  navDocs: string;
  navHelp: string;
  navAnnouncements: string;
  searchBtn: string;
  featured: string;
  allProducts: string;
  allCategories: string;
  categoriesHeading: string;
  catalogHeading: string;
  viewList: string;
  viewGrid: string;
  price: string;
  stock: string;
  actionBuy: string;
  actionPreorder: string;
  login: string;
  balance: string;
  logout: string;
  backToCatalog: string;
  exitSubAgent: string;
  helpEyebrow: string;
  helpTitle: string;
  helpSubtitle: string;
  ordersEyebrow: string;
  ordersTitle: string;
  ordersSubtitle: string;
  ordersSearchPlaceholder: string;
  ordersPassPlaceholder: string;
  totpTitle: string;
  totpSubtitle: string;
  languageLabel: string;
}
