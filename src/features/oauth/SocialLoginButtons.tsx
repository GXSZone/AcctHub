import type { OAuthProvider, PublicOAuthProviderDto } from '@shared/contracts/oauth.contract';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { oauthApi } from '../../api/oauth.api';
import { useOAuthI18n } from '../../i18n/namespaces/oauth';

interface SocialLoginButtonsProps {
  providers?: PublicOAuthProviderDto[];
  referralCode?: string;
  onError: (msg: string) => void;
}

function isWeChatBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger/i.test(navigator.userAgent || '');
}

function ProviderIcon({ provider }: { provider: OAuthProvider }) {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M21.8 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.5a4.7 4.7 0 0 1-2.04 3.08v2.56h3.3c1.93-1.78 3.04-4.4 3.04-7.45z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.75 0 5.06-.91 6.75-2.47l-3.3-2.56c-.92.61-2.09.98-3.45.98-2.65 0-4.9-1.79-5.7-4.2H2.89v2.64A10 10 0 0 0 12 22z"
        />
        <path fill="#FBBC05" d="M6.3 13.75a5.98 5.98 0 0 1 0-3.5V7.61H2.89a10 10 0 0 0 0 8.78l3.41-2.64z" />
        <path
          fill="#EA4335"
          d="M12 6.05c1.5 0 2.84.52 3.9 1.53l2.92-2.92C17.05 3.01 14.74 2 12 2A10 10 0 0 0 2.89 7.61l3.41 2.64C7.1 7.84 9.35 6.05 12 6.05z"
        />
      </svg>
    );
  }
  if (provider === 'github') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 fill-current" aria-hidden="true">
        <path d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
      </svg>
    );
  }
  if (provider === 'qq') {
    return (
      <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="#12B7F5" aria-hidden="true">
        <path d="M12 2c-3.6 0-6.2 2.9-6.2 7.2 0 .5.04 1 .1 1.4-1.1 1.3-1.9 3.1-1.9 4.5 0 1 .4 1.5.9 1.5.4 0 .9-.4 1.4-1.2.4.8 1.1 1.5 1.9 2-.7.4-1.4 1-1.4 1.6 0 .8 1.3 1 2.9 1 1 0 1.8-.1 2.3-.4.5.3 1.3.4 2.3.4 1.6 0 2.9-.2 2.9-1 0-.6-.7-1.2-1.4-1.6.8-.5 1.5-1.2 1.9-2 .5.8 1 1.2 1.4 1.2.5 0 .9-.5.9-1.5 0-1.4-.8-3.2-1.9-4.5.06-.4.1-.9.1-1.4C18.2 4.9 15.6 2 12 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="#07C160" aria-hidden="true">
      <path d="M9.5 4C5.36 4 2 6.86 2 10.38c0 2.02 1.12 3.82 2.86 4.99l-.72 2.16 2.52-1.26c.9.25 1.85.39 2.84.39.25 0 .5-.01.74-.04a5.45 5.45 0 0 1-.24-1.62c0-3.17 2.92-5.74 6.53-5.74.35 0 .7.03 1.04.08C16.92 6.26 13.55 4 9.5 4zm6.96 6.25c-3.06 0-5.54 2.14-5.54 4.78 0 2.64 2.48 4.78 5.54 4.78.73 0 1.43-.12 2.08-.34l1.86.94-.53-1.6c1.29-.86 2.13-2.22 2.13-3.78 0-2.64-2.48-4.78-5.54-4.78z" />
    </svg>
  );
}

export function SocialLoginButtons({ providers = [], referralCode, onError }: SocialLoginButtonsProps) {
  const oa = useOAuthI18n();
  const [starting, setStarting] = useState<OAuthProvider | null>(null);

  const rawProviders = providers.filter((p) => p.enabled).map((p) => p.provider);
  const inWeChat = isWeChatBrowser();

  // 智能挑选当前浏览器下最合适的按钮集合（微信端优先公众号免扫码，非微信端走 PC 扫码）
  const visibleButtons: Array<{ provider: OAuthProvider; label: string }> = [];
  if (rawProviders.includes('google')) visibleButtons.push({ provider: 'google', label: oa.btnGoogle });
  if (rawProviders.includes('github')) visibleButtons.push({ provider: 'github', label: oa.btnGithub });
  if (rawProviders.includes('qq')) visibleButtons.push({ provider: 'qq', label: oa.btnQq });
  if (inWeChat && rawProviders.includes('wechat_mp')) {
    visibleButtons.push({ provider: 'wechat_mp', label: oa.btnWechat });
  } else if (rawProviders.includes('wechat_open')) {
    visibleButtons.push({ provider: 'wechat_open', label: oa.btnWechat });
  }

  if (visibleButtons.length === 0) return null;

  const handleStart = async (provider: OAuthProvider) => {
    setStarting(provider);
    onError('');
    try {
      const currentPath =
        typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '/';
      const res = await oauthApi.startAuthorize({
        provider,
        mode: 'login',
        redirect_path: currentPath.startsWith('/oauth/') ? '/' : currentPath,
        referral_code: referralCode || undefined,
      });
      window.location.href = res.authorize_url;
    } catch (err) {
      onError(err instanceof Error ? err.message : oa.startFailed);
      setStarting(null);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        <span className="h-px flex-1" style={{ backgroundColor: 'var(--border-color)' }} />
        <span>{oa.dividerOr}</span>
        <span className="h-px flex-1" style={{ backgroundColor: 'var(--border-color)' }} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {visibleButtons.map((btn) => (
          <button
            key={btn.provider}
            type="button"
            disabled={starting !== null}
            onClick={() => void handleStart(btn.provider)}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium cursor-pointer transition-colors disabled:opacity-60"
            style={{
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--ink-primary)',
            }}
          >
            {starting === btn.provider ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ProviderIcon provider={btn.provider} />
            )}
            <span>{btn.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
