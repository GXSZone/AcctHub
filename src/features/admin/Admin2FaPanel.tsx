import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { extensionsApi } from '../../api/extensions.api';
import { useExtensionsI18n } from '../../i18n/namespaces/extensions';
import { extensionsQueryKeys, useAdmin2FaStatusQuery } from '../../queries/extensions.queries';

export function Admin2FaPanel({ showToast }: { showToast: (msg: string) => void }) {
  const pc = useExtensionsI18n();
  const qc = useQueryClient();
  const statusQuery = useAdmin2FaStatusQuery();
  const [setupData, setSetupData] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const enabled = Boolean(statusQuery.data?.enabled);

  const handleStartSetup = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await extensionsApi.setupAdmin2Fa();
      setSetupData({ secret: res.secret, otpauth_url: res.otpauth_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    setBusy(true);
    setError('');
    try {
      await extensionsApi.enableAdmin2Fa(setupData.secret, code.trim());
      setSetupData(null);
      setCode('');
      await qc.invalidateQueries({ queryKey: extensionsQueryKeys.admin2Fa() });
      showToast(pc.admin2FaEnabledToast);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enable failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await extensionsApi.disableAdmin2Fa(code.trim());
      setCode('');
      await qc.invalidateQueries({ queryKey: extensionsQueryKeys.admin2Fa() });
      showToast(pc.admin2FaDisabledToast);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disable failed');
    } finally {
      setBusy(false);
    }
  };

  if (statusQuery.isLoading) {
    return (
      <div className="paper-card rounded-2xl p-8 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="paper-card rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="font-editorial text-xl font-semibold flex items-center gap-2">
          <KeyRound className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          {pc.admin2FaTitle}
        </h2>
        <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
          {pc.admin2FaDesc}
        </p>
      </div>

      <div
        className="rounded-xl border p-4 flex items-center gap-3 text-xs font-semibold"
        style={{
          borderColor: enabled ? 'var(--success)' : 'var(--warning)',
          backgroundColor: enabled ? 'var(--success-soft)' : 'var(--warning-soft)',
          color: enabled ? 'var(--success)' : 'var(--warning)',
        }}
      >
        {enabled ? <ShieldCheck className="w-4 h-4 shrink-0" /> : <ShieldOff className="w-4 h-4 shrink-0" />}
        <span>{enabled ? pc.admin2FaStatusOn : pc.admin2FaStatusOff}</span>
      </div>

      {error && (
        <div
          className="p-3 rounded-xl text-xs font-medium"
          style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {!enabled ? (
        !setupData ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleStartSetup()}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer inline-flex items-center gap-2"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {pc.admin2FaStartSetupBtn}
          </button>
        ) : (
          <form onSubmit={handleEnable} className="space-y-4 max-w-lg">
            <div>
              <div className="text-xs font-semibold mb-1">{pc.admin2FaSecretLabel}</div>
              <input
                type="text"
                readOnly
                value={setupData.secret}
                className="acct-input font-mono-num text-xs"
              />
            </div>
            <div>
              <div className="text-xs font-semibold mb-1">{pc.admin2FaOtpUriLabel}</div>
              <input
                type="text"
                readOnly
                value={setupData.otpauth_url}
                className="acct-input font-mono-num text-[11px]"
              />
            </div>
            <div>
              <div className="text-xs font-semibold mb-1">{pc.admin2FaCodeLabel}</div>
              <input
                type="text"
                required
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="acct-input font-mono-num text-sm tracking-widest"
              />
            </div>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="px-5 py-2.5 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {pc.admin2FaEnableBtn}
            </button>
          </form>
        )
      ) : (
        <form onSubmit={handleDisable} className="space-y-3 max-w-sm">
          <div>
            <div className="text-xs font-semibold mb-1">{pc.admin2FaCodeLabel}</div>
            <input
              type="text"
              required
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="acct-input font-mono-num text-sm tracking-widest"
            />
          </div>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer disabled:opacity-50"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
          >
            {pc.admin2FaDisableBtn}
          </button>
        </form>
      )}
    </div>
  );
}
