/**
 * 分站免费二级域名只读展示卡片（开通时已永久锁定，支持一键复制）
 */

import { Check, Copy, Lock } from 'lucide-react';
import { useState } from 'react';
import { useAgentI18n } from '../../i18n/namespaces/agent';

export function AgentSubdomainBox({
  agentSlug,
  neutralBaseDomain,
  onToast,
}: {
  agentSlug: string;
  neutralBaseDomain: string;
  onToast: (msg: string) => void;
}) {
  const ag = useAgentI18n();
  const [copiedUrl, setCopiedUrl] = useState(false);

  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.localhost'));
  const portSuffix = typeof window !== 'undefined' && window.location.port ? `:${window.location.port}` : '';
  const freeUrlPreview = neutralBaseDomain
    ? `https://${agentSlug}.${neutralBaseDomain}`
    : isLocalHost
      ? `http://${agentSlug}.localhost${portSuffix}`
      : `https://${agentSlug}`;

  const copyFreeUrl = async () => {
    try {
      await navigator.clipboard.writeText(freeUrlPreview);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1600);
    } catch {
      onToast(freeUrlPreview);
    }
  };

  return (
    <div
      className="p-3.5 rounded-xl border text-xs space-y-2.5"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold inline-flex items-center gap-1.5">
          {ag.domFreeUrlLabel}
          <Lock className="w-3 h-3 opacity-60" />
        </span>
        <button
          type="button"
          onClick={() => void copyFreeUrl()}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium cursor-pointer"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
        >
          {copiedUrl ? (
            <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          {copiedUrl ? ag.domCopiedBtn : ag.domCopyUrlBtn}
        </button>
      </div>

      <div
        className="flex items-center rounded-xl border overflow-hidden cursor-not-allowed select-all opacity-90"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--bg-subtle)',
        }}
        aria-disabled="true"
      >
        <span
          className="px-2.5 py-2 text-[11px] font-mono-num shrink-0 select-none"
          style={{ color: 'var(--ink-muted)', backgroundColor: 'var(--bg-subtle)' }}
        >
          {neutralBaseDomain ? 'https://' : isLocalHost ? 'http://' : 'https://'}
        </span>
        <span
          className="flex-1 min-w-0 px-2.5 py-2 text-xs font-mono-num font-medium truncate border-x"
          style={{
            color: 'var(--ink-muted)',
            backgroundColor: 'var(--bg-subtle)',
            borderColor: 'var(--border-color)',
          }}
        >
          {agentSlug}
        </span>
        <span
          className="px-2.5 py-2 text-[11px] font-mono-num shrink-0 select-none"
          style={{ color: 'var(--ink-muted)', backgroundColor: 'var(--bg-subtle)' }}
        >
          {neutralBaseDomain ? `.${neutralBaseDomain}` : `.localhost${portSuffix}`}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
        {ag.domSlugLockedHint}
      </p>
    </div>
  );
}
