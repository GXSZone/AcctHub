/**
 * 跨站一键免登直达自己分站独立域名卡片（用于主站或异站域名访问 /agent 时）
 */

import { ExternalLink, Loader2, Store } from 'lucide-react';
import { useState } from 'react';
import { authApi } from '../../api/auth.api';
import { useSaasI18n } from '../../i18n/namespaces/saas';
import { toast } from '../../lib/toast';

export function AgentSsoRedirectCard({
  agentSlug,
  neutralBaseDomain,
  isOtherSub,
}: {
  agentSlug: string;
  neutralBaseDomain?: string;
  isOtherSub: boolean;
}) {
  const ss = useSaasI18n();
  const [jumping, setJumping] = useState(false);

  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  const isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.localhost');
  const previewOrigin = isLocal
    ? `${window.location.protocol}//${agentSlug}.localhost${portSuffix}`
    : neutralBaseDomain
      ? `https://${agentSlug}.${neutralBaseDomain}`
      : null;

  const handleJump = async () => {
    setJumping(true);
    try {
      const res = await authApi.issueSso('/agent');
      window.location.assign(res.redirect_url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : ss.ssoNoOriginHint);
      setJumping(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <div className="paper-card rounded-2xl p-8 space-y-5 text-center">
        <div
          className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <Store className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <div
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
          >
            {ss.ssoCardEyebrow}
          </div>
          <h1 className="font-editorial text-2xl font-semibold">
            {isOtherSub ? ss.ssoWrongStoreTitle : ss.ssoCardTitle}
          </h1>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {isOtherSub ? ss.ssoWrongStoreDesc : ss.ssoCardDesc}
          </p>
        </div>
        {previewOrigin && (
          <div
            className="p-3 rounded-xl border text-xs font-mono-num"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div className="text-[10.5px] font-sans mb-1" style={{ color: 'var(--ink-muted)' }}>
              {ss.ssoTargetDomainLabel}
            </div>
            {previewOrigin}
          </div>
        )}
        <button
          type="button"
          disabled={jumping}
          onClick={() => void handleJump()}
          className="w-full py-2.5 px-5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {jumping ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
          {jumping ? ss.ssoRedirectingBtn : ss.ssoEnterWorkbenchBtn}
        </button>
      </div>
    </div>
  );
}
