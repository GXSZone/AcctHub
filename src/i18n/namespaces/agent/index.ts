import { type SupportedLocale, useNamespace } from '../..';
import { type AgentDict, agentZhCN } from './zh-CN';

export type { AgentDict };

const AGENT_LOADERS: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<AgentDict>> = {
  'zh-TW': () => import('./zh-TW').then((m) => m.agentZhTW),
  en: () => import('./en').then((m) => m.agentEn),
  ja: () => import('./ja').then((m) => m.agentJa),
  ko: () => import('./ko').then((m) => m.agentKo),
};

/** 代理工作台按域懒加载 5 语种 Hook */
export function useAgentI18n(): AgentDict {
  return useNamespace(agentZhCN, AGENT_LOADERS);
}
