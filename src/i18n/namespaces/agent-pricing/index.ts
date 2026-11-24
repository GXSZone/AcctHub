import { type SupportedLocale, useNamespace } from '../..';
import { type AgentPricingDict, agentPricingZhCN } from './zh-CN';

const AGENT_PRICING_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AgentPricingDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.agentPricingZhTW),
  en: () => import('./en').then((m) => m.agentPricingEn),
  ja: () => import('./ja').then((m) => m.agentPricingJa),
  ko: () => import('./ko').then((m) => m.agentPricingKo),
};

/** 代理商品定价与文案覆盖按域懒加载 5 语种 Hook */
export function useAgentPricingI18n(): AgentPricingDict {
  return useNamespace(agentPricingZhCN, AGENT_PRICING_LOADERS);
}
