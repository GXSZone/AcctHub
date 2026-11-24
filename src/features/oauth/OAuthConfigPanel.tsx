/**
 * 主站总控与代理分站共用的第三方 OAuth 登录配置面板（纯独立白牌隔离模式）
 * mode = 'admin' 操作主站配置；mode = 'agent' 仅操作当前分站自身独立配置，互不暴露。
 */

import { OAUTH_PROVIDERS, type OAuthProvider } from '@shared/contracts/oauth.contract';
import { Copy, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOAuthI18n } from '../../i18n/namespaces/oauth';
import { useSaveSiteOAuthConfigMutation, useSiteOAuthConfigQuery } from '../../queries/oauth.queries';

interface OAuthConfigPanelProps {
  mode: 'admin' | 'agent';
  showToast: (msg: string) => void;
  onError?: (msg: string) => void;
}

interface ProviderDraft {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  clear_secret: boolean;
  has_secret: boolean;
  secret_masked: string;
  callback_path: string;
}

type ProviderDraftMap = Record<OAuthProvider, ProviderDraft>;

function createEmptyDrafts(): ProviderDraftMap {
  return {
    google: {
      enabled: false,
      client_id: '',
      client_secret: '',
      clear_secret: false,
      has_secret: false,
      secret_masked: '',
      callback_path: '/api/auth/oauth/google/callback',
    },
    github: {
      enabled: false,
      client_id: '',
      client_secret: '',
      clear_secret: false,
      has_secret: false,
      secret_masked: '',
      callback_path: '/api/auth/oauth/github/callback',
    },
    qq: {
      enabled: false,
      client_id: '',
      client_secret: '',
      clear_secret: false,
      has_secret: false,
      secret_masked: '',
      callback_path: '/api/auth/oauth/qq/callback',
    },
    wechat_open: {
      enabled: false,
      client_id: '',
      client_secret: '',
      clear_secret: false,
      has_secret: false,
      secret_masked: '',
      callback_path: '/api/auth/oauth/wechat_open/callback',
    },
    wechat_mp: {
      enabled: false,
      client_id: '',
      client_secret: '',
      clear_secret: false,
      has_secret: false,
      secret_masked: '',
      callback_path: '/api/auth/oauth/wechat_mp/callback',
    },
  };
}

