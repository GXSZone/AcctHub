/**
 * 跨站一键免登 SSO 回调页（仅在目标分站域名下运行）
 * 读取一次性 60 秒加密票据并原子核销为本域名独立 JWT 会话，随后无痕跳转目标页面。
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/auth.api';
import { setAuthToken } from '../api/http';
import type { UserProfile } from '../types';

type SsoExchangePromise = ReturnType<typeof authApi.exchangeSso>;

// 同一一次性票据共享单次核销请求，防止 React 19 StrictMode 或父组件重渲染触发重复核销报 401
const inflightSsoExchanges = new Map<string, SsoExchangePromise>();

function exchangeTicketOnce(ticket: string): SsoExchangePromise {
  const existing = inflightSsoExchanges.get(ticket);
  if (existing) return existing;
  const req = authApi.exchangeSso(ticket);
  inflightSsoExchanges.set(ticket, req);
  return req;
}

export function SsoCallbackPage({ onSuccess }: { onSuccess: (user: UserProfile) => void }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const ticket = (searchParams.get('ticket') || '').trim();

  useEffect(() => {
    if (!ticket) {
      setError('Missing SSO ticket');
      return;
    }

    let cancelled = false;
    exchangeTicketOnce(ticket)
      .then((res) => {
        if (cancelled) return;
        setAuthToken(res.token);
        onSuccessRef.current(res.user);
        const nextPath = res.redirect_path?.startsWith('/') ? res.redirect_path : '/agent';
        navigate(nextPath, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'SSO verification failed');
      });

    return () => {
      cancelled = true;
    };
  }, [navigate, ticket]);

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center">
      {error ? (
        <div
          className="rounded-2xl border p-6 space-y-3"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-base font-semibold" style={{ color: 'var(--danger)' }}>
            SSO Verification Failed
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="px-4 py-2 rounded-full text-xs font-medium text-white"
            style={{ background: 'var(--accent)' }}
          >
            Back to Storefront
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
          <div
            className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
          />
          <span>Signing in to your store domain...</span>
        </div>
      )}
    </div>
  );
}
