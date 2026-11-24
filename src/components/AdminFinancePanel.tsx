import { FINANCE_INTEGRITY_CHECK_KEYS } from '@shared/domain/order-finance';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '../api/admin.api';
import { fmt } from '../i18n';
import { useAdminOpsI18n } from '../i18n/namespaces/admin-ops';
import { useAdminFinanceQuery } from '../queries/admin.queries';

export function AdminFinancePanel({ showToast }: { showToast: (msg: string) => void }) {
  const ao = useAdminOpsI18n();
  const [days, setDays] = useState<number>(30);
  const [exporting, setExporting] = useState(false);

  const financeQuery = useAdminFinanceQuery(days);
  const data = financeQuery.data ?? null;
  const loading = financeQuery.isFetching;

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await adminApi.downloadFinanceCsv(days);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accthub-reconciliation-${days || 'all'}d.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(ao.finExportOkToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : ao.finExportFailErr);
    } finally {
      setExporting(false);
    }
  };

  if (loading && !data) {
    return (
      <div
        className="py-20 flex flex-col items-center justify-center gap-2 text-xs"
        style={{ color: 'var(--ink-muted)' }}
      >
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
        <span>{ao.finLoading}</span>
      </div>
    );
  }

  const s = data?.summary;
  const checks = data?.integrity_checks ?? [];
  const checksByKey = new Map(checks.map((check) => [check.key, check]));
  const complete =
    checks.length === checksByKey.size &&
    FINANCE_INTEGRITY_CHECK_KEYS.every((key) => typeof checksByKey.get(key)?.passed === 'boolean');
  const currentChecks = financeQuery.isSuccess && !loading && complete;
  const allChecksPassed = currentChecks && checks.every((check) => check.passed);

  const totalRecognizedRev = s?.total_recognized_revenue ?? s?.gross_gmv ?? 0;
  const compNetProfit = s?.comprehensive_net_profit ?? s?.platform_net_profit ?? 0;
  const upgradeTotal = s?.agent_upgrade_total ?? 0;
  const upgradeParentShare = s?.agent_upgrade_parent_share ?? 0;
  const upgradePlatformNet = s?.agent_upgrade_platform_net ?? 0;
  const wdFeeIncome = s?.withdrawal_fee_income ?? 0;
  const localCost = s?.local_product_cost_total ?? 0;
  const sunkUpstream = s?.refund_sunk_upstream_cost ?? 0;
  const lossTotal = Number((localCost + sunkUpstream).toFixed(2));

  return (
    <div className="space-y-6">
      {/* 顶部时间窗口切换与导出操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {[
            { val: 7, label: ao.finDays7 },
            { val: 30, label: ao.finDays30 },
            { val: 90, label: ao.finDays90 },
            { val: 0, label: ao.finDaysAll },
          ].map((opt) => (
            <button
              key={opt.val}
              type="button"
              onClick={() => setDays(opt.val)}
              className="px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer"
              style={{
                backgroundColor: days === opt.val ? 'var(--accent-soft)' : 'var(--bg-surface)',
                borderColor: days === opt.val ? 'transparent' : 'var(--border-color)',
                color: days === opt.val ? 'var(--accent)' : 'var(--ink-secondary)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void financeQuery.refetch()}
            disabled={loading}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border cursor-pointer inline-flex items-center gap-1.5"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {ao.finRefreshBtn}
          </button>
          <button
            type="button"
            onClick={() => void handleExportCsv()}
            disabled={exporting}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {ao.finExportBtn}
          </button>
        </div>
      </div>

      {/* 一、营收与综合利润核算（含商品、代理开户费与提现手续费） */}
      {s && (
        <div className="space-y-3">
          <div className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>
            {ao.finSecRevenueTitle}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                label: ao.finCardTotalRevLabel,
                value: `¥${totalRecognizedRev.toFixed(2)}`,
                sub: fmt(ao.finCardTotalRevSub, {
                  gmv: s.gross_gmv.toFixed(2),
                  upgrade: upgradeTotal.toFixed(2),
                  wdFee: wdFeeIncome.toFixed(2),
                }),
                accent: false,
              },
              {
                label: ao.finCardCompProfitLabel,
                value: `¥${compNetProfit.toFixed(2)}`,
                sub: fmt(ao.finCardCompProfitSub, {
                  ordNet: s.platform_net_profit.toFixed(2),
                  upgNet: upgradePlatformNet.toFixed(2),
                  wdFee: wdFeeIncome.toFixed(2),
                  loss: lossTotal.toFixed(2),
                }),
                accent: true,
              },
              {
                label: ao.finCardUpgradeLabel,
                value: `¥${upgradeTotal.toFixed(2)}`,
                sub: fmt(ao.finCardUpgradeSub, {
                  count: s.agent_upgrade_count ?? 0,
                  parent: upgradeParentShare.toFixed(2),
                  net: upgradePlatformNet.toFixed(2),
                }),
                accent: false,
              },
              {
                label: ao.finCardCommLabel,
                value: `¥${s.agent_commission_total.toFixed(2)}`,
                sub: fmt(ao.finCardWdFeeSub, {
                  paidNet: (s.paid_withdrawals_net ?? s.paid_withdrawals).toFixed(2),
                  fee: wdFeeIncome.toFixed(2),
                  pending: s.pending_withdrawals.toFixed(2),
                }),
                accent: false,
              },
              {
                label: ao.finCardCostBreakLabel,
                value: `¥${(s.upstream_cost_total + localCost).toFixed(2)}`,
                sub: fmt(ao.finCardCostBreakSub, {
                  upstream: s.upstream_cost_total.toFixed(2),
                  local: localCost.toFixed(2),
                }),
                accent: false,
              },
              {
                label: ao.finCardLossLabel,
                value: `¥${s.refunded_amount.toFixed(2)}`,
                sub: fmt(ao.finCardLossSub, {
                  sunk: sunkUpstream.toFixed(2),
                  recv: (s.unrecovered_commission_receivable ?? 0).toFixed(2),
                  cnt: s.unrecovered_commission_count ?? 0,
                }),
                accent: false,
              },
            ].map((card) => (
              <div key={card.label} className="paper-card rounded-2xl p-4 space-y-1">
                <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {card.label}
                </div>
                <div
                  className="text-2xl font-bold font-mono-num"
                  style={{ color: card.accent ? 'var(--accent)' : 'var(--ink-primary)' }}
                >
                  {card.value}
                </div>
                <div className="text-[11px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
                  {card.sub}
                </div>
              </div>
            ))}
          </div>

          {/* 二、外部现金实收与站内资金池负债对账 */}
          <div className="text-xs font-semibold pt-2" style={{ color: 'var(--ink-secondary)' }}>
            {ao.finSecCashPoolTitle}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: ao.finCardCashInLabel,
                value: `¥${(s.cash_inflow_total ?? 0).toFixed(2)}`,
                sub: fmt(ao.finCardCashInSub, {
                  ord: (s.cash_inflow_order ?? 0).toFixed(2),
                  upg: (s.cash_inflow_upgrade ?? 0).toFixed(2),
                  rch: (s.cash_inflow_recharge ?? 0).toFixed(2),
                }),
              },
              {
                label: ao.finCardWalletLiabLabel,
                value: `¥${(s.wallet_liability_total ?? 0).toFixed(2)}`,
                sub: fmt(ao.finCardWalletLiabSub, {
                  agent: (s.wallet_liability_agent ?? 0).toFixed(2),
                  member: (s.wallet_liability_member ?? 0).toFixed(2),
                }),
              },
              {
                label: ao.finCardPromoLabel,
                value: `¥${(s.promo_discount_total ?? 0).toFixed(2)}`,
                sub: fmt(ao.finCardPromoSub, {
                  used: (s.promo_discount_total ?? 0).toFixed(2),
                  liab: (s.promo_liability_total ?? 0).toFixed(2),
                }),
              },
              {
                label: ao.finCardCdkLabel,
                value: `¥${(s.cdk_redeemed_total ?? 0).toFixed(2)}`,
                sub: ao.finCardCdkSub,
              },
            ].map((card) => (
              <div key={card.label} className="paper-card rounded-2xl p-4 space-y-1">
                <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {card.label}
                </div>
                <div className="text-xl font-bold font-mono-num" style={{ color: 'var(--ink-primary)' }}>
                  {card.value}
                </div>
                <div className="text-[11px] leading-snug" style={{ color: 'var(--ink-secondary)' }}>
                  {card.sub}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 资金守恒自动巡检引擎 */}
      <div className="paper-card rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-editorial text-base font-semibold flex items-center gap-2">
            <ShieldCheck
              className="w-4 h-4"
              style={{ color: allChecksPassed ? 'var(--success)' : '#dc2626' }}
            />
            {ao.finIntegrityTitle}
          </h3>
          <span
            className="text-xs px-2.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: allChecksPassed ? 'var(--success-soft)' : 'rgba(220,38,38,0.1)',
              color: allChecksPassed ? 'var(--success)' : '#dc2626',
            }}
          >
            {loading
              ? ao.finLoading
              : currentChecks
                ? allChecksPassed
                  ? ao.finIntegrityPassBadge
                  : ao.finIntegrityFailBadge
                : ao.finIntegrityUnavailable}
          </span>
        </div>

        {!loading && !currentChecks && (
          <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
            {financeQuery.isError ? ao.finLoadError : ao.finIntegrityIncomplete}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {currentChecks &&
            checks.map((chk) => (
              <div
                key={chk.key}
                className="rounded-xl p-3 border flex items-start gap-2.5 text-xs"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                {chk.passed ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
                )}
                <div>
                  <div className="font-semibold">{chk.label}</div>
                  <div className="mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                    {chk.detail}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* 按日财务明细与分站租户贡献表 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="paper-card rounded-2xl p-5 space-y-3">
          <h3 className="font-editorial text-base font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            {ao.finDailyTitle}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-2">{ao.finDailyColDay}</th>
                  <th className="py-2 px-2">{ao.finDailyColOrders}</th>
                  <th className="py-2 px-2">{ao.finDailyColGmv}</th>
                  <th className="py-2 px-2">{ao.finDailyColUpgrade}</th>
                  <th className="py-2 px-2">{ao.finDailyColOut}</th>
                  <th className="py-2 pl-2 text-right">{ao.finDailyColProfit}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.daily || []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      {ao.finDailyEmpty}
                    </td>
                  </tr>
                ) : (
                  (data?.daily || []).slice(0, 15).map((row) => (
                    <tr key={row.day} className="border-b" style={{ borderColor: 'var(--border-color)' }}>
                      <td className="py-2 pr-2 font-mono-num">{row.day}</td>
                      <td className="py-2 px-2 font-mono-num">{row.order_count}</td>
                      <td className="py-2 px-2 font-mono-num">¥{row.gmv.toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono-num">¥{(row.upgrade_total ?? 0).toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono-num" style={{ color: 'var(--ink-secondary)' }}>
                        ¥{(row.commission + row.upstream_cost).toFixed(2)}
                      </td>
                      <td
                        className="py-2 pl-2 text-right font-mono-num font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        ¥{row.net_profit.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="paper-card rounded-2xl p-5 space-y-3">
          <h3 className="font-editorial text-base font-semibold">{ao.finTenantTitle}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr
                  className="border-b text-left"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-2">{ao.finTenantColSite}</th>
                  <th className="py-2 px-2">{ao.finTenantColOrders}</th>
                  <th className="py-2 px-2">{ao.finTenantColGmv}</th>
                  <th className="py-2 px-2">{ao.finTenantColComm}</th>
                  <th className="py-2 pl-2 text-right">{ao.finTenantColProfit}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.by_tenant || []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                      {ao.finTenantEmpty}
                    </td>
                  </tr>
                ) : (
                  (data?.by_tenant || []).map((row) => (
                    <tr
                      key={row.tenant_slug}
                      className="border-b"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-2 pr-2">
                        <div className="font-medium">{row.brand_name}</div>
                        <div className="text-[10px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                          @{row.tenant_slug}
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono-num">{row.order_count}</td>
                      <td className="py-2 px-2 font-mono-num">¥{row.gmv.toFixed(2)}</td>
                      <td className="py-2 px-2 font-mono-num" style={{ color: 'var(--ink-secondary)' }}>
                        ¥{row.commission.toFixed(2)}
                      </td>
                      <td
                        className="py-2 pl-2 text-right font-mono-num font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        ¥{row.net_profit.toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
