/**
 * 运营总控后台导航菜单分组构建器（均衡精简 5 组：概览 / 交易与售后 / 商品与供货 / 渠道与用户 / 站点与系统）
 */

import {
  FileText,
  FolderTree,
  Headphones,
  LayoutDashboard,
  Megaphone,
  Package,
  PlugZap,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
  Users,
} from 'lucide-react';
import type { AdminCoreDict } from '../../i18n/namespaces/admin-core';
import type { AdminNavGroup } from './AdminSidebar';
import type { AdminTab } from './admin.types';

export function buildAdminNavGroups(opts: {
  isSuperAdmin: boolean;
  pendingTicketsCount: number;
  upstreamExcCount: number;
  agentTodoCount: number;
  dict: AdminCoreDict;
}): AdminNavGroup[] {
  const { dict } = opts;
  return [
    {
      groupLabel: dict.navGroupOverview,
      items: [
        {
          id: 'overview',
          label: dict.navOverviewLabel,
          desc: dict.navOverviewDesc,
          icon: LayoutDashboard,
        },
      ],
    },
    {
      groupLabel: dict.navGroupTrade,
      items: [
        {
          id: 'orders',
          label: dict.navOrdersLabel,
          desc: dict.navOrdersDesc,
          icon: ReceiptText,
        },
        {
          id: 'finance',
          label: dict.navFinanceLabel,
          desc: dict.navFinanceDesc,
          icon: ShieldCheck,
        },
        {
          id: 'tickets',
          label: dict.navTicketsLabel,
          desc: dict.navTicketsDesc,
          icon: Headphones,
          badge: opts.pendingTicketsCount,
          badgeTone: 'danger',
        },
      ],
    },
    {
      groupLabel: dict.navGroupCatalog,
      items: [
        {
          id: 'products',
          label: dict.navProductsLabel,
          desc: dict.navProductsDesc,
          icon: Package,
        },
        {
          id: 'categories',
          label: dict.navCategoriesLabel,
          desc: dict.navCategoriesDesc,
          icon: FolderTree,
        },
        ...(opts.isSuperAdmin
          ? [
              {
                id: 'upstreams' as AdminTab,
                label: dict.navUpstreamsLabel,
                desc: dict.navUpstreamsDesc,
                icon: PlugZap,
                badge: opts.upstreamExcCount,
                badgeTone: 'danger' as const,
              },
            ]
          : []),
      ],
    },
    {
      groupLabel: dict.navGroupChannels,
      items: [
        {
          id: 'agents',
          label: dict.navAgentsLabel,
          desc: dict.navAgentsDesc,
          icon: Store,
          badge: opts.agentTodoCount,
          badgeTone: 'warning',
        },
        {
          id: 'members',
          label: dict.navMembersLabel,
          desc: dict.navMembersDesc,
          icon: Users,
        },
        {
          id: 'marketing',
          label: dict.navMarketingLabel,
          desc: dict.navMarketingDesc,
          icon: Ticket,
        },
      ],
    },
    {
      groupLabel: dict.navGroupSystem,
      items: [
        {
          id: 'announcements',
          label: dict.navContentLabel,
          desc: dict.navContentDesc,
          icon: Megaphone,
        },
        {
          id: 'settings',
          label: dict.navSettingsLabel,
          desc: dict.navSettingsDesc,
          icon: Settings,
        },
        ...(opts.isSuperAdmin
          ? [
              {
                id: 'ai' as AdminTab,
                label: dict.navAiLabel,
                desc: dict.navAiDesc,
                icon: Sparkles,
              },
            ]
          : []),
        {
          id: 'audit',
          label: dict.navAuditLabel,
          desc: dict.navAuditDesc,
          icon: FileText,
        },
      ],
    },
  ];
}
