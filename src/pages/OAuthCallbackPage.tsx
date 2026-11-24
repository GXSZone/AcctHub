/**
 * 第三方 OAuth 授权登录回调承接页（支持主站与独立分站各自域名的登录与账号绑定）
 * 通过 60 秒一次性票据安全核销换取当前域名 JWT 会话，避免在 URL 中暴露凭证。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setAuthToken } from '../api/http';
import { type OAuthExchangeResponse, oauthApi } from '../api/oauth.api';
import { useOAuthI18n } from '../i18n/namespaces/oauth';
import { toast } from '../lib/toast';
import type { UserProfile } from '../types';

const inflightOAuthExchanges = new Map<string, Promise<OAuthExchangeResponse>>();

function exchangeOAuthTicketOnce(ticket: string): Promise<OAuthExchangeResponse> {
  const existing = inflightOAuthExchanges.get(ticket);
  if (existing) return existing;
  const req = oauthApi.exchangeTicket(ticket);
  inflightOAuthExchanges.set(ticket, req);
  return req;
}

export function OAuthCallbackPage({ onSuccess }: { onSuccess: (user: UserProfile) => void }) {
  const oa = useOAuthI18n();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlError = (searchParams.get('error') || '').trim();
  const ticket = (searchParams.get('ticket') || '').trim();
  const [error, setError] = useState<string | null>(urlError || null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (urlError) {
      setError(urlError);
      return;
    }
    if (!ticket) {
      setError(oa.callbackFailedTitle);
      return;
    }

    let cancelled = false;
    exchangeOAuthTicketOnce(ticket)
      .then((res) => {
        if (cancelled) return;
        setAuthToken(res.token);
        onSuccessRef.current(res.user);
        toast.success(res.action === 'bind' ? oa.callbackBindSuccess : oa.callbackLoginSuccess);
        const fallbackPath = res.action === 'bind' ? '/account/security' : '/';
        const nextPath = res.redirect_path?.startsWith('/') ? res.redirect_path : fallbackPath;
        navigate(nextPath, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : oa.callbackFailedTitle);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, oa.callbackBindSuccess, oa.callbackFailedTitle, oa.callbackLoginSuccess, ticket, urlError]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center">
      {error ? (
        <div
          className="rounded-2xl border p-6 space-y-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-base font-semibold" style={{ color: 'var(--danger)' }}>
            {oa.callbackFailedTitle}
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="px-4 py-2 rounded-full text-xs font-medium text-white cursor-pointer"
            style={{ background: 'var(--accent)' }}
          >
            {oa.callbackBackHome}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
          <div
            className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
          <span>{oa.callbackProcessing}</span>
        </div>
      )}
    </div>
  );
}
