import { type SupportedLocale, useNamespace } from '../..';
import { type MailDict, mailZhCN } from './zh-CN';

const MAIL_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<MailDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.mailZhTW),
  en: () => import('./en').then((m) => m.mailEn),
  ja: () => import('./ja').then((m) => m.mailJa),
  ko: () => import('./ko').then((m) => m.mailKo),
};

/** 主站与代理分站独立发卡邮箱配置与投递日志 5 语种 Hook */
export function useMailI18n(): MailDict {
  return useNamespace(mailZhCN, MAIL_LOADERS);
}

export function orderMailStatusText(dict: MailDict, status?: string | null) {
  if (status === 'sent') return dict.statusDelivered;
  if (status === 'pending') return dict.statusPending;
  if (status === 'failed') return dict.statusFailedFallback;
  return dict.statusNotSent;
}
