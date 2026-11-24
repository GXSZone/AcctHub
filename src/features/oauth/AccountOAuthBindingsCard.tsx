import type { OAuthProvider } from '@shared/contracts/oauth.contract';
import { Link2, Loader2, Unlink } from 'lucide-react';
import { useState } from 'react';
import { oauthApi } from '../../api/oauth.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { useOAuthI18n } from '../../i18n/namespaces/oauth';
import {
  useMyOAuthBindingsQuery,
  usePublicOAuthProvidersQuery,
  useUnbindOAuthMutation,
} from '../../queries/oauth.queries';

interface AccountOAuthBindingsCardProps {
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AccountOAuthBindingsCard({ onToast, onError }: AccountOAuthBindingsCardProps) {
  const oa = useOAuthI18n();
  const providersQuery = usePublicOAuthProvidersQuery(true);
  const bindingsQuery = useMyOAuthBindingsQuery(true);
  const unbindMutation = useUnbindOAuthMutation();
  const [bindingProvider, setBindingProvider] = useState<OAuthProvider | null>(null);

  const labelMap: Record<OAuthProvider, string> = {
    google: oa.providerGoogle,
    github: oa.providerGithub,
    qq: oa.providerQq,
    wechat_open: oa.providerWechatOpen,
    wechat_mp: oa.providerWechatMp,
  };

  const enabledProviders = (providersQuery.data?.providers || [])
    .filter((p) => p.enabled)
    .map((p) => p.provider);
  const bindings = bindingsQuery.data?.bindings || [];
  const bindingByProvider = new Map(bindings.map((b) => [b.provider, b]));

  const displayProviders = Array.from(
    new Set<OAuthProvider>([...enabledProviders, ...bindings.map((b) => b.provider)])
  );

  const handleBind = async (provider: OAuthProvider) => {
    setBindingProvider(provider);
    onError('');
    try {
      const res = await oauthApi.startAuthorize({
        provider,
        mode: 'bind',
        redirect_path: '/account/security',
      });
      window.location.href = res.authorize_url;
    } catch (err) {
      onError(err instanceof Error ? err.message : oa.startFailed);
      setBindingProvider(null);
    }
  };

  const handleUnbind = async (provider: OAuthProvider) => {
    const ok = await openConfirm({
      title: oa.unbindBtn,
      description: oa.unbindConfirm,
      tone: 'danger',
    });
    if (!ok) return;
    onError('');
    try {
      await unbindMutation.mutateAsync(provider);
      onToast(oa.unbindSuccess);
    } catch (err) {
      onError(err instanceof Error ? err.message : oa.unbindFailed);
    }
  };

  return (
    <div className="paper-card rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="font-editorial text-lg font-semibold flex items-center gap-1.5">
          <Link2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {oa.bindingsCardTitle}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {oa.bindingsCardDesc}
        </p>
      </div>

      {displayProviders.length === 0 ? (
        <p className="text-xs py-2" style={{ color: 'var(--ink-muted)' }}>
          {oa.bindingsEmptyProviders}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayProviders.map((provider) => {
            const bound = bindingByProvider.get(provider);
            const isEnabled = enabledProviders.includes(provider);
            return (
              <div
                key={provider}
                className="flex items-center justify-between gap-3 rounded-xl border p-3.5"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold truncate">{labelMap[provider]}</span>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
                      style={{
                        backgroundColor: bound ? 'var(--success-soft)' : 'var(--bg-subtle)',
                        color: bound ? 'var(--success)' : 'var(--ink-muted)',
                      }}
                    >
                      {bound ? oa.boundBadge : oa.unboundBadge}
                    </span>
                  </div>
                  {bound && (
                    <div className="text-[11px] truncate mt-1" style={{ color: 'var(--ink-secondary)' }}>
                      {bound.nickname || bound.email || bound.provider}
                    </div>
                  )}
                </div>

                {bound ? (
                  <button
                    type="button"
                    disabled={unbindMutation.isPending}
                    onClick={() => void handleUnbind(provider)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer inline-flex items-center gap-1 shrink-0"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                  >
                    <Unlink className="w-3 h-3" />
                    {oa.unbindBtn}
                  </button>
                ) : isEnabled ? (
                  <button
                    type="button"
                    disabled={bindingProvider !== null}
                    onClick={() => void handleBind(provider)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1 shrink-0"
                    style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                  >
                    {bindingProvider === provider && <Loader2 className="w-3 h-3 animate-spin" />}
                    {oa.bindBtn}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
