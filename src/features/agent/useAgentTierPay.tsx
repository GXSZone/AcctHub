/**
 * 代理开通与补差升级的「先支付后提交申请」状态与弹窗编排 Hook
 */

import { discountDisplay } from '@shared/domain/money';
import { useEffect, useState } from 'react';
import { agentApi } from '../../api/agent.api';
import { AsyncCashierModal } from '../../components/AsyncCashierModal';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { toast } from '../../lib/toast';
import type { AgentInfo, AgentTierInfo, PaymentIntentInfo, PaymentMethod, UserProfile } from '../../types';
import { AgentTierPayModal, type TierPayConfirmPayload } from './AgentTierPayModal';

export function useAgentTierPay(opts: {
  user: UserProfile | null;
  isSuperAdmin: boolean;
  agent: AgentInfo | null;
  meLoading: boolean;
  totalRecharged: number;
  balance: number;
  neutralBaseDomain?: string;
  paymentMethods: PaymentMethod[];
  onOpenAuth: () => void;
  onRefetchMe: () => Promise<unknown>;
  onRefreshUser: () => void;
  showToast: (msg: string) => void;
}) {
  const {
    user,
    isSuperAdmin,
    agent,
    meLoading,
    totalRecharged,
    balance,
    neutralBaseDomain,
    paymentMethods,
    onOpenAuth,
    onRefetchMe,
    onRefreshUser,
    showToast,
  } = opts;
  const ag = useAgentI18n();
  const [recharging, setRecharging] = useState(false);
  const [payModalTier, setPayModalTier] = useState<AgentTierInfo | null>(null);
  const [pendingAfterAuthTier, setPendingAfterAuthTier] = useState<AgentTierInfo | null>(null);
  const [activeIntent, setActiveIntent] = useState<{
    intent: PaymentIntentInfo;
    tier: AgentTierInfo;
    isUpgrade: boolean;
  } | null>(null);

  // 未登录点击开通代理后，完成登录即自动拉起目标等级的支付收银弹窗
  useEffect(() => {
    if (user && !isSuperAdmin && pendingAfterAuthTier && !meLoading) {
      if (!agent) setPayModalTier(pendingAfterAuthTier);
      setPendingAfterAuthTier(null);
    }
  }, [agent, isSuperAdmin, meLoading, pendingAfterAuthTier, user]);

  const openTierPay = (tier: AgentTierInfo) => {
    if (!user) {
      setPendingAfterAuthTier(tier);
      onOpenAuth();
      return;
    }
    setPayModalTier(tier);
  };

  const handleConfirmTierPay = async (payload: TierPayConfirmPayload) => {
    const tier = payModalTier;
    if (!tier || !user) return;
    setRecharging(true);
    toast.clearErrors();
    try {
      const res = await agentApi.recharge({
        target_tier_id: tier.id,
        payment_method: payload.paymentMethod,
        desired_slug: payload.desiredSlug,
        desired_brand_name: payload.desiredBrandName,
      });
      if (res.requires_payment && res.payment_intent) {
        setPayModalTier(null);
        setActiveIntent({ intent: res.payment_intent, tier, isUpgrade: Boolean(agent) });
        return;
      }
      const unlockedRate = res.unlocked_tier?.discount_rate || tier.discount_rate;
      const unlockedName = res.unlocked_tier?.name || tier.name;
      setPayModalTier(null);
      showToast(
        res.auto_created_agent
          ? fmt(ag.openSuccessToast, { name: unlockedName })
          : fmt(ag.upgradeSuccessToast, {
              name: unlockedName,
              ...discountDisplay(unlockedRate),
            })
      );
      await onRefetchMe();
      onRefreshUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ag.tierActionFailErr);
    } finally {
      setRecharging(false);
    }
  };

  const overlays = (
    <>
      <AgentTierPayModal
        open={Boolean(payModalTier)}
        tier={payModalTier}
        isUpgrade={Boolean(agent)}
        amountDue={
          payModalTier ? Math.max(0, Number((payModalTier.min_recharge - totalRecharged).toFixed(2))) : 0
        }
        userBalance={balance}
        neutralBaseDomain={neutralBaseDomain}
        paymentMethods={paymentMethods}
        submitting={recharging}
        onClose={() => setPayModalTier(null)}
        onConfirmPay={(payload) => void handleConfirmTierPay(payload)}
      />
      <AsyncCashierModal
        intent={activeIntent?.intent ?? null}
        onClose={() => setActiveIntent(null)}
        onPaid={async () => {
          const paid = activeIntent;
          setActiveIntent(null);
          if (paid) {
            showToast(
              paid.isUpgrade
                ? fmt(ag.upgradeSuccessToast, {
                    name: paid.tier.name,
                    ...discountDisplay(paid.tier.discount_rate),
                  })
                : fmt(ag.openSuccessToast, { name: paid.tier.name })
            );
          }
          await onRefetchMe();
          onRefreshUser();
        }}
      />
    </>
  );

  return { recharging, openTierPay, overlays };
}
