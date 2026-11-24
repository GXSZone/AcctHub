/**
 * 代理分站运营后台侧边栏导航分组构建器（与主站总控后台 1:1 对称：4 组清晰归类）
 */

import {
  Globe,
  Headphones,
  KeyRound,
  Megaphone,
  PackagePlus,
  ReceiptText,
  Tag,
  Ticket,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import type { AgentDict } from '../../i18n/namespaces/agent';
import type { RiskControlDict } from '../../i18n/namespaces/risk-control';
import type { SaasDict } from '../../i18n/namespaces/saas';
import type { AdminNavGroup } from '../admin/AdminSidebar';

export type AgentWorkbenchTab =
  | 'overview'
  | 'store_orders'
  | 'store_members'
  | 'products'
  | 'private_catalog'
  | 'distribution'
  | 'tickets'
  | 'marketing'
  | 'notices'
  | 'brand'
  | 'api';

export function buildAgentNavGroups(opts: {
  directSubCount: number;
  unreadTicketsCount?: number;
  dict: AgentDict;
  saasDict: SaasDict;
  rfDict: RiskControlDict;
  allowPrivateProducts?: boolean;
}): Array<AdminNavGroup<AgentWorkbenchTab>> {
  const { directSubCount, unreadTicketsCount = 0, dict, saasDict, rfDict, allowPrivateProducts } = opts;
  return [
    {
      groupLabel: dict.navGroupOverview,
      items: [
        {
          id: 'overview',
          label: dict.tabOverview,
          desc: dict.descOverview,
          icon: TrendingUp,
        },
        {
          id: 'store_orders',
          label: rfDict.agentTabStoreOrders,
          desc: rfDict.agentDescStoreOrders,
          icon: ReceiptText,
        },
        {
          id: 'store_members',
          label: rfDict.agentTabStoreMembers,
          desc: rfDict.agentDescStoreMembers,
          icon: UserCheck,
        },
      ],
    },
    {
      groupLabel: dict.navGroupCatalog,
      items: [
        {
          id: 'products',
          label: dict.tabProducts,
          desc: dict.descProducts,
          icon: Tag,
        },
        ...(allowPrivateProducts
          ? [
              {
                id: 'private_catalog' as const,
                label: saasDict.tabPrivateCatalogLabel,
                desc: saasDict.tabPrivateCatalogDesc,
                icon: PackagePlus,
              },
            ]
          : []),
        {
          id: 'distribution',
          label: dict.tabDistribution,
          desc: dict.descDistribution,
          icon: Users,
          badge: directSubCount,
          badgeTone: 'warning' as const,
        },
      ],
    },
    {
      groupLabel: dict.navGroupMarketing,
      items: [
        {
          id: 'tickets',
          label: dict.tabTickets,
          desc: dict.descTickets,
          icon: Headphones,
          badge: unreadTicketsCount,
          badgeTone: 'danger',
        },
        {
          id: 'marketing',
          label: dict.tabMarketing,
          desc: dict.descMarketing,
          icon: Ticket,
        },
      ],
    },
    {
      groupLabel: dict.navGroupConfig,
      items: [
        {
          id: 'notices',
          label: dict.tabNotices,
          desc: dict.descNotices,
          icon: Megaphone,
        },
        {
          id: 'brand',
          label: dict.tabSiteConfig,
          desc: dict.descSiteConfig,
          icon: Globe,
        },
        {
          id: 'api',
          label: dict.tabApi,
          desc: dict.descApi,
          icon: KeyRound,
        },
      ],
    },
  ];
}
