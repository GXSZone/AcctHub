import { type SupportedLocale, useNamespace } from '../..';
import { type RiskControlDict, riskControlZhCN } from './zh-CN';

export type { RiskControlDict };

const RISK_CONTROL_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<RiskControlDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.riskControlZhTW),
  en: () => import('./en').then((m) => m.riskControlEn),
  ja: () => import('./ja').then((m) => m.riskControlJa),
  ko: () => import('./ko').then((m) => m.riskControlKo),
};

/** 5 维反盗刷风控、发卡增强与商用闭环 5 语种 Hook */
export function useRiskControlI18n(): RiskControlDict {
  return useNamespace(riskControlZhCN, RISK_CONTROL_LOADERS);
}
