import { BookmarkPlus, Check, ChevronDown, ChevronUp, Copy, KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accountApi } from '../api/account.api';
import { loadLocalTotpVault, saveLocalTotpVault } from '../features/totp/totp-vault.storage';
import { useAccountI18n } from '../i18n/namespaces/account';
import { parseDeliveredCredentials } from '../i18n/namespaces/account/credential-parser';
import { cleanSecret } from '../lib/totp';
import { prepareTotpHandoff } from '../lib/totp-handoff';
import type { UserProfile } from '../types';

export function CredentialCard({
  payload,
  productTitle,
  locked,
  user,
}: {
  payload: string;
  productTitle?: string;
  locked?: boolean;
  user?: UserProfile | null;
}) {
  const acc = useAccountI18n();
  const navigate = useNavigate();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [saved2fa, setSaved2fa] = useState<Record<string, boolean>>({});
  const [showRaw, setShowRaw] = useState(false);

  const entries = useMemo(
    () => (locked ? [] : parseDeliveredCredentials(payload, acc)),
    [payload, locked, acc]
  );
  const hasStructured = entries.some((e) => e.fields.length > 0);

  const copy = async (id: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const save2faToVault = async (keyId: string, secret: string, accountGuess: string) => {
    const cleaned = cleanSecret(secret);
    if (cleaned.length < 8) return;
    const issuer = (productTitle || acc.credDefaultIssuer).slice(0, 24);
    try {
      if (user) {
        await accountApi.totpVaultAdd({ issuer, account_name: accountGuess, secret: cleaned });
      } else {
        saveLocalTotpVault([
          {
            id: crypto.randomUUID(),
            issuer,
            account_name: accountGuess,
            secret: cleaned,
            digits: 6,
            period: 30,
          },
          ...loadLocalTotpVault().filter((i) => i.secret !== cleaned),
        ]);
      }
      setSaved2fa((p) => ({ ...p, [keyId]: true }));
    } catch (err) {
      console.warn('Failed to persist 2FA entry:', err);
    }
  };

  if (locked || !hasStructured) {
    return (
      <pre
        className="p-3.5 rounded-xl text-xs font-mono-num whitespace-pre-wrap break-all border"
        style={{
          backgroundColor: 'var(--bg-canvas)',
          borderColor: 'var(--border-color)',
          color: 'var(--ink-primary)',
        }}
      >
        {payload}
      </pre>
    );
  }

  return (
    <div className="space-y-2.5">
      {entries.map((entry, eIdx) => {
        const accountGuess =
          entry.fields.find((f) => f.value.includes('@'))?.value || productTitle || acc.credDefaultAccount;
        return (
          <div
            key={eIdx}
            className="rounded-xl border divide-y overflow-hidden"
            style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
          >
            {entry.fields.map((f, fIdx) => {
              const cid = `${eIdx}-${fIdx}`;
              const secretVal = f.is2fa ? cleanSecret(f.value) : '';
              return (
                <div
                  key={cid}
                  className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-medium mr-2" style={{ color: 'var(--ink-muted)' }}>
                      {f.label}
                    </span>
                    <span
                      className="font-mono-num font-semibold break-all"
                      style={{ color: 'var(--ink-primary)' }}
                    >
                      {f.value}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.is2fa && secretVal && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              prepareTotpHandoff({
                                secret: secretVal,
                                issuer: (productTitle || 'AI').slice(0, 20),
                                account: accountGuess,
                              })
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                          style={{
                            borderColor: 'var(--accent)',
                            backgroundColor: 'var(--accent-soft)',
                            color: 'var(--accent)',
                          }}
                        >
                          <KeyRound className="w-3 h-3" />
                          {acc.credGetCodeBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => void save2faToVault(cid, secretVal, accountGuess)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium cursor-pointer"
                          style={{
                            borderColor: saved2fa[cid] ? 'var(--success)' : 'var(--border-strong)',
                            backgroundColor: saved2fa[cid] ? 'var(--success-soft)' : 'var(--bg-surface)',
                            color: saved2fa[cid] ? 'var(--success)' : 'var(--ink-secondary)',
                          }}
                        >
                          {saved2fa[cid] ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <BookmarkPlus className="w-3 h-3" />
                          )}
                          {saved2fa[cid] ? acc.credSaved2faBtn : acc.credSave2faBtn}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void copy(cid, f.value)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-primary)' }}
                    >
                      {copiedId === cid ? (
                        <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      {copiedId === cid ? acc.credCopiedBtn : acc.credCopyBtn}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] cursor-pointer"
          style={{ color: 'var(--ink-muted)' }}
        >
          {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showRaw ? acc.credHideRawBtn : acc.credShowRawBtn}
        </button>
      </div>
      {showRaw && (
        <pre
          className="p-3 rounded-xl text-[11px] font-mono-num whitespace-pre-wrap break-all border"
          style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-color)' }}
        >
          {payload}
        </pre>
      )}
    </div>
  );
}
