/**
 * 总控后台：已签约代理分站单列表格（支持低调中性样式权限覆写、等级调档与启停）
 */

import { discountDisplay } from '@shared/domain/money';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import type { SaasConfigState } from '../../components/AdminAgentOpsExtras';
import { fmt } from '../../i18n';
import { useAdminAgentsI18n } from '../../i18n/namespaces/admin-agents';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import type { AdminAgentRow, AdminAgentTierRow } from './admin.types';

interface AdminAgentsListTableProps {
  agents: AdminAgentRow[];
  agentTiers: AdminAgentTierRow[];
  saasConfig?: SaasConfigState;
  ownPayGlobalOn: boolean;
  privateGlobalOn: boolean;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminAgentsListTable({
  agents,
  agentTiers,
  saasConfig,
  ownPayGlobalOn,
  privateGlobalOn,
  onReload,
  showToast,
}: AdminAgentsListTableProps) {
  const aa = useAdminAgentsI18n();
  const ss = useSaasI18n();
  const [agentRates, setAgentRates] = useState<
    Record<number, { commission: number; markup: number; tier_id: number }>
  >({});
  const [savingAgentId, setSavingAgentId] = useState<number | null>(null);
  const [savedAgentIds, setSavedAgentIds] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const next: Record<number, { commission: number; markup: number; tier_id: number }> = {};
    for (const a of agents) {
      next[a.id] = {
        commission: a.commission_rate,
        markup: a.markup_percent,
        tier_id: a.tier_id || agentTiers[0]?.id || 1,
      };
    }
    setAgentRates(next);
  }, [agents, agentTiers]);

  const markAgentSaved = (id: number) => {
    setSavedAgentIds((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSavedAgentIds((p) => ({ ...p, [id]: false })), 1800);
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <h2 className="font-editorial text-xl font-semibold">{aa.agentsSectionTitle}</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr
              className="border-b whitespace-nowrap"
              style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
            >
              <th className="py-2 pr-4">{aa.agentsColBrand}</th>
              <th className="py-2 pr-4">{aa.agentsColDomain}</th>
              <th className="py-2 pr-4">{aa.agentsColCapabilities}</th>
              <th className="py-2 pr-4">{aa.agentsColTier}</th>
              <th className="py-2 pr-4">{aa.agentsColFee}</th>
              <th className="py-2 pr-4">{aa.agentsColRevenue}</th>
              <th className="py-2 text-right">{aa.agentsColActions}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const persistedTierId = a.tier_id || agentTiers[0]?.id || 1;
              const rate = agentRates[a.id] || {
                commission: 0,
                markup: a.markup_percent,
                tier_id: persistedTierId,
              };
              const activeTierObj = agentTiers.find((t) => t.id === persistedTierId);
              const isDirty = Number(rate.tier_id) !== Number(persistedTierId);
              const isSaving = savingAgentId === a.id;
              const isJustSaved = Boolean(savedAgentIds[a.id]) && !isDirty;
              const privVal =
                a.allow_private_products_override === 1
                  ? '1'
                  : a.allow_private_products_override === 0
                    ? '0'
                    : 'inherit';
              const ownPayVal =
                a.allow_own_payment_override === 1
                  ? '1'
                  : a.allow_own_payment_override === 0
                    ? '0'
                    : 'inherit';

              return (
                <tr
                  key={a.id}
                  className="border-b last:border-b-0 align-middle"
                  style={{
                    borderColor: 'var(--border-color)',
                    backgroundColor: isDirty
                      ? 'color-mix(in srgb, var(--accent-soft) 28%, transparent)'
                      : undefined,
                  }}
                >
                  <td className="py-3 pr-4">
                    <div className="font-semibold flex items-center gap-1.5 whitespace-nowrap">
                      <span
                        className="text-[10px] font-mono-num px-1.5 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                      >
                        {fmt(aa.agentsDepthBadge, { depth: a.depth || 1 })}
                      </span>
                      <span>{a.brand_name}</span>
                      <a
                        href={
                          a.primary_domain
                            ? `https://${a.primary_domain}`
                            : saasConfig?.neutral_base_domain
                              ? `https://${a.slug}.${saasConfig.neutral_base_domain}`
                              : `${window.location.protocol}//${a.slug}.localhost${window.location.port ? `:${window.location.port}` : ''}`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 font-mono-num text-[11px] underline shrink-0"
                        style={{ color: 'var(--accent)' }}
                      >
                        @{a.slug}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div
                      className="text-[11px] mt-0.5 whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {a.owner_email}
                      {a.parent_slug
                        ? fmt(aa.agentsParentSlug, { slug: a.parent_slug })
                        : aa.agentsDirectRoot}
                      {Number(a.downline_count || 0) > 0
                        ? fmt(aa.agentsDownlineCount, { count: Number(a.downline_count) })
                        : ''}
                    </div>
                  </td>

                  <td className="py-3 pr-4 whitespace-nowrap">
                    <span className="font-mono-num">{a.primary_domain || aa.domUnbound}</span>
                    {Number(a.domains_count || 0) > 0 && (
                      <span
                        className="ml-1.5 text-[10px] font-mono-num px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                      >
                        ×{a.domains_count}
                      </span>
                    )}
                  </td>

                  {/* 低调中性样式单列权限覆写：全局关闭时禁用置灰，避免 UI 跳动 */}
                  <td className="py-3 pr-4 whitespace-nowrap">
                    <div className="flex flex-col gap-1.5">
                      <label
                        className={`inline-flex items-center gap-1.5 text-[11px] ${ownPayGlobalOn ? '' : 'opacity-45'}`}
                        title={!ownPayGlobalOn ? ss.globalDisabledTag : undefined}
                      >
                        <span className="w-[70px] shrink-0" style={{ color: 'var(--ink-muted)' }}>
                          {ss.tierAllowOwnPayLabel}
                        </span>
                        <select
                          aria-label={ss.tierAllowOwnPayLabel}
                          disabled={!ownPayGlobalOn}
                          value={ownPayGlobalOn ? ownPayVal : '0'}
                          onChange={async (e) => {
                            const v = e.target.value;
                            const nextOwnPay = v === 'inherit' ? null : Number(v);
                            await adminApi.updateAgent(a.id, {
                              allow_own_payment_override: nextOwnPay,
                              ...(nextOwnPay === 0
                                ? { allow_private_products_override: 0 }
                                : nextOwnPay === 1 && privateGlobalOn
                                  ? { allow_private_products_override: 1 }
                                  : {}),
                            });
                            await onReload();
                            showToast(aa.agentsStatusUpdatedToast);
                          }}
                          className="rounded-lg border px-2 py-0.5 text-[11px] outline-none disabled:cursor-not-allowed"
                          style={{
                            borderColor: 'var(--border-color)',
                            backgroundColor: 'var(--bg-canvas)',
                            color: 'var(--ink-secondary)',
                          }}
                        >
                          {!ownPayGlobalOn ? (
                            <option value="0">{ss.globalDisabledTag}</option>
                          ) : (
                            <>
                              <option value="inherit">{ss.agentOverrideInherit}</option>
                              <option value="1">{ss.agentOverrideForceOn}</option>
                              <option value="0">{ss.agentOverrideForceOff}</option>
                            </>
                          )}
                        </select>
                      </label>

                      <label
                        className={`inline-flex items-center gap-1.5 text-[11px] ${privateGlobalOn ? '' : 'opacity-45'}`}
                        title={!privateGlobalOn ? ss.globalDisabledTag : undefined}
                      >
                        <span className="w-[70px] shrink-0" style={{ color: 'var(--ink-muted)' }}>
                          {ss.tierAllowPrivateLabel}
                        </span>
                        <select
                          aria-label={ss.tierAllowPrivateLabel}
                          disabled={!privateGlobalOn}
                          value={privateGlobalOn ? privVal : '0'}
                          onChange={async (e) => {
                            const v = e.target.value;
                            const nextPriv = v === 'inherit' ? null : Number(v);
                            await adminApi.updateAgent(a.id, {
                              allow_private_products_override: nextPriv,
                              ...(nextPriv === 1 ? { allow_own_payment_override: 1 } : {}),
                            });
                            await onReload();
                            showToast(aa.agentsStatusUpdatedToast);
                          }}
                          className="rounded-lg border px-2 py-0.5 text-[11px] outline-none disabled:cursor-not-allowed"
                          style={{
                            borderColor: 'var(--border-color)',
                            backgroundColor: 'var(--bg-canvas)',
                            color: 'var(--ink-secondary)',
                          }}
                        >
                          {!privateGlobalOn ? (
                            <option value="0">{ss.globalDisabledTag}</option>
                          ) : (
                            <>
                              <option value="inherit">{ss.agentOverrideInherit}</option>
                              <option value="1">{ss.agentOverrideForceOn}</option>
                              <option value="0">{ss.agentOverrideForceOff}</option>
                            </>
                          )}
                        </select>
                      </label>
                    </div>
                  </td>

                  <td className="py-3 pr-4 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <select
                        aria-label={aa.agentsColTier}
                        value={rate.tier_id}
                        onChange={(e) =>
                          setAgentRates((prev) => ({
                            ...prev,
                            [a.id]: { ...rate, tier_id: Number(e.target.value) },
                          }))
                        }
                        className="acct-input py-1 px-2 w-40 text-xs"
                        style={{ borderColor: isDirty ? 'var(--accent)' : undefined }}
                      >
                        {agentTiers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {fmt(aa.agentsTierOpt, { name: t.name, ...discountDisplay(t.discount_rate) })}
                          </option>
                        ))}
                      </select>
                      {activeTierObj && (
                        <span
                          className="text-[10.5px] font-mono-num px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                          title={aa.agentsTierActiveTitle}
                        >
                          {fmt(aa.agentsTierActiveBadge, { ...discountDisplay(activeTierObj.discount_rate) })}
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3 pr-4 font-mono-num font-semibold whitespace-nowrap">
                    ¥{Number(a.total_recharged || 0).toFixed(0)}
                  </td>

                  <td className="py-3 pr-4 font-mono-num whitespace-nowrap">
                    ¥{a.total_revenue} /{' '}
                    <span className="font-semibold" style={{ color: 'var(--success)' }}>
                      ¥{a.total_commission}
                    </span>
                  </td>

                  <td className="py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isSaving || (!isDirty && !isJustSaved)}
                        onClick={async () => {
                          if (!isDirty) return;
                          setSavingAgentId(a.id);
                          try {
                            await adminApi.updateAgent(a.id, { tier_id: rate.tier_id });
                            await onReload();
                            markAgentSaved(a.id);
                            showToast(fmt(aa.agentsTierSavedToast, { brand: a.brand_name }));
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : aa.agentsTierSaveFailErr);
                          } finally {
                            setSavingAgentId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer disabled:cursor-default"
                        style={{
                          backgroundColor: isJustSaved
                            ? 'var(--success-soft)'
                            : isDirty
                              ? 'var(--accent)'
                              : 'var(--bg-subtle)',
                          color: isJustSaved ? 'var(--success)' : isDirty ? '#FAF9F5' : 'var(--ink-muted)',
                        }}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {aa.tierBtnSaving}
                          </>
                        ) : isJustSaved ? (
                          <>
                            <Check className="w-3 h-3" />
                            {aa.tierBtnSaved}
                          </>
                        ) : isDirty ? (
                          aa.tierBtnSaveChanges
                        ) : (
                          aa.agentsBtnSynced
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await adminApi.updateAgent(a.id, {
                            status: a.status === 'active' ? 'suspended' : 'active',
                          });
                          await onReload();
                          showToast(aa.agentsStatusUpdatedToast);
                        }}
                        className="px-2.5 py-1 rounded-lg font-medium cursor-pointer"
                        style={{
                          backgroundColor:
                            a.status === 'active' ? 'var(--success-soft)' : 'var(--danger-soft)',
                          color: a.status === 'active' ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        {a.status === 'active' ? aa.agentsStatusActive : aa.agentsStatusSuspended}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