export function OAuthConfigPanel({ mode, showToast, onError }: OAuthConfigPanelProps) {
  const oa = useOAuthI18n();
  const configQuery = useSiteOAuthConfigQuery(mode);
  const saveMutation = useSaveSiteOAuthConfigMutation(mode);
  const [callbackBaseUrl, setCallbackBaseUrl] = useState('');
  const [drafts, setDrafts] = useState<ProviderDraftMap>(createEmptyDrafts);

  useEffect(() => {
    const data = configQuery.data;
    if (!data) return;
    setCallbackBaseUrl(data.callback_base_url || '');
    const next = createEmptyDrafts();
    for (const item of data.providers) {
      next[item.provider] = {
        enabled: item.enabled,
        client_id: item.client_id,
        client_secret: '',
        clear_secret: false,
        has_secret: item.has_secret,
        secret_masked: item.secret_masked,
        callback_path: item.callback_path,
      };
    }
    setDrafts(next);
  }, [configQuery.data]);

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const effectiveOrigin = callbackBaseUrl.trim().replace(/\/+$/, '') || currentOrigin;

  const providerMeta: Record<OAuthProvider, { title: string; desc: string }> = {
    google: { title: oa.providerGoogle, desc: oa.providerGoogleDesc },
    github: { title: oa.providerGithub, desc: oa.providerGithubDesc },
    qq: { title: oa.providerQq, desc: oa.providerQqDesc },
    wechat_open: { title: oa.providerWechatOpen, desc: oa.providerWechatOpenDesc },
    wechat_mp: { title: oa.providerWechatMp, desc: oa.providerWechatMpDesc },
  };

  const updateProvider = (provider: OAuthProvider, patch: Partial<ProviderDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...patch },
    }));
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(oa.copiedToast);
    } catch {
      // 忽略无剪贴板权限环境
    }
  };

  const handleSave = async () => {
    try {
      const providersPayload: Partial<
        Record<
          OAuthProvider,
          { enabled: boolean; client_id: string; client_secret?: string; clear_secret?: boolean }
        >
      > = {};
      for (const p of OAUTH_PROVIDERS) {
        const d = drafts[p];
        providersPayload[p] = {
          enabled: d.enabled,
          client_id: d.client_id.trim(),
          client_secret: d.client_secret.trim() || undefined,
          clear_secret: d.clear_secret,
        };
      }
      await saveMutation.mutateAsync({
        callback_base_url: callbackBaseUrl.trim(),
        providers: providersPayload,
      });
      showToast(oa.savedToast);
    } catch (err) {
      const msg = err instanceof Error ? err.message : oa.saveFailed;
      onError?.(msg);
      if (!onError) showToast(msg);
    }
  };

  if (configQuery.isLoading) {
    return (
      <div
        className="paper-card rounded-2xl p-8 flex items-center justify-center gap-2 text-xs"
        style={{ color: 'var(--ink-muted)' }}
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-editorial text-xl font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {mode === 'admin' ? oa.panelTitleAdmin : oa.panelTitleAgent}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {mode === 'admin' ? oa.panelSubtitleAdmin : oa.panelSubtitleAgent}
        </p>
      </div>

      <div
        className="rounded-xl border p-3.5 flex items-start gap-2.5 text-xs"
        style={{
          borderColor: 'var(--border-color)',
          backgroundColor: 'var(--bg-canvas)',
          color: 'var(--ink-secondary)',
        }}
      >
        <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
        <span>{oa.whiteLabelNotice}</span>
      </div>

      <div>
        <div className="block text-xs font-semibold mb-1">{oa.callbackBaseLabel}</div>
        <input
          type="url"
          value={callbackBaseUrl}
          onChange={(e) => setCallbackBaseUrl(e.target.value)}
          placeholder={oa.callbackBasePlaceholder}
          className="acct-input font-mono-num text-xs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {OAUTH_PROVIDERS.map((provider) => {
          const item = drafts[provider];
          const meta = providerMeta[provider];
          const callbackUrl = `${effectiveOrigin}${item.callback_path}`;
          return (
            <div
              key={provider}
              className="rounded-2xl border p-4 space-y-3"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{meta.title}</div>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                    {meta.desc}
                  </p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => updateProvider(provider, { enabled: e.target.checked })}
                  />
                  <span>{oa.enabledLabel}</span>
                </label>
              </div>

              <div>
                <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--ink-secondary)' }}>
                  {oa.callbackUrlLabel}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    value={callbackUrl}
                    className="acct-input text-[11px] font-mono-num flex-1 opacity-85"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopy(callbackUrl)}
                    className="px-2.5 py-2 rounded-xl border text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <Copy className="w-3 h-3" />
                    {oa.copyBtn}
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium mb-1">{oa.clientIdLabel}</div>
                <input
                  type="text"
                  value={item.client_id}
                  onChange={(e) => updateProvider(provider, { client_id: e.target.value })}
                  className="acct-input text-xs font-mono-num"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium">{oa.clientSecretLabel}</span>
                  {item.has_secret && !item.clear_secret && (
                    <span className="text-[10px] font-mono-num" style={{ color: 'var(--success)' }}>
                      {oa.secretSavedHint}
                      {item.secret_masked}
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={item.client_secret}
                  onChange={(e) =>
                    updateProvider(provider, { client_secret: e.target.value, clear_secret: false })
                  }
                  placeholder={item.has_secret ? oa.secretPlaceholderKeep : oa.secretPlaceholderNew}
                  className="acct-input text-xs font-mono-num"
                />
                {item.has_secret && (
                  <label
                    className="inline-flex items-center gap-1.5 text-[11px] mt-1.5 cursor-pointer"
                    style={{ color: 'var(--ink-muted)' }}
                  >
                    <input
                      type="checkbox"
                      checked={item.clear_secret}
                      onChange={(e) => updateProvider(provider, { clear_secret: e.target.checked })}
                    />
                    <span>{oa.clearSecretLabel}</span>
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={saveMutation.isPending}
        onClick={() => void handleSave()}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium cursor-pointer disabled:opacity-60"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saveMutation.isPending ? oa.savingBtn : oa.saveBtn}
      </button>
    </div>
  );
}
