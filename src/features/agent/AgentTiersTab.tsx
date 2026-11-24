/**
 * 分站工作台 Tab 3：自定义下级代理等级（含防亏底线校验与 4 态保存反馈）
 */

import { discountDisplay } from '@shared/domain/money';
import { AlertTriangle, Check, Loader2, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { agentApi } from '../../api/agent.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import type { AgentTierInfo } from '../../types';

interface AgentTiersTabProps {
  myDownlineTiers: AgentTierInfo[];
  myDiscountFloor: number;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentTiersTab({
  myDownlineTiers,
  myDiscountFloor,
  onRefresh,
  onToast,
  onError,
}: AgentTiersTabProps) {
  const ag = useAgentI18n();
  const [tierDrafts, setTierDrafts] = useState<
    Record<number, { name: string; min_recharge: number; discount_rate: number }>
  >({});
  const [newDownlineTier, setNewDownlineTier] = useState({
    name: '',
    min_recharge: 199,
    discount_rate: Math.min(0.99, Math.max(myDiscountFloor, Number((myDiscountFloor + 0.05).toFixed(2)))),
  });
  const [savingTierId, setSavingTierId] = useState<number | 'new' | null>(null);
  const [savedTierIds, setSavedTierIds] = useState<Record<number, boolean>>({});
  const [savingBatchTiers, setSavingBatchTiers] = useState(false);

  useEffect(() => {
    const map: Record<number, { name: string; min_recharge: number; discount_rate: number }> = {};
    for (const t of myDownlineTiers) {
      map[t.id] = { name: t.name, min_recharge: t.min_recharge, discount_rate: t.discount_rate };
    }
    setTierDrafts(map);
    setNewDownlineTier((prev) => ({
      ...prev,
      discount_rate: Math.min(0.99, Math.max(myDiscountFloor, Number((myDiscountFloor + 0.05).toFixed(2)))),
    }));
  }, [myDownlineTiers, myDiscountFloor]);

  const markTierSaved = (id: number) => {
    setSavedTierIds((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSavedTierIds((p) => ({ ...p, [id]: false })), 1800);
  };

  const dirtyTiers = myDownlineTiers.filter((t) => {
    const d = tierDrafts[t.id];
    if (!d) return false;
    return (
      d.name !== t.name ||
      Number(d.min_recharge) !== Number(t.min_recharge) ||
      Math.abs(Number(d.discount_rate) - Number(t.discount_rate)) > 0.0001
    );
  });
  const anyBelowFloor = dirtyTiers.some(
    (t) => Number(tierDrafts[t.id]?.discount_rate ?? t.discount_rate) + 0.0001 < myDiscountFloor
  );

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div
        className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{ag.tiersTitle}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.tiersDesc}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {dirtyTiers.length >= 2 && (
            <button
              type="button"
              disabled={savingBatchTiers || anyBelowFloor}
              onClick={async () => {
                setSavingBatchTiers(true);
                onError('');
                try {
                  for (const t of dirtyTiers) {
                    const d = tierDrafts[t.id];
                    await agentApi.updateDownlineTier(t.id, d);
                    markTierSaved(t.id);
                  }
                  await onRefresh();
                  onToast(fmt(ag.tiersBatchSavedToast, { count: dirtyTiers.length }));
                } catch (err) {
                  onError(err instanceof Error ? err.message : ag.tiersBatchSaveErr);
                } finally {
                  setSavingBatchTiers(false);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {savingBatchTiers ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {fmt(ag.tiersBatchSaveBtn, { count: dirtyTiers.length })}
            </button>
          )}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono-num font-semibold shrink-0"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {fmt(ag.tiersFloorBanner, {
              floor: myDiscountFloor,
              ...discountDisplay(myDiscountFloor),
            })}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr
              className="border-b"
              style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
            >
              <th className="py-2 pr-3">{ag.tiersColName}</th>
              <th className="py-2 pr-3">{ag.tiersColFee}</th>
              <th className="py-2 pr-3">{fmt(ag.tiersColDiscount, { floor: myDiscountFloor })}</th>
              <th className="py-2 pr-3">{ag.tiersColSpread}</th>
              <th className="py-2 text-right">{ag.tiersColActions}</th>
            </tr>
          </thead>
          <tbody>
            {myDownlineTiers.map((t) => {
              const d = tierDrafts[t.id] || {
                name: t.name,
                min_recharge: t.min_recharge,
                discount_rate: t.discount_rate,
              };
              const isDirty =
                d.name !== t.name ||
                Number(d.min_recharge) !== Number(t.min_recharge) ||
                Math.abs(Number(d.discount_rate) - Number(t.discount_rate)) > 0.0001;
              const isSaving = savingTierId === t.id;
              const isJustSaved = Boolean(savedTierIds[t.id]) && !isDirty;
              const belowFloor = d.discount_rate + 0.0001 < myDiscountFloor;
              const spreadPct = Number(((d.discount_rate - myDiscountFloor) * 100).toFixed(1));
              return (
                <tr
                  key={t.id}
                  className="border-b last:border-b-0 transition-colors"
                  style={{
                    borderColor: 'var(--border-color)',
                    backgroundColor: isDirty
                      ? 'color-mix(in srgb, var(--accent-soft) 45%, transparent)'
                      : undefined,
                  }}
                >
                  <td className="py-2.5 pr-3">
                    <input
                      value={d.name}
                      onChange={(e) =>
                        setTierDrafts((p) => ({ ...p, [t.id]: { ...d, name: e.target.value } }))
                      }
                      className="acct-input py-1 px-2.5 w-44 text-xs"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input
                      type="number"
                      min={10}
                      value={d.min_recharge}
                      onChange={(e) =>
                        setTierDrafts((p) => ({
                          ...p,
                          [t.id]: { ...d, min_recharge: Number(e.target.value) },
                        }))
                      }
                      className="acct-input py-1 px-2.5 w-28 font-mono-num text-xs"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="inline-flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min={myDiscountFloor}
                        max={1}
                        value={d.discount_rate}
                        onChange={(e) =>
                          setTierDrafts((p) => ({
                            ...p,
                            [t.id]: { ...d, discount_rate: Number(e.target.value) },
                          }))
                        }
                        className="acct-input py-1 px-2.5 w-24 font-mono-num text-xs"
                        style={{
                          borderColor: belowFloor ? 'var(--danger)' : isDirty ? 'var(--accent)' : undefined,
                        }}
                      />
                      <span className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        (
                        {fmt(ag.discountFoldLabel, {
                          ...discountDisplay(d.discount_rate || 1),
                        })}
                        )
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-mono-num font-semibold">
                    {belowFloor ? (
                      <span className="inline-flex items-center gap-1" style={{ color: 'var(--danger)' }}>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {ag.tiersLossBlocked}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--success)' }}>
                        {fmt(ag.tiersSpreadBadge, { pct: spreadPct })}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap space-x-1.5">
                    <button
                      type="button"
                      disabled={belowFloor || isSaving || (!isDirty && !isJustSaved)}
                      onClick={async () => {
                        if (!isDirty) return;
                        setSavingTierId(t.id);
                        onError('');
                        try {
                          await agentApi.updateDownlineTier(t.id, d);
                          await onRefresh();
                          markTierSaved(t.id);
                          onToast(fmt(ag.tiersSingleSavedToast, { name: d.name }));
                        } catch (err) {
                          onError(err instanceof Error ? err.message : ag.bdSaveFailErr);
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
                        opacity: belowFloor ? 0.45 : 1,
                      }}
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {ag.tiersSavingBtn}
                        </>
                      ) : isJustSaved ? (
                        <>
                          <Check className="w-3 h-3" />
                          {ag.tiersSavedBtn}
                        </>
                      ) : isDirty ? (
                        ag.tiersSaveChangesBtn
                      ) : (
                        ag.tiersNoChangesBtn
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await openConfirm({
                          title: ag.tiersDeleteTitle,
                          description: fmt(ag.tiersDeleteDesc, { name: t.name }),
                          confirmLabel: ag.tiersDeleteConfirmBtn,
                          tone: 'danger',
                        });
                        if (!ok) return;
                        try {
                          await agentApi.deleteDownlineTier(t.id);
                          await onRefresh();
                          onToast(ag.tiersDeletedToast);
                        } catch (err) {
                          onError(err instanceof Error ? err.message : ag.tiersDeleteErr);
                        }
                      }}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSavingTierId('new');
          onError('');
          try {
            await agentApi.createDownlineTier({
              name: newDownlineTier.name,
              min_recharge: newDownlineTier.min_recharge,
              discount_rate: newDownlineTier.discount_rate,
              level_rank: myDownlineTiers.length + 1,
            });
            setNewDownlineTier((n) => ({ ...n, name: '' }));
            await onRefresh();
            onToast(ag.tiersAddedToast);
          } catch (err) {
            onError(err instanceof Error ? err.message : ag.tiersAddErr);
          } finally {
            setSavingTierId(null);
          }
        }}
        className="pt-4 border-t grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.tiersNewNameLabel}
          </div>
          <input
            required
            placeholder={ag.tiersNewNamePlaceholder}
            value={newDownlineTier.name}
            onChange={(e) => setNewDownlineTier({ ...newDownlineTier, name: e.target.value })}
            className="acct-input h-9 text-xs"
          />
        </div>
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.tiersNewFeeLabel}
          </div>
          <input
            type="number"
            min={10}
            required
            value={newDownlineTier.min_recharge}
            onChange={(e) => setNewDownlineTier({ ...newDownlineTier, min_recharge: Number(e.target.value) })}
            className="acct-input h-9 text-xs font-mono-num"
          />
        </div>
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {fmt(ag.tiersNewDiscountLabel, { floor: myDiscountFloor })}
          </div>
          <input
            type="number"
            step="0.01"
            min={myDiscountFloor}
            max={1}
            required
            value={newDownlineTier.discount_rate}
            onChange={(e) =>
              setNewDownlineTier({ ...newDownlineTier, discount_rate: Number(e.target.value) })
            }
            className="acct-input h-9 text-xs font-mono-num"
            style={{
              borderColor:
                newDownlineTier.discount_rate + 0.0001 < myDiscountFloor ? 'var(--danger)' : undefined,
            }}
          />
        </div>
        <button
          type="submit"
          disabled={savingTierId === 'new' || newDownlineTier.discount_rate + 0.0001 < myDiscountFloor}
          className="h-9 px-4 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <Plus className="w-3.5 h-3.5" />
          {ag.tiersAddBtn}
        </button>
      </form>
    </div>
  );
}
