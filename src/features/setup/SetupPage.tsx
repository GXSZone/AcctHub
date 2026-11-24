import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { setAuthToken } from '../../api/http';
import { setupApi } from '../../api/setup.api';
import { useCommonModalsI18n } from '../../i18n/namespaces/common-modals';
import { toast } from '../../lib/toast';

interface SetupPageProps {
  onInitialized: () => Promise<void> | void;
}

/**
 * 生产/空白环境冷启动初始化向导（仅在无管理员且未锁定时允许执行一次）
 */
export function SetupPage({ onInitialized }: SetupPageProps) {
  const m = useCommonModalsI18n();
  const navigate = useNavigate();
  const statusQuery = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => setupApi.status(),
  });

  const [setupSecret, setSetupSecret] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [displayName, setDisplayName] = useState(() => m.stpDefaultName);
  const [brandName, setBrandName] = useState('AcctHub');
  const [brandTagline, setBrandTagline] = useState(() => m.stpDefaultTagline);
  const [submitting, setSubmitting] = useState(false);

  if (statusQuery.isLoading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-24 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (statusQuery.data?.initialized) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20">
        <div className="paper-card rounded-2xl p-8 text-center space-y-4">
          <div
            className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
            style={{ backgroundColor: 'var(--success-soft)', color: 'var(--success)' }}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h1 className="font-editorial text-2xl font-semibold">{m.stpDoneTitle}</h1>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {m.stpDoneDesc}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Link
              to="/admin"
              className="px-5 py-2.5 rounded-xl text-xs font-semibold no-underline"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {m.stpGoAdmin}
            </Link>
            <Link
              to="/"
              className="px-5 py-2.5 rounded-xl border text-xs font-medium no-underline"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
            >
              {m.stpGoHome}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    toast.clearErrors();
    setSubmitting(true);
    try {
      const res = await setupApi.initialize({
        setup_secret: setupSecret,
        admin_email: adminEmail,
        admin_password: adminPassword,
        admin_display_name: displayName,
        brand_name: brandName,
        brand_tagline: brandTagline,
      });
      setAuthToken(res.token);
      await onInitialized();
      navigate('/admin', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : m.stpInitErr);
    } finally {
      setSubmitting(false);
    }
  };

  const isProduction = Boolean(statusQuery.data?.is_production);
  const hasAdminSecret = Boolean(statusQuery.data?.has_admin_secret);
  const secretReady = !isProduction || hasAdminSecret;
  const setupSteps = [
    { label: m.stpStep1, done: true, active: false },
    { label: m.stpStep2, done: secretReady, active: !secretReady },
    { label: m.stpStep3, done: false, active: secretReady },
    { label: m.stpStep4, done: false, active: false },
  ];

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="paper-card rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="flex items-start gap-3 pb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-editorial text-2xl font-semibold">{m.stpTitle}</h1>
            </div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {m.stpDesc}
            </p>
            <div className="flex flex-wrap gap-2 mt-2.5">
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                style={{
                  backgroundColor: 'var(--bg-subtle)',
                  color: 'var(--ink-secondary)',
                }}
              >
                {isProduction ? m.stpEnvProdBadge : m.stpEnvDevBadge}
              </span>
              <span
                className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                style={{
                  backgroundColor: secretReady ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: secretReady ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {secretReady ? m.stpSecretReadyBadge : m.stpSecretMissingBadge}
              </span>
            </div>
          </div>
        </div>

        {/* 4 步冷启动安装引导进度条 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {setupSteps.map((step) => (
            <div
              key={step.label}
              className="px-2.5 py-2 rounded-xl border text-[11px] font-medium flex items-center gap-1.5"
              style={{
                borderColor: step.active
                  ? 'var(--accent)'
                  : step.done
                    ? 'var(--success)'
                    : 'var(--border-color)',
                backgroundColor: step.active
                  ? 'var(--accent-soft)'
                  : step.done
                    ? 'var(--success-soft)'
                    : 'var(--bg-canvas)',
                color: step.active ? 'var(--accent)' : step.done ? 'var(--success)' : 'var(--ink-muted)',
              }}
            >
              {step.done && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">{step.label}</span>
            </div>
          ))}
        </div>

        {!secretReady && (
          <div
            className="p-4 rounded-xl border space-y-2 text-xs"
            style={{
              borderColor: 'var(--danger)',
              backgroundColor: 'var(--danger-soft)',
              color: 'var(--danger)',
            }}
          >
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{m.stpSecretMissingTitle}</span>
            </div>
            <p className="leading-relaxed opacity-90">{m.stpSecretMissingDesc}</p>
            <pre
              className="p-2.5 rounded-lg text-[11px] font-mono-num overflow-x-auto"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
            >
              {`pnpm exec wrangler secret put ADMIN_SECRET --env production\npnpm exec wrangler secret put JWT_SECRET --env production`}
            </pre>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="setup-secret" className="block text-xs font-semibold mb-1">
              {m.stpSecretLabel} <span style={{ color: 'var(--accent)' }}>*</span>
            </label>
            <div className="relative">
              <KeyRound
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--ink-muted)' }}
              />
              <input
                id="setup-secret"
                type="password"
                required
                value={setupSecret}
                onChange={(e) => setSetupSecret(e.target.value)}
                placeholder={m.stpSecretPlaceholder}
                className="acct-input pl-10 font-mono-num"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="setup-email" className="block text-xs font-semibold mb-1">
                {m.stpEmailLabel} <span style={{ color: 'var(--accent)' }}>*</span>
              </label>
              <input
                id="setup-email"
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@yourdomain.com"
                className="acct-input"
              />
            </div>
            <div>
              <label htmlFor="setup-name" className="block text-xs font-semibold mb-1">
                {m.stpNameLabel}
              </label>
              <input
                id="setup-name"
                type="text"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="acct-input"
              />
            </div>
          </div>

          <div>
            <label htmlFor="setup-password" className="block text-xs font-semibold mb-1">
              {m.stpPassLabel} <span style={{ color: 'var(--accent)' }}>*</span>
            </label>
            <div className="relative">
              <Lock
                className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--ink-muted)' }}
              />
              <input
                id="setup-password"
                type="password"
                required
                minLength={8}
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder={m.stpPassPlaceholder}
                className="acct-input pl-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="setup-brand" className="block text-xs font-semibold mb-1">
                {m.stpBrandLabel}
              </label>
              <input
                id="setup-brand"
                type="text"
                required
                minLength={2}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="acct-input"
              />
            </div>
            <div>
              <label htmlFor="setup-tagline" className="block text-xs font-semibold mb-1">
                {m.stpTaglineLabel}
              </label>
              <input
                id="setup-tagline"
                type="text"
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                className="acct-input"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {m.stpSubmitBtn}
          </button>
        </form>
      </div>
    </div>
  );
}
