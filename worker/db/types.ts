export type {
  AuthUserDto as AuthUser,
  ProductCustomFieldDto as ProductCustomField,
  ProductFaqDto as ProductFaq,
  ProductSpecDto as ProductSpec,
} from '@shared/index';
export type { Env, TenantContext } from '../env';

export interface AgentTier {
  id: number;
  owner_agent_id: number;
  code: string;
  name: string;
  level_rank: number;
  min_recharge: number;
  discount_rate: number;
  commission_rate: number;
  sub_override_rate: number;
  max_sub_agents: number;
  badge_color: string;
  perks_json: string;
  allow_custom_domain: number;
  max_custom_domains: number;
  allow_private_products: number;
  allow_own_payment: number;
}
