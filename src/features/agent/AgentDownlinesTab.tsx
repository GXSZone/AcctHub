/**
 * 分站工作台 Tab 4：我的直属下级分站列表、调级与启停管理
 */

import { discountDisplay } from '@shared/domain/money';
import { Check, Loader2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type AgentMeResponse, agentApi } from '../../api/agent.api';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import type { AgentTierInfo } from '../../types';

interface AgentDownlinesTabProps {
  subAgents: AgentMeResponse['sub_agents'];
  myDownlineTiers: AgentTierInfo[];
  directSubCount: number;
  totalDownlineCount: number;
  onRefresh: () => Promise<void>;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AgentDownlinesTab({
  subAgents,
  myDownlineTiers,
  directSubCount,
  totalDownlineCount,
  onRefresh,
  onToast,
  onError,
}: AgentDownlinesTabProps) {
  const ag = useAgentI18n();
  const [downlineTierDrafts, setDownlineTierDrafts] = useState<Record<number, number>>({});
  const [savingDownlineId, setSavingDownlineId] = useState<number | null>(null);
  const [savedDownlineIds, setSavedDownlineIds] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const map: Record<number, number> = {};
    for (const sa of subAgents) {
      map[sa.id] = sa.tier_id || myDownlineTiers[0]?.id || 0;
    }
    setDownlineTierDrafts(map);
  }, [subAgents, myDownlineTiers]);

  const markSaved = (id: number) => {
    setSavedDownlineIds((p) => ({ ...p, [id]: true }));
    setTimeout(() => setSavedDownlineIds((p) => ({ ...p, [id]: false })), 1800);
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div>
          <h2 className="font-editorial text-xl font-semibold">{ag.dlTitle}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            {ag.dlDesc}
          </p>
        </div>
        <span
          className="text-xs font-mono-num px-3 py-1 rounded-full"
          style={{ backgroundColor: 'var(--bg-subtle)' }}
        >
          {fmt(ag.dlStatsBadge, { direct: directSubCount, total: totalDownlineCount })}
        </span>
      </div>

      {subAgents.length === 0 ? (
        <div className="py-12 text-center text-xs space-y-2" style={{ color: 'var(--ink-muted)' }}>
          <Users className="w-8 h-8 mx-auto opacity-40" />
          <div>{ag.dlEmpty}</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr
                className="border-b"
                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
              >
                <th className="py-2 pr-4">{ag.dlColStore}</th>
                <th className="py-2 pr-4">{ag.dlColTier}</th>
                <th className="py-2 pr-4">{ag.dlColMetrics}</th>
                <th className="py-2 text-right">{ag.dlColActions}</th>
              </tr>
            </thead>
            <tbody>
              {subAgents.map((sa) => {
                const persistedTierId = sa.tier_id || myDownlineTiers[0]?.id || 0;
                const draftTierId = downlineTierDrafts[sa.id] ?? persistedTierId;
                const activeTierObj = myDownlineTiers.find((t) => t.id === persistedTierId);
                const isDirty = Number(draftTierId) !== Number(persistedTierId);
                const isSaving = savingDownlineId === sa.id;
                const isJustSaved = Boolean(savedDownlineIds[sa.id]) && !isDirty;
                return (
                  <tr
                    key={sa.id}
                    className="border-b last:border-b-0 transition-colors"
                    style={{
                      borderColor: 'var(--border-color)',
                      backgroundColor: isDirty
                        ? 'color-mix(in srgb, var(--accent-soft) 45%, transparent)'
                        : undefined,
                    }}
                  >
                    <td className="py-3 pr-4">
                      <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                        <span>{sa.brand_name}</span>
                        <span className="font-mono-num text-[11px]" style={{ color: 'var(--accent)' }}>
                          @{sa.slug}
                        </span>
                        {sa.primary_domain && (
                          <span
                            className="font-mono-num text-[10.5px] px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--bg-subtle)' }}
                          >
                            {sa.primary_domain}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(ag.dlPaidOpenFee, {
                          email: sa.owner_email,
                          fee: Number(sa.total_recharged || 0).toFixed(0),
                        })}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <select
                          value={draftTierId}
                          onChange={(e) =>
                            setDownlineTierDrafts((p) => ({ ...p, [sa.id]: Number(e.target.value) }))
                          }
                          className="acct-input py-1 px-2 w-44 text-xs"
                          style={{ borderColor: isDirty ? 'var(--accent)' : undefined }}
                        >
                          {myDownlineTiers.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} (
                              {fmt(ag.discountFoldLabel, {
                                ...discountDisplay(t.discount_rate),
                              })}
                              )
                            </option>
                          ))}
                        </select>
                        {activeTierObj && (
                          <span
                            className="text-[10.5px] font-mono-num px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
                            title={ag.dlEffectiveTitle}
                          >
                            {fmt(ag.dlEffectiveBadge, {
                              ...discountDisplay(activeTierObj.discount_rate),
                            })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono-num">
                      <div>¥{Number(sa.total_revenue || 0).toFixed(2)}</div>
                      <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        {fmt(ag.dlSubCount, { count: sa.sub_count || 0 })}
                      </div>
                    </td>
                    <td className="py-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        disabled={isSaving || (!isDirty && !isJustSaved)}
                        onClick={async () => {
                          if (!isDirty) return;
                          setSavingDownlineId(sa.id);
                          try {
                            await agentApi.updateDirectDownline(sa.id, { tier_id: draftTierId });
                            await onRefresh();
                            markSaved(sa.id);
                            onToast(fmt(ag.dlUpdatedToast, { brand: sa.brand_name }));
                          } catch (err) {
                            onError(err instanceof Error ? err.message : ag.dlUpdateErr);
                          } finally {
                            setSavingDownlineId(null);
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
                            {ag.tiersSavingBtn}
                          </>
                        ) : isJustSaved ? (
                          <>
                            <Check className="w-3 h-3" />
                            {ag.tiersSavedBtn}
                          </>
                        ) : isDirty ? (
                          ag.dlSaveTierBtn
                        ) : (
                          ag.dlSyncedBtn
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await agentApi.updateDirectDownline(sa.id, {
                            status: sa.status === 'active' ? 'suspended' : 'active',
                          });
                          await onRefresh();
                          onToast(sa.status === 'active' ? ag.dlPausedToast : ag.dlEnabledToast);
                        }}
                        className="px-2.5 py-1 rounded-lg cursor-pointer"
                        style={{
                          backgroundColor:
                            sa.status === 'active' ? 'var(--success-soft)' : 'var(--danger-soft)',
                          color: sa.status === 'active' ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        {sa.status === 'active' ? ag.dlStatusActive : ag.dlStatusDisabled}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
