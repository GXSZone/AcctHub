/**
 * 分站工作台顶部头部栏与上级代理通知横幅组件
 */

import { discountDisplay } from '@shared/domain/money';
import { Award, BellRing, Check, ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmt } from '../../i18n';
import { useAgentI18n } from '../../i18n/namespaces/agent';
import { useCommonModalsI18n } from '../../i18n/namespaces/common-modals';
import type { AgentInfo, AgentTierInfo, Announcement } from '../../types';

interface AgentPortalHeaderProps {
  agent: AgentInfo;
  currentTier: AgentTierInfo | null;
  storefrontPublicUrl: string;
  storefrontPreviewUrl?: string;
  upstreamNotices: Announcement[];
  upstreamPopup: {
    enabled: boolean;
    title: string;
    content: string;
    frequency: string;
    version: string;
    source_name?: string;
  } | null;
  onOpenUpstreamPopup: () => void;
  onViewUpstreamNotice: (notice: Announcement) => void;
}

export function AgentPortalHeader({
  agent,
  currentTier,
  storefrontPublicUrl,
  storefrontPreviewUrl,
  upstreamNotices,
  upstreamPopup,
  onOpenUpstreamPopup,
  onViewUpstreamNotice,
}: AgentPortalHeaderProps) {
  const ag = useAgentI18n();
  const m = useCommonModalsI18n();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [noticeIndex, setNoticeIndex] = useState(0);
  const [noticePaused, setNoticePaused] = useState(false);

  useEffect(() => {
    if (upstreamNotices.length <= 1 || noticePaused) return;
    const timer = setInterval(() => {
      setNoticeIndex((prev) => (prev + 1) % upstreamNotices.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [upstreamNotices.length, noticePaused]);

  useEffect(() => {
    if (noticeIndex >= upstreamNotices.length) setNoticeIndex(0);
  }, [upstreamNotices.length, noticeIndex]);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ backgroundColor: currentTier?.badge_color || 'var(--accent)', color: '#FAF9F5' }}
            >
              <Award className="w-3 h-3" />
              {currentTier
                ? fmt(ag.headerTierBadge, {
                    name: currentTier.name,
                    ...discountDisplay(currentTier.discount_rate),
                  })
                : ag.headerCertifiedBadge}
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(storefrontPublicUrl);
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 1800);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-mono-num cursor-pointer"
              style={{
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--ink-secondary)',
              }}
              title={ag.headerCopyUrlTitle}
            >
              {copiedUrl ? (
                <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
              ) : (
                <Copy className="w-3 h-3" />
              )}
              <span className="max-w-[240px] truncate">
                {copiedUrl ? ag.headerUrlCopied : storefrontPublicUrl.replace(/^https?:\/\//, '')}
              </span>
            </button>
          </div>
          <h1 className="font-editorial text-2xl sm:text-3xl font-semibold mt-1.5">
            {fmt(ag.headerTitleSuffix, { brand: agent.brand_name })}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={storefrontPreviewUrl || storefrontPublicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium no-underline whitespace-nowrap"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {ag.headerVisitStoreBtn}
          </a>
        </div>
      </div>

      {(upstreamNotices.length > 0 || (upstreamPopup?.enabled && upstreamPopup.title)) && (
        <div
          className="p-4 rounded-2xl border space-y-2.5"
          style={{
            borderColor: 'color-mix(in srgb, var(--accent) 35%, var(--border-color))',
            backgroundColor: 'var(--accent-soft)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              <BellRing className="w-4 h-4 shrink-0" />
              {fmt(ag.headerUpstreamNoticePrefix, {
                source: upstreamPopup?.source_name || ag.defaultMainBrand,
              })}
            </div>
            {upstreamPopup?.enabled && (
              <button
                type="button"
                onClick={onOpenUpstreamPopup}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer border"
                style={{
                  borderColor: 'var(--accent)',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--accent)',
                }}
              >
                {ag.headerViewUpstreamPopupBtn}
              </button>
            )}
          </div>
          {upstreamNotices.length > 0 && (
            <section
              aria-label={fmt(ag.headerUpstreamNoticePrefix, {
                source: upstreamPopup?.source_name || ag.defaultMainBrand,
              })}
              className="rounded-xl border px-3 py-1.5 flex items-center justify-between gap-2"
              style={{
                borderColor: 'var(--border-color)',
                backgroundColor: 'var(--bg-surface)',
              }}
              onMouseEnter={() => setNoticePaused(true)}
              onMouseLeave={() => setNoticePaused(false)}
            >
              <div className="relative h-7 overflow-hidden flex-1 min-w-0">
                <div
                  className="transition-transform duration-500 ease-out"
                  style={{ transform: `translateY(-${noticeIndex * 28}px)` }}
                >
                  {upstreamNotices.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onViewUpstreamNotice(n)}
                      className="h-7 w-full flex items-center justify-between gap-2 text-left text-xs font-medium cursor-pointer hover:underline underline-offset-4 bg-transparent border-0 p-0"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{
                            backgroundColor: n.level === 'warning' ? 'var(--warning)' : 'var(--accent)',
                          }}
                        />
                        <span className="truncate">{n.title}</span>
                      </span>
                      {n.created_at && (
                        <span
                          className="text-[10.5px] font-mono-num shrink-0"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {n.created_at.slice(5, 10)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {upstreamNotices.length > 1 && (
                <div
                  className="inline-flex items-center gap-1 pl-2 border-l shrink-0"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <span className="font-mono-num text-[10.5px] mr-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {noticeIndex + 1}/{upstreamNotices.length}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setNoticeIndex((prev) => (prev - 1 + upstreamNotices.length) % upstreamNotices.length)
                    }
                    className="w-6 h-6 rounded-md inline-flex items-center justify-center cursor-pointer"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                    aria-label={m.ntcPrevAria}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setNoticeIndex((prev) => (prev + 1) % upstreamNotices.length)}
                    className="w-6 h-6 rounded-md inline-flex items-center justify-center cursor-pointer"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                    aria-label={m.ntcNextAria}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
