import { Loader2, Sparkles, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api/auth.api';
import { ApiRequestError, getAuthScope, getAuthToken, setAuthToken } from '../api/http';
import { SocialLoginButtons } from '../features/oauth/SocialLoginButtons';
import { fmt } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { useExtensionsI18n } from '../i18n/namespaces/extensions';
import { useRiskControlI18n } from '../i18n/namespaces/risk-control';
import { toast } from '../lib/toast';
import { attachDialogLightDismissFallback, closeDialogSmoothly } from '../lib/uiHelpers';
import type { BootstrapPayload, UserProfile } from '../types';
import { TurnstileWidget } from './TurnstileWidget';

interface AuthModalProps {
  open: boolean;
  bootstrap?: BootstrapPayload | null;
  onClose: () => void;
  onSuccess: (user: UserProfile) => void;
}

export function AuthModal({ open, bootstrap, onClose, onSuccess }: AuthModalProps) {
  const m = useCommonModalsI18n();
  const pc = useExtensionsI18n();
  const rf = useRiskControlI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReset, setTurnstileReset] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError('');
      setCodeSent(false);
      setResetCode('');
      try {
        const sp = new URLSearchParams(window.location.search);
        const urlRef = (sp.get('ref') || '').trim();
        const storedRef = localStorage.getItem('accthub_ref_code') || '';
        const candidate = (urlRef || storedRef).trim().toUpperCase();
        if (candidate) setReferralCode(candidate);
      } catch {
        // 忽略存储异常
      }
      dialog.showModal();
    } else if (!open && dialog.open) {
      void closeDialogSmoothly(dialog);
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    return attachDialogLightDismissFallback(dialog, onClose);
  }, [onClose]);

  const handleClose = () => {
    void closeDialogSmoothly(dialogRef.current).then(onClose);
  };

  const handleSendResetCode = async () => {
    if (!email.trim()) return;
    setError('');
    setSendingCode(true);
    try {
      await authApi.forgotPassword(email.trim());
      setCodeSent(true);
      toast.success(rf.authCodeSentToast);
    } catch (err) {
      setError(err instanceof Error ? err.message : m.authOpFailed);
    } finally {
      setSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'forgot') {
        await authApi.resetPassword(email.trim(), resetCode.trim(), password);
        toast.success(rf.authResetSuccessToast);
        setPassword('');
        setResetCode('');
        setCodeSent(false);
        setMode('login');
        return;
      }
      const priorScope = getAuthScope();
      const priorToken = getAuthToken();
      const res =
        mode === 'login'
          ? await authApi.login(email, password, turnstileToken || undefined, totpCode || undefined)
          : await authApi.register(
              email,
              password,
              displayName,
              turnstileToken || undefined,
              affiliateEnabled ? referralCode : undefined
            );
      if (priorToken) await authApi.logout(priorToken);
      if (getAuthScope() !== priorScope) {
        await authApi.logout(res.token);
        return;
      }
      setAuthToken(res.token);
      onSuccess(res.user);
      handleClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'TOTP_REQUIRED') {
        setTotpRequired(true);
      }
      setError(err instanceof Error ? err.message : m.authOpFailed);
      setTurnstileReset((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  const quickFillDemo = (type: 'member' | 'agent' | 'admin') => {
    setMode('login');
    if (type === 'member') {
      setEmail('member@accthub.dev');
      setPassword('member123456');
    } else if (type === 'agent') {
      setEmail('demo@accthub.dev');
      setPassword('demo123456');
    } else {
      setEmail('admin@accthub.dev');
      setPassword('admin123456');
    }
  };

  const brandName = bootstrap?.settings?.brand_name || 'AcctHub';
  const welcomeCredit = __ACCTHUB_SANDBOX__ ? (bootstrap?.registration?.welcome_credit ?? 0) : 0;
  const isSubAgentSite = Boolean(bootstrap?.tenant?.isSubAgent);
  const affiliateEnabled = bootstrap?.settings?.affiliate_enabled !== '0';
  const isRealSubDomain = Boolean(isSubAgentSite && bootstrap?.tenant?.resolvedVia !== 'local_subdomain');

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="auth-dialog-title"
      className="acct-dialog"
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="auth-dialog-title" className="font-editorial text-2xl font-semibold">
              {mode === 'forgot'
                ? rf.authForgotTitle
                : mode === 'login'
                  ? fmt(m.authLoginTitle, { brand: brandName })
                  : fmt(m.authRegisterTitle, { brand: brandName })}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-secondary)' }}>
              {mode === 'forgot'
                ? rf.authForgotSub
                : mode === 'login'
                  ? m.authLoginSub
                  : __ACCTHUB_SANDBOX__ && welcomeCredit > 0
                    ? fmt(m.authRegisterTrialSub ?? m.authRegisterSub, { amount: welcomeCredit })
                    : m.authRegisterSub}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 rounded-full inline-flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            aria-label={m.authCloseAria}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Demo account shortcuts: completely hidden on real white-label sub-agent domains */}
        {__ACCTHUB_SANDBOX__ && !isRealSubDomain && (
          <div
            className="mt-4 p-3 rounded-xl border text-xs"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            <div
              className="flex items-center gap-1.5 font-medium mb-2"
              style={{ color: 'var(--ink-secondary)' }}
            >
              <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {isSubAgentSite ? m.authPreviewShortcuts : m.authDemoShortcuts}
            </div>
            <div className="flex flex-wrap gap-2">
              {!isSubAgentSite && (
                <button
                  type="button"
                  onClick={() => quickFillDemo('member')}
                  className="px-2.5 py-1 rounded-lg border font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                >
                  {m.authMemberBtn}
                </button>
              )}
              {(!isSubAgentSite || bootstrap?.tenant?.slug === 'studio') && (
                <button
                  type="button"
                  onClick={() => quickFillDemo('agent')}
                  className="px-2.5 py-1 rounded-lg border font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                >
                  {isSubAgentSite ? m.authOwnerBtn : m.authAgentBtn}
                </button>
              )}
              {!isSubAgentSite && (
                <button
                  type="button"
                  onClick={() => quickFillDemo('admin')}
                  className="px-2.5 py-1 rounded-lg border font-medium cursor-pointer"
                  style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                >
                  {m.authAdminBtn}
                </button>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="auth-name" className="block text-xs font-medium mb-1">
                {m.authDisplayNameLabel}
              </label>
              <span
                id="auth-name-hint"
                className="block text-[11px] mb-1"
                style={{ color: 'var(--ink-muted)' }}
              >
                {m.authDisplayNameHint}
              </span>
              <input
                id="auth-name"
                type="text"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                aria-describedby="auth-name-hint"
                data-error="auth-name-err"
                placeholder={m.authDisplayNamePlaceholder}
                className="acct-input"
              />
              <div id="auth-name-err" className="acct-field-error">
                <span role="img" aria-label={m.authDisplayNameErr}>
                  !
                </span>{' '}
                {m.authDisplayNameErr}
              </div>
            </div>
          )}

          {mode === 'register' && affiliateEnabled && (
            <div>
              <label htmlFor="auth-ref-code" className="block text-xs font-medium mb-1">
                {m.authRefCodeLabel}
              </label>
              <input
                id="auth-ref-code"
                type="text"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder={m.authRefCodePlaceholder}
                className="acct-input font-mono-num text-xs"
              />
            </div>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium mb-1">
              {m.authEmailLabel}
            </label>
            <span
              id="auth-email-hint"
              className="block text-[11px] mb-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              {m.authEmailHint}
            </span>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby="auth-email-hint"
              data-error="auth-email-err"
              placeholder="name@example.com"
              className="acct-input"
            />
            <div id="auth-email-err" className="acct-field-error">
              <span role="img" aria-label={m.authEmailErr}>
                !
              </span>{' '}
              {m.authEmailErr}
            </div>
          </div>

          {mode === 'forgot' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  pattern="\d{6}"
                  maxLength={6}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={rf.authCodeLabel}
                  className="acct-input font-mono-num flex-1"
                />
                <button
                  type="button"
                  disabled={sendingCode || !email.trim()}
                  onClick={() => void handleSendResetCode()}
                  className="px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                  style={{
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                    backgroundColor: 'var(--accent-soft)',
                  }}
                >
                  {sendingCode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : rf.authSendCodeBtn}
                </button>
              </div>
              {codeSent && (
                <div className="text-[11px] font-medium" style={{ color: 'var(--success)' }}>
                  {rf.authCodeSentToast}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="auth-password" className="block text-xs font-medium">
                {mode === 'forgot' ? rf.authNewPwdLabel : m.authPassLabel}
              </label>
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setPassword('');
                    setMode('forgot');
                  }}
                  className="text-[11px] font-medium underline cursor-pointer"
                  style={{ color: 'var(--accent)' }}
                >
                  {rf.authForgotLink}
                </button>
              )}
            </div>
            <span
              id="auth-pass-hint"
              className="block text-[11px] mb-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              {m.authPassHint}
            </span>
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="auth-pass-hint"
              data-error="auth-pass-err"
              placeholder="••••••"
              className="acct-input"
            />
            <div id="auth-pass-err" className="acct-field-error">
              <span role="img" aria-label={m.authPassErr}>
                !
              </span>{' '}
              {m.authPassErr}
            </div>
          </div>

          {mode === 'login' && totpRequired && (
            <div
              className="p-3.5 rounded-xl border space-y-2"
              style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
            >
              <div className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                {pc.authTotpPromptTitle}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                {pc.authTotpPromptDesc}
              </p>
              <input
                type="text"
                required
                pattern="\d{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={pc.authTotpPlaceholder}
                className="acct-input font-mono-num text-center tracking-widest"
              />
            </div>
          )}

          {error && (
            <div
              className="p-3 rounded-xl text-xs font-medium"
              style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}

          {open && mode !== 'forgot' && (
            <TurnstileWidget
              enabled={bootstrap?.security?.turnstile_enabled}
              siteKey={bootstrap?.security?.turnstile_site_key}
              action={mode}
              resetSignal={turnstileReset}
              onToken={setTurnstileToken}
            />
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'forgot'
              ? rf.authResetSubmitBtn
              : mode === 'login'
                ? m.authLoginBtn
                : m.authRegisterBtn}
          </button>
        </form>

        {mode !== 'forgot' && (
          <SocialLoginButtons
            providers={bootstrap?.oauth_providers}
            referralCode={affiliateEnabled ? referralCode : undefined}
            onError={setError}
          />
        )}

        <div
          className="mt-4 pt-4 border-t text-center text-xs"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
        >
          {mode === 'forgot' ? (
            <button
              type="button"
              onClick={() => setMode('login')}
              className="font-semibold underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--accent)' }}
            >
              {rf.authBackToLogin}
            </button>
          ) : mode === 'login' ? (
            <>
              {m.authNoAccount}{' '}
              <button
                type="button"
                onClick={() => setMode('register')}
                className="font-semibold underline underline-offset-2 cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                {m.authGoRegister}
              </button>
            </>
          ) : (
            <>
              {m.authHasAccount}{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="font-semibold underline underline-offset-2 cursor-pointer"
                style={{ color: 'var(--accent)' }}
              >
                {m.authGoLogin}
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
