import { canBuyAtAgentPrice, DEFAULT_AGENT_DISCOUNT_RATE } from '@shared/domain/pricing';
import type { BootstrapPayload, UserProfile } from '../../types';

export function getStorefrontAgentRate(
  user: UserProfile | null,
  tenant: BootstrapPayload['tenant'] | undefined
): number | null {
  if (!tenant || user?.role !== 'agent' || user.agent?.status !== 'active') return null;
  const siteAgentId = tenant.isSubAgent ? tenant.agentId : null;
  const buyer = { id: user.agent.id, parentAgentId: user.agent.parent_agent_id };
  if (!canBuyAtAgentPrice(siteAgentId, buyer)) return null;
  return user.agent_tier?.discount_rate ?? DEFAULT_AGENT_DISCOUNT_RATE;
}
