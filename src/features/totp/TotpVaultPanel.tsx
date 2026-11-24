/**
 * 2FA 右侧云端/本机加密密钥箱面板
 */

import { Check, Cloud, Copy, HardDrive, KeyRound, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useTotpI18n } from '../../i18n/namespaces/totp';
import type { TotpVaultItem, UserProfile } from '../../types';
import { formatOtpDisplay } from './totp-vault.storage';

interface TotpVaultPanelProps {
  user?: UserProfile | null;
  vaultItems: TotpVaultItem[];
  vaultLoading: boolean;
  vaultCodes: Record<string, { code: string; remaining: number }>;
  hasValidCode: boolean;
  savingVault: boolean;
  onSelectVaultItem: (item: TotpVaultItem) => void;
  onSaveCurrent: () => void;
  onFocusSecretPrompt: () => void;
  onOpenBatchImport: () => void;
  onDeleteItem: (id: string) => void;
}

export function TotpVaultPanel({
  user,
  vaultItems,
  vaultLoading,
  vaultCodes,
  hasValidCode,
  savingVault,
  onSelectVaultItem,
  onSaveCurrent,
  onFocusSecretPrompt,
  onOpenBatchImport,
  onDeleteItem,
}: TotpVaultPanelProps) {
  const sf = useStorefrontI18n();
  const tp = useTotpI18n();
  const [copiedVaultId, setCopiedVaultId] = useState<string | null>(null);

  return (
    <section className="lg:col-span-7 paper-card rounded-2xl p-6 space-y-4 min-h-[412px] flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-editorial text-lg font-semibold">
            {sf.totpVaultTitle}
            {vaultItems.length > 0 ? ` (${vaultItems.length})` : ''}
          </h2>
          <p
            className="text-[11.5px] mt-0.5 inline-flex items-center gap-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            {user ? <Cloud className="w-3 h-3 shrink-0" /> : <HardDrive className="w-3 h-3 shrink-0" />}
            <span>{user ? `${sf.totpCloudSync} · ${user.email}` : sf.totpGuestLocal}</span>
          </p>
        </div>
        {vaultItems.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasValidCode || savingVault}
              onClick={onSaveCurrent}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {sf.totpAddKey}
            </button>
            <button
              type="button"
              onClick={onOpenBatchImport}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              {sf.totpBatchImport}
            </button>
          </div>
        )}
      </div>

      {vaultLoading ? (
        <div className="flex-1 flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
        </div>
      ) : vaultItems.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center space-y-3.5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center border"
            style={{
              backgroundColor: 'var(--accent-soft)',
              borderColor: 'var(--border-color)',
              color: 'var(--accent)',
            }}
          >
            <KeyRound className="w-7 h-7" />
          </div>
          <div className="font-editorial text-lg font-semibold">{sf.totpVaultEmptyTitle}</div>
          <p className="text-xs max-w-xs mx-auto leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {sf.totpVaultEmptyDesc}
          </p>
          <div className="flex items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                if (hasValidCode) onSaveCurrent();
                else onFocusSecretPrompt();
              }}
              className="px-4 py-2 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Plus className="w-3.5 h-3.5" />
              {sf.totpAddKey}
            </button>
            <button
              type="button"
              onClick={onOpenBatchImport}
              className="px-4 py-2 rounded-full text-xs font-medium cursor-pointer inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
            >
              <Upload className="w-3.5 h-3.5" />
              {sf.totpBatchImport}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[560px] overflow-y-auto pr-1">
          {vaultItems.map((item) => {
            const live = vaultCodes[item.id] || { code: '------', remaining: 30 };
            return (
              <div
                key={item.id}
                className="p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-colors"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
              >
                <button
                  type="button"
                  onClick={() => onSelectVaultItem(item)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold truncate">
                      {item.issuer || tp.fallbackItemIssuer}
                    </span>
                    {item.account_name && (
                      <span className="text-[11px] truncate" style={{ color: 'var(--ink-muted)' }}>
                        · {item.account_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 mt-1">
                    <span
                      className="font-mono-num text-xl font-bold tracking-[0.14em]"
                      style={{ color: 'var(--accent)' }}
                    >
                      {formatOtpDisplay(live.code)}
                    </span>
                    <span
                      className="font-mono-num text-[11px] px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: live.remaining <= 5 ? 'var(--danger-soft)' : 'var(--bg-subtle)',
                        color: live.remaining <= 5 ? 'var(--danger)' : 'var(--ink-muted)',
                      }}
                    >
                      {live.remaining}s
                    </span>
                  </div>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(live.code);
                      setCopiedVaultId(item.id);
                      setTimeout(() => setCopiedVaultId(null), 1500);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer inline-flex items-center gap-1"
                    style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    {copiedVaultId === item.id ? (
                      <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedVaultId === item.id ? sf.totpCopiedShort : sf.totpCopyShort}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item.id)}
                    className="p-1.5 rounded-lg cursor-pointer"
                    style={{ color: 'var(--ink-muted)' }}
                    title={tp.deleteTooltip}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
