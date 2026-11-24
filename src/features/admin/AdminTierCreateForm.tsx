/**
 * 代理等级折扣防亏评估纯函数与新增代理等级表单
 */

import { discountDisplay } from '@shared/domain/money';
import { Plus } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminAgentsI18n } from '../../i18n/namespaces/admin-agents';
import type { AdminProductRow } from './admin.types';

export interface DiscountLossRow {
  productId: number;
  title: string;
  specName: string;
  sell: number;
  cost: number;
  agentPrice: number;
  loss: number;
}

export function createDiscountLossEvaluator(products: AdminProductRow[], startingPriceLabel: string) {
  const activeProducts = products.filter((p) => p.is_active);
  let maxCostRatio = 0;
  for (const p of activeProducts) {
    const bc = Number(p.cost_price ?? p.upstream_cost ?? 0);
    if (bc > 0 && p.base_price > 0) maxCostRatio = Math.max(maxCostRatio, bc / p.base_price);
    for (const s of p.specs || []) {
      const sc = Number(s.cost_price || 0);
      if (sc > 0 && s.price > 0) maxCostRatio = Math.max(maxCostRatio, sc / s.price);
    }
  }
  const safeMinDiscount = maxCostRatio > 0 ? Math.min(1, Math.ceil(maxCostRatio * 100 - 1e-9) / 100) : 0.1;

  const check = (discountRate: number): DiscountLossRow[] => {
    const losses: DiscountLossRow[] = [];
    if (!Number.isFinite(discountRate) || discountRate <= 0) return losses;
    for (const p of activeProducts) {
      const bc = Number(p.cost_price ?? p.upstream_cost ?? 0);
      if (bc > 0 && p.base_price > 0) {
        const ap = Number((p.base_price * discountRate).toFixed(2));
        if (ap + 0.001 < bc) {
          losses.push({
            productId: p.id,
            title: p.title,
            specName: startingPriceLabel,
            sell: p.base_price,
            cost: bc,
            agentPrice: ap,
            loss: Number((bc - ap).toFixed(2)),
          });
        }
      }
      for (const s of p.specs || []) {
        const sc = Number(s.cost_price || 0);
        if (sc > 0 && s.price > 0) {
          const ap = Number((s.price * discountRate).toFixed(2));
          if (ap + 0.001 < sc) {
            losses.push({
              productId: p.id,
              title: p.title,
              specName: s.name || s.id,
              sell: s.price,
              cost: sc,
              agentPrice: ap,
              loss: Number((sc - ap).toFixed(2)),
            });
          }
        }
      }
    }
    return losses;
  };

  return { safeMinDiscount, check };
}

export interface NewTierDraft {
  code: string;
  name: string;
  level_rank: number;
  min_recharge: number;
  discount_rate: number;
  commission_rate: number;
  sub_override_rate: number;
  max_sub_agents: number;
  badge_color: string;
}

interface AdminTierCreateFormProps {
  newTier: NewTierDraft;
  setNewTier: Dispatch<SetStateAction<NewTierDraft>>;
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminTierCreateForm({ newTier, setNewTier, onReload, showToast }: AdminTierCreateFormProps) {
  const aa = useAdminAgentsI18n();
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
          const discount = discountDisplay(newTier.discount_rate);
          const risk = await adminApi.previewNewAgentTierLoss(newTier.code, newTier.discount_rate);
          if (risk.loss_confirmation) {
            const top = risk.loss_items[0];
            const safe = discountDisplay(risk.safe_min_discount);
            const ok = await openConfirm({
              title: aa.tierNewLossTitle,
              description: fmt(aa.tierNewLossDesc, {
                name: newTier.name,
                ...discount,
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
              confirmLabel: aa.tierNewLossConfirm,
              cancelLabel: aa.tierNewLossCancel,
              tone: 'danger',
            });
            if (!ok) return;
          }
          await adminApi.createAgentTier({
            ...newTier,
            commission_rate: 0,
            sub_override_rate: 0,
            loss_confirmation: risk.loss_confirmation ?? undefined,
            perks: [
              fmt(aa.tierPerkRate, discount),
              fmt(aa.tierPerkFee, { fee: newTier.min_recharge }),
              aa.tierPerkDownline,
            ],
          });
          setNewTier((n) => ({ ...n, code: '', name: '', level_rank: n.level_rank + 1 }));
          await onReload();
          showToast(aa.tierCreatedToast);
        } catch (err) {
          showToast(err instanceof Error ? err.message : aa.tierCreateFailErr);
        } finally {
          setSubmitting(false);
        }
      }}
      className="pt-4 border-t grid grid-cols-2 md:grid-cols-5 gap-2 items-center"
      style={{ borderColor: 'var(--border-color)' }}
    >
      <input
        required
        placeholder={aa.tierNamePlaceholder}
        value={newTier.name}
        onChange={(e) => setNewTier({ ...newTier, name: e.target.value })}
        className="acct-input py-1.5 text-xs"
      />
      <input
        required
        placeholder={aa.tierCodePlaceholder}
        value={newTier.code}
        onChange={(e) => setNewTier({ ...newTier, code: e.target.value })}
        className="acct-input py-1.5 text-xs font-mono-num"
      />
      <input
        type="number"
        placeholder={aa.tierFeePlaceholder}
        value={newTier.min_recharge}
        onChange={(e) => setNewTier({ ...newTier, min_recharge: Number(e.target.value) })}
        className="acct-input py-1.5 text-xs font-mono-num"
      />
      <input
        type="number"
        step="0.01"
        placeholder={aa.tierDiscountPlaceholder}
        value={newTier.discount_rate}
        onChange={(e) => setNewTier({ ...newTier, discount_rate: Number(e.target.value) })}
        className="acct-input py-1.5 text-xs font-mono-num"
      />
      <button
        type="submit"
        disabled={submitting}
        className="h-9 px-3 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        <Plus className="w-3.5 h-3.5" />
        {aa.tierCreateBtn}
      </button>
    </form>
  );
}
