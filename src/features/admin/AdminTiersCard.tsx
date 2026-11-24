/**
 * 多级代理等级、升级费用、SaaS 分站能力与全站折扣×成本防亏一体化配置卡片
 */

import { discountDisplay } from '@shared/domain/money';
import { AlertTriangle, Check, Loader2, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminAgentsI18n } from '../../i18n/namespaces/admin-agents';
import { AdminTierCapabilitiesInline, type TierCapabilityDraft } from './AdminTierCapabilitiesBar';
import {
  AdminTierCreateForm,
  createDiscountLossEvaluator,
  type DiscountLossRow,
  type NewTierDraft,
} from './AdminTierCreateForm';
import type { AdminAgentTierRow, AdminProductRow } from './admin.types';

interface AdminTiersCardProps {
  agentTiers: AdminAgentTierRow[];
  products: AdminProductRow[];
  globalOwnPayEnabled?: boolean;
  globalPrivateEnabled?: boolean;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

interface TierDraft extends TierCapabilityDraft {
  name: string;
  min_recharge: number;
  discount_rate: number;
}

function tierToDraft(t: AdminAgentTierRow): TierDraft {
  return {
    name: t.name,
    min_recharge: t.min_recharge,
    discount_rate: t.discount_rate,
    allow_custom_domain: Boolean(t.allow_custom_domain),
    max_custom_domains: Number(t.max_custom_domains ?? 1),
    allow_private_products: Boolean(t.allow_private_products),
    allow_own_payment: Boolean(t.allow_own_payment),
  };
}

function isTierDraftDirty(t: AdminAgentTierRow, td: TierDraft): boolean {
  return (
    td.name !== t.name ||
    Number(td.min_recharge) !== Number(t.min_recharge) ||
    Math.abs(Number(td.discount_rate) - Number(t.discount_rate)) > 0.0001 ||
    td.allow_custom_domain !== Boolean(t.allow_custom_domain) ||
    Number(td.max_custom_domains) !== Number(t.max_custom_domains ?? 1) ||
    td.allow_private_products !== Boolean(t.allow_private_products) ||
    td.allow_own_payment !== Boolean(t.allow_own_payment)
  );
}

export function AdminTiersCard({
  agentTiers,
  products,
  globalOwnPayEnabled = true,
  globalPrivateEnabled = true,
  onReload,
  showToast,
}: AdminTiersCardProps) {
  const aa = useAdminAgentsI18n();
  const [tierDrafts, setTierDrafts] = useState<Record<number, TierDraft>>({});
  const [savingTierId, setSavingTierId] = useState<number | null>(null);
  const [savedTierIds, setSavedTierIds] = useState<Record<number, boolean>>({});
  const [savingBatchTiers, setSavingBatchTiers] = useState(false);
  const [newTier, setNewTier] = useState<NewTierDraft>({
    code: '',
    name: '',
    level_rank: 5,
    min_recharge: 10000,
    discount_rate: 0.68,
    commission_rate: 30,
    sub_override_rate: 8,
    max_sub_agents: 999,
    badge_color: '#8B4A35',
  });

  useEffect(() => {
    setTierDrafts(Object.fromEntries(agentTiers.map((t) => [t.id, tierToDraft(t)])));
  }, [agentTiers]);

  const markTierSaved = (id: number) => {
    setSavedTierIds((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSavedTierIds((p) => ({ ...p, [id]: false })), 1800);
  };

  const patchDraft = (t: AdminAgentTierRow, patch: Partial<TierDraft>) => {
    setTierDrafts((prev) => ({ ...prev, [t.id]: { ...(prev[t.id] ?? tierToDraft(t)), ...patch } }));
  };

  const reviewTierLoss = async (id: number, draft: TierDraft) => {
    const risk = await adminApi.previewAgentTierLoss(id, draft.discount_rate);
    if (!risk.loss_confirmation) return { accepted: true };
    const top = risk.loss_items[0];
    const safe = discountDisplay(risk.safe_min_discount);
    const accepted = await openConfirm({
      title: fmt(aa.tierBatchLossTitle, { name: draft.name }),
      description: fmt(aa.tierRowLossDesc, {
        name: draft.name,
        ...discountDisplay(draft.discount_rate),
        count: risk.loss_items.length,
        safeRate: risk.safe_min_discount,
        safePct: safe.ratePct,
        safeFold: safe.zhFold,
      }),
      detail: fmt(aa.tierRowLossDetail, {
        title: top.product_title,
        specName: top.spec_name,
        sell: top.sell_price,
        agentPrice: top.min_agent_price,
        cost: top.cost_price,
        loss: top.loss_amount,
      }),
      confirmLabel: aa.tierRowLossConfirm,
      cancelLabel: aa.tierRowLossCancel,
      tone: 'danger',
    });
    return { accepted, loss_confirmation: risk.loss_confirmation };
  };

  const evaluateDiscountLosses = useMemo(
    () => createDiscountLossEvaluator(products, aa.tierStartingPriceSpec),
    [products, aa.tierStartingPriceSpec]
  );

  const dirtyTiers = agentTiers.filter((t) => {
    const td = tierDrafts[t.id];
    return Boolean(td && isTierDraftDirty(t, td));
  });

  const allDraftLosses: Array<{ tierLabel: string; losses: DiscountLossRow[] }> = [];
  for (const t of agentTiers) {
    const d = tierDrafts[t.id]?.discount_rate ?? t.discount_rate;
    const ls = evaluateDiscountLosses.check(d);
    if (ls.length > 0) {
      allDraftLosses.push({
        tierLabel: fmt(aa.tierLossLabelExisting, {
          name: tierDrafts[t.id]?.name || t.name,
          ...discountDisplay(d),
        }),
        losses: ls,
      });
    }
  }
  const newTierLosses = newTier.name.trim() ? evaluateDiscountLosses.check(newTier.discount_rate) : [];
  if (newTierLosses.length > 0) {
    allDraftLosses.push({
      tierLabel: fmt(aa.tierLossLabelNew, {
        name: newTier.name,
        ...discountDisplay(newTier.discount_rate),
      }),
      losses: newTierLosses,
    });
  }

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-editorial text-xl font-semibold">{aa.tierTitle}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {aa.tierSubtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {dirtyTiers.length >= 2 && (
            <button
              type="button"
              disabled={savingBatchTiers}
              onClick={async () => {
                setSavingBatchTiers(true);
                try {
                  const reviewed: Array<{ id: number; draft: TierDraft; lossConfirmation?: string }> = [];
                  for (const t of dirtyTiers) {
                    const draft = tierDrafts[t.id];
                    const review = await reviewTierLoss(t.id, draft);
                    if (!review.accepted) return;
                    reviewed.push({ id: t.id, draft, lossConfirmation: review.loss_confirmation });
                  }
                  for (const { id, draft, lossConfirmation } of reviewed) {
                    await adminApi.updateAgentTier(id, {
                      ...draft,
                      commission_rate: 0,
                      sub_override_rate: 0,
                      loss_confirmation: lossConfirmation,
                    });
                    markTierSaved(id);
                  }
                  await onReload();
                  showToast(fmt(aa.tierBatchSavedToast, { count: dirtyTiers.length }));
                } catch (err) {
                  showToast(err instanceof Error ? err.message : aa.tierBatchSaveFailErr);
                } finally {
                  setSavingBatchTiers(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {savingBatchTiers ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {fmt(aa.tierBatchSaveBtn, { count: dirtyTiers.length })}
            </button>
          )}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium font-mono-num shrink-0"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {fmt(aa.tierSafeFloorBadge, {
              safeRate: evaluateDiscountLosses.safeMinDiscount,
              ...discountDisplay(evaluateDiscountLosses.safeMinDiscount),
            })}
          </span>
        </div>
      </div>

      {/* 桌面端列头提示 + 一体化等级配置卡片（名称 / 升级费 / 拿货折扣 / SaaS 分站权限合二为一） */}
      <div className="space-y-2.5">
        <div
          className="hidden md:grid grid-cols-[minmax(160px,1.2fr)_minmax(110px,0.8fr)_minmax(170px,1.2fr)_auto] gap-3 px-3.5 pb-1 text-[11px] font-medium"
          style={{ color: 'var(--ink-muted)' }}
        >
          <span>{aa.tierColName}</span>
          <span>{aa.tierColFee}</span>
          <span>{aa.tierColDiscount}</span>
          <span className="text-right">{aa.tierColActions}</span>
        </div>

        {agentTiers.map((t) => {
          const td = tierDrafts[t.id] ?? tierToDraft(t);
          const isDirty = isTierDraftDirty(t, td);
          const isSaving = savingTierId === t.id;
          const isJustSaved = Boolean(savedTierIds[t.id]) && !isDirty;
          const rowLosses = evaluateDiscountLosses.check(td.discount_rate);

          return (
            <div
              key={t.id}
              className="rounded-xl border px-3.5 py-3 text-xs transition-colors"
              style={{
                borderColor: isDirty ? 'var(--accent)' : 'var(--border-color)',
                backgroundColor: isDirty
                  ? 'color-mix(in srgb, var(--accent-soft) 35%, var(--bg-canvas))'
                  : 'var(--bg-canvas)',
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-[minmax(160px,1.2fr)_minmax(110px,0.8fr)_minmax(170px,1.2fr)_auto] gap-3 items-center">
                <input
                  value={td.name}
                  onChange={(e) => patchDraft(t, { name: e.target.value })}
                  className="acct-input py-1 px-2.5 w-full max-w-[200px] text-xs font-medium"
                  aria-label={aa.tierColName}
                />

                <input
                  type="number"
                  value={td.min_recharge}
                  onChange={(e) => patchDraft(t, { min_recharge: Number(e.target.value) })}
                  className="acct-input py-1 px-2.5 w-full max-w-[130px] font-mono-num text-xs"
                  aria-label={aa.tierColFee}
                />

                <div className="inline-flex items-center gap-2 flex-wrap">
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1"
                    value={td.discount_rate}
                    onChange={(e) => patchDraft(t, { discount_rate: Number(e.target.value) })}
                    className="acct-input py-1 px-2.5 w-24 font-mono-num text-xs"
                    aria-label={aa.tierColDiscount}
                    style={{
                      borderColor:
                        rowLosses.length > 0 ? 'var(--danger)' : isDirty ? 'var(--accent)' : undefined,
                    }}
                  />
                  <span className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    {fmt(aa.tierRateShortTag, discountDisplay(td.discount_rate || 1))}
                  </span>
                  {rowLosses.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      {fmt(aa.tierRowLossBadge, {
                        count: rowLosses.length,
                        safeRate: evaluateDiscountLosses.safeMinDiscount,
                      })}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    disabled={isSaving || (!isDirty && !isJustSaved)}
                    onClick={async () => {
                      if (!isDirty) return;
                      setSavingTierId(t.id);
                      try {
                        const review = await reviewTierLoss(t.id, td);
                        if (!review.accepted) return;
                        await adminApi.updateAgentTier(t.id, {
                          ...td,
                          commission_rate: 0,
                          sub_override_rate: 0,
                          loss_confirmation: review.loss_confirmation,
                        });
                        await onReload();
                        markTierSaved(t.id);
                        showToast(fmt(aa.tierRowSavedToast, { name: td.name }));
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : aa.tierRowSaveFailErr);
                      } finally {
                        setSavingTierId(null);
                      }
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer disabled:cursor-default"
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
                      aa.tierBtnNoChanges
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await openConfirm({
                        title: aa.tierDeleteTitle,
                        description: fmt(aa.tierDeleteDesc, { name: t.name }),
                        confirmLabel: aa.tierDeleteConfirm,
                        tone: 'danger',
                      });
                      if (!ok) return;
                      await adminApi.deleteAgentTier(t.id);
                      await onReload();
                      showToast(aa.tierDeletedToast);
                    }}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <AdminTierCapabilitiesInline
                value={td}
                disabled={isSaving || savingBatchTiers}
                globalOwnPayEnabled={globalOwnPayEnabled}
                globalPrivateEnabled={globalPrivateEnabled}
                onChange={(patch) => patchDraft(t, patch)}
              />
            </div>
          );
        })}
      </div>

      {allDraftLosses.length > 0 && (
        <div
          className="p-4 rounded-xl border text-xs space-y-2"
          style={{
            borderColor: 'var(--danger)',
            backgroundColor: 'var(--danger-soft)',
            color: 'var(--danger)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" />
              {fmt(aa.tierLossAlertHeadline, {
                tierLabel: allDraftLosses[0].tierLabel,
                count: allDraftLosses[0].losses.length,
              })}
            </span>
            <span className="font-mono-num">
              {fmt(aa.tierLossAlertSuggest, {
                safeRate: evaluateDiscountLosses.safeMinDiscount,
                safePct: discountDisplay(evaluateDiscountLosses.safeMinDiscount).ratePct,
                safeFold: discountDisplay(evaluateDiscountLosses.safeMinDiscount).zhFold,
              })}
            </span>
          </div>
          <div className="space-y-1 text-[11px]" style={{ color: 'var(--ink-primary)' }}>
            {allDraftLosses[0].losses.slice(0, 4).map((l, idx) => (
              <div key={idx} className="font-mono-num">
                {fmt(aa.tierLossAlertLine, {
                  title: l.title,
                  specName: l.specName,
                  sell: l.sell,
                  agentPrice: l.agentPrice,
                  cost: l.cost,
                  loss: l.loss,
                })}
              </div>
            ))}
            {allDraftLosses[0].losses.length > 4 && (
              <div style={{ color: 'var(--ink-muted)' }}>
                {fmt(aa.tierLossAlertMore, { count: allDraftLosses[0].losses.length - 4 })}
              </div>
            )}
          </div>
        </div>
      )}

      <AdminTierCreateForm
        newTier={newTier}
        setNewTier={setNewTier}
        onReload={onReload}
        showToast={showToast}
      />
    </div>
  );
}
