import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FolderTree,
  Globe,
  Headphones,
  Package,
  PlugZap,
  Plus,
  ReceiptText,
  Sparkles,
  Store,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type React from 'react';
import { fmt } from '../i18n';
import { useAdminCoreI18n } from '../i18n/namespaces/admin-core';
import { AdminEmergencyStrip } from './AdminEmergencyStrip';

interface OverviewDashboardProps {
  stats: {
    total_orders: number;
    total_gmv: number;
    product_gmv?: number;
    agent_upgrade_total?: number;
    total_products: number;
    total_agents: number;
    upstream_exceptions?: number;
  };
  securityWarnings?: Array<{ level: 'warning' | 'danger'; code: string; message: string }>;
  pendingTicketsCount: number;
  pendingWithdrawalsCount: number;
  pendingDomainsCount: number;
  lowStockProducts: Array<{ id: number; title: string; stock: number }>;
  recentOrders: Array<{
    order_no: string;
    product_title: string;
    spec_name: string;
    quantity: number;
    total_amount: number;
    status: string;
    tenant_slug: string | null;
    created_at: string;
  }>;
  isSuperAdmin: boolean;
  onNavigate: (tab: string) => void;
  onQuickCreateProduct: () => void;
}

export function AdminOverviewDashboard({
  stats,
  securityWarnings = [],
  pendingTicketsCount,
  pendingWithdrawalsCount,
  pendingDomainsCount,
  lowStockProducts,
  recentOrders,
  isSuperAdmin,
  onNavigate,
  onQuickCreateProduct,
}: OverviewDashboardProps) {
  const ac = useAdminCoreI18n();
  const upstreamExc = Number(stats.upstream_exceptions || 0);

  const todoCards: Array<{
    id: string;
    label: string;
    count: number;
    desc: string;
    targetTab: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: 'danger' | 'warning' | 'accent';
    visible: boolean;
  }> = [
    {
      id: 'tickets',
      label: ac.ovTodoTicketsLabel,
      count: pendingTicketsCount,
      desc: ac.ovTodoTicketsDesc,
      targetTab: 'tickets',
      icon: Headphones,
      tone: pendingTicketsCount > 0 ? 'danger' : 'accent',
      visible: true,
    },
    {
      id: 'upstreams',
      label: ac.ovTodoUpstreamLabel,
      count: upstreamExc,
      desc: ac.ovTodoUpstreamDesc,
      targetTab: 'upstreams',
      icon: PlugZap,
      tone: upstreamExc > 0 ? 'danger' : 'accent',
      visible: isSuperAdmin,
    },
    {
      id: 'withdrawals',
      label: ac.ovTodoWithdrawLabel,
      count: pendingWithdrawalsCount,
      desc: ac.ovTodoWithdrawDesc,
      targetTab: 'agents:withdrawals',
      icon: Wallet,
      tone: pendingWithdrawalsCount > 0 ? 'warning' : 'accent',
      visible: true,
    },
    {
      id: 'domains',
      label: ac.ovTodoDomainLabel,
      count: pendingDomainsCount,
      desc: ac.ovTodoDomainDesc,
      targetTab: 'agents',
      icon: Globe,
      tone: pendingDomainsCount > 0 ? 'warning' : 'accent',
      visible: true,
    },
  ];

  const activeTodos = todoCards.filter((c) => c.visible);
  const totalUrgent = activeTodos.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-6">
      {isSuperAdmin && (
        <AdminEmergencyStrip
          onGoRiskOrders={() => onNavigate('orders:risk_review')}
          onGoRiskSettings={() => onNavigate('settings:risk')}
        />
      )}

      {securityWarnings.length > 0 && (
        <div className="space-y-2">
          {securityWarnings.map((w) => (
            <div
              key={w.code}
              className="p-3.5 rounded-2xl border flex items-start gap-2.5 text-xs"
              style={{
                borderColor: w.level === 'danger' ? 'var(--danger)' : 'var(--warning)',
                backgroundColor: w.level === 'danger' ? 'var(--danger-soft)' : 'var(--warning-soft)',
                color: w.level === 'danger' ? 'var(--danger)' : 'var(--warning)',
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="font-medium leading-relaxed">{w.message}</div>
            </div>
          ))}
        </div>
      )}

      {/* 4 Core KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            label: ac.ovKpiGmv,
            value: `¥${stats.total_gmv.toFixed(2)}`,
            sub:
              stats.product_gmv !== undefined || stats.agent_upgrade_total !== undefined
                ? fmt(ac.ovKpiGmvSplit, {
                    product: Number(stats.product_gmv ?? stats.total_gmv).toFixed(2),
                    upgrade: Number(stats.agent_upgrade_total ?? 0).toFixed(2),
                  })
                : undefined,
            icon: TrendingUp,
            tab: 'finance',
          },
          {
            label: ac.ovKpiOrders,
            value: String(stats.total_orders),
            icon: ReceiptText,
            tab: 'orders',
          },
          {
            label: ac.ovKpiProducts,
            value: String(stats.total_products),
            icon: Package,
            tab: 'products',
          },
          {
            label: ac.ovKpiAgents,
            value: String(stats.total_agents),
            icon: Store,
            tab: 'agents',
          },
        ].map((k) => {
          const Icon = k.icon;
          return (
            <button
              key={k.label}
              type="button"
              onClick={() => onNavigate(k.tab)}
              className="paper-card rounded-2xl p-5 text-left transition-colors hover:border-[var(--accent)] cursor-pointer group"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                  {k.label}
                </span>
                <span
                  className="w-8 h-8 rounded-xl inline-flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Icon className="w-4 h-4" />
                </span>
              </div>
              <div className="font-mono-num text-2xl font-semibold mt-2">{k.value}</div>
              {'sub' in k && k.sub && (
                <div
                  className="text-[11px] font-mono-num mt-1 truncate"
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {k.sub}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Operational Todo & Alerts Strip */}
      <div className="paper-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {totalUrgent > 0 ? (
              <AlertTriangle className="w-4 h-4" style={{ color: 'var(--warning)' }} />
            ) : (
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--success)' }} />
            )}
            <h2 className="font-editorial text-lg font-semibold">{ac.ovTodoSectionTitle}</h2>
            <span
              className="text-[11px] font-mono-num px-2 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: totalUrgent > 0 ? 'var(--warning-soft)' : 'var(--success-soft)',
                color: totalUrgent > 0 ? 'var(--warning)' : 'var(--success)',
              }}
            >
              {totalUrgent > 0 ? fmt(ac.ovUrgentCountBadge, { count: totalUrgent }) : ac.ovHealthyBadge}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onQuickCreateProduct}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {ac.ovQuickNewProduct}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('categories')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium cursor-pointer"
              style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <FolderTree className="w-3.5 h-3.5" />
              {ac.ovQuickCategories}
            </button>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('ai')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-medium cursor-pointer"
                style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                {ac.ovQuickAiCopy}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {activeTodos.map((item) => {
            const Icon = item.icon;
            const hasPending = item.count > 0;
            const color = !hasPending
              ? 'var(--ink-muted)'
              : item.tone === 'danger'
                ? 'var(--danger)'
                : 'var(--warning)';
            const bg = !hasPending
              ? 'var(--bg-canvas)'
              : item.tone === 'danger'
                ? 'var(--danger-soft)'
                : 'var(--warning-soft)';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.targetTab)}
                className="p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2"
                style={{
                  borderColor: hasPending ? color : 'var(--border-color)',
                  backgroundColor: bg,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold"
                    style={{ color: hasPending ? color : 'var(--ink-primary)' }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {item.label}
                  </span>
                  <span className="font-mono-num text-lg font-bold" style={{ color }}>
                    {item.count}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between gap-1 text-[11px]"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  <span className="truncate">{item.desc}</span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-70" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Split: Recent Orders + Low Stock Watch */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 paper-card rounded-2xl p-5 space-y-3">
          <div
            className="flex items-center justify-between gap-2 pb-2.5 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <h3 className="font-editorial text-lg font-semibold">{ac.ovRecentOrdersTitle}</h3>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {ac.ovViewAllOrders}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          {recentOrders.length === 0 ? (
            <p className="text-xs py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
              {ac.ovNoRecentOrders}
            </p>
          ) : (
            <div className="space-y-2">
              {recentOrders.slice(0, 6).map((o) => (
                <div
                  key={o.order_no}
                  className="px-3.5 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate max-w-md">
                      {o.product_title}
                      <span className="ml-1.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        ({o.spec_name} × {o.quantity})
                      </span>
                    </div>
                    <div className="text-[11px] font-mono-num mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                      {o.order_no} ·{' '}
                      {o.tenant_slug
                        ? fmt(ac.ovOrderTenantTag, { slug: o.tenant_slug })
                        : ac.ovOrderDirectCustomer}{' '}
                      · {o.created_at}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono-num font-semibold">¥{Number(o.total_amount).toFixed(2)}</span>
                    <span
                      className="text-[10.5px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor:
                          o.status === 'delivered'
                            ? 'var(--success-soft)'
                            : o.status === 'refunded' || o.status === 'fulfillment_failed'
                              ? 'var(--danger-soft)'
                              : 'var(--warning-soft)',
                        color:
                          o.status === 'delivered'
                            ? 'var(--success)'
                            : o.status === 'refunded' || o.status === 'fulfillment_failed'
                              ? 'var(--danger)'
                              : 'var(--warning)',
                      }}
                    >
                      {o.status === 'delivered'
                        ? ac.ovStatusDelivered
                        : o.status === 'refunded'
                          ? ac.ovStatusRefunded
                          : o.status === 'upstream_pending'
                            ? ac.ovStatusDispatching
                            : o.status === 'fulfillment_failed'
                              ? ac.ovStatusException
                              : o.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="paper-card rounded-2xl p-5 space-y-3">
          <div
            className="flex items-center justify-between gap-2 pb-2.5 border-b"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <h3 className="font-editorial text-lg font-semibold">{ac.ovLowStockTitle}</h3>
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="text-xs font-medium cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {ac.ovRestockBtn}
            </button>
          </div>
          {lowStockProducts.length === 0 ? (
            <div className="py-8 text-center text-xs space-y-1.5" style={{ color: 'var(--ink-muted)' }}>
              <CheckCircle2 className="w-6 h-6 mx-auto" style={{ color: 'var(--success)' }} />
              <div>{ac.ovStockHealthy}</div>
            </div>
          ) : (
            <div className="space-y-2">
              {lowStockProducts.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  className="p-3 rounded-xl border flex items-center justify-between gap-2 text-xs"
                  style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                >
                  <span className="font-medium truncate">{p.title}</span>
                  <span
                    className="font-mono-num text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: p.stock === 0 ? 'var(--danger-soft)' : 'var(--warning-soft)',
                      color: p.stock === 0 ? 'var(--danger)' : 'var(--warning)',
                    }}
                  >
                    {p.stock === 0 ? ac.ovSoldOutTag : fmt(ac.ovStockLeftTag, { count: p.stock })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
