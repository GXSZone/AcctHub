/**
 * 代理门户未开通引导视图（含总管理员提示卫士与阶梯等级卡片）
 */

import { discountDisplay } from '@shared/domain/money';
import { Check, Loader2, ShieldCheck, Sparkles, Store } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import type { AgentTierInfo, UserProfile } from '../../types';

interface AgentOnboardingViewProps {
  user: UserProfile | null;
  siteBrandName: string;
  tiers: AgentTierInfo[];
  recharging: boolean;
  onJoinOrUpgrade: (tier: AgentTierInfo) => void;
}

export function AgentSuperAdminGuard() {
  const ag = useAgentI18n();
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="paper-card rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h1 className="font-editorial text-2xl font-semibold">{ag.adminIdentityTitle}</h1>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {ag.adminIdentityDesc}
            </p>
          </div>
        </div>
        <Link
          to="/admin"
          className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold no-underline whitespace-nowrap shrink-0"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          <ShieldCheck className="w-4 h-4" />
          {ag.gotoAdminBtn}
        </Link>
      </div>
    </div>
  );
}

export function AgentOnboardingView({
  user,
  siteBrandName,
  tiers,
  recharging,
  onJoinOrUpgrade,
}: AgentOnboardingViewProps) {
  const ag = useAgentI18n();
  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div className="max-w-2xl space-y-2.5">
        <div
          className="text-[11px] font-mono-num uppercase tracking-[0.14em]"
          style={{ color: 'var(--accent)' }}
        >
          PARTNER STOREFRONT & B2B WHOLESALE
        </div>
        <h1 className="font-editorial text-3xl sm:text-4xl font-semibold">
          {fmt(ag.onboardHeadline, { siteBrandName })}
        </h1>
        <p className="text-xs sm:text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {ag.onboardSubtitle}
        </p>
      </div>

      {tiers.length === 0 ? (
        <div className="paper-card rounded-2xl p-10 text-center space-y-2">
          <Store className="w-8 h-8 mx-auto opacity-40" />
          <div className="font-editorial text-lg font-semibold">{ag.recruitClosedTitle}</div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {ag.recruitClosedDesc}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {tiers.map((tier) => {
            const discountText = fmt(ag.discountFoldLabel, {
              ...discountDisplay(tier.discount_rate),
            });
            return (
              <div
                key={tier.id}
                className="paper-card rounded-2xl p-6 flex flex-col justify-between gap-6"
                style={{ borderColor: 'var(--border-color)' }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${tier.badge_color} 15%, var(--bg-canvas))`,
                        color: tier.badge_color,
                      }}
                    >
                      {tier.name}
                    </span>
                    <span className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      LV.{tier.level_rank}
                    </span>
                  </div>

                  <div className="mt-5 flex items-baseline gap-2">
                    <span className="font-mono-num text-3xl font-bold" style={{ color: tier.badge_color }}>
                      {discountText}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
                      {ag.supplyPriceLabel}
                    </span>
                  </div>

                  <div
                    className="mt-4 p-3 rounded-xl flex items-center justify-between text-xs"
                    style={{ backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <span style={{ color: 'var(--ink-muted)' }}>{ag.openFeeLabel}</span>
                    <span className="font-mono-num font-bold text-base">¥{tier.min_recharge}</span>
                  </div>

                  <ul
                    className="mt-4 space-y-2 text-xs leading-relaxed"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    {(tier.perks || []).map((perk, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                        <span>{perk}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={recharging}
                  onClick={() => onJoinOrUpgrade(tier)}
                  className="w-full py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                >
                  {recharging ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {user ? fmt(ag.openNowBtn, { amount: tier.min_recharge }) : ag.loginToOpenBtn}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {[
          { title: ag.feat1Title, desc: ag.feat1Desc },
          { title: ag.feat2Title, desc: ag.feat2Desc },
          { title: ag.feat3Title, desc: ag.feat3Desc },
        ].map((c) => (
          <div key={c.title} className="paper-card rounded-2xl p-5 space-y-1.5">
            <div className="font-semibold text-sm">{c.title}</div>
            <p className="leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {c.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
