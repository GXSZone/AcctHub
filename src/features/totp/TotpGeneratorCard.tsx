/**
 * 2FA 左侧主动态验证码生成器与本地二维码卡片
 */

import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Clock,
  Copy,
  Info,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { fmt } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useTotpI18n } from '../../i18n/namespaces/totp';
import { TotpQrCard } from './TotpQrCard';
import { formatOtpDisplay } from './totp-vault.storage';

interface TotpGeneratorCardProps {
  secretInputRef: React.RefObject<HTMLInputElement | null>;
  secretInput: string;
  cleanedSecret: string;
  issuer: string;
  accountName: string;
  digits: 6 | 8;
  period: 30 | 60;
  code: string;
  nextCode: string;
  remaining: number;
  progress: number;
  error: string;
  qrDataUrl: string;
  otpAuthUri: string;
  savingVault: boolean;
  onSecretChange: (val: string) => void;
  onMultiLinePaste: (lines: string[]) => void;
  onPasteClipboard: () => void;
  onGenerateRandom: () => void;
  onDigitsChange: (d: 6 | 8) => void;
  onPeriodChange: (p: 30 | 60) => void;
  onIssuerChange: (v: string) => void;
  onAccountNameChange: (v: string) => void;
  onClearSecret: () => void;
  onSaveCurrent: () => void;
  onOpenQrZoom: () => void;
  onDownloadQr: () => void;
}

export function TotpGeneratorCard({
  secretInputRef,
  secretInput,
  cleanedSecret,
  issuer,
  accountName,
  digits,
  period,
  code,
  nextCode,
  remaining,
  progress,
  error,
  qrDataUrl,
  otpAuthUri,
  savingVault,
  onSecretChange,
  onMultiLinePaste,
  onPasteClipboard,
  onGenerateRandom,
  onDigitsChange,
  onPeriodChange,
  onIssuerChange,
  onAccountNameChange,
  onClearSecret,
  onSaveCurrent,
  onOpenQrZoom,
  onDownloadQr,
}: TotpGeneratorCardProps) {
  const sf = useStorefrontI18n();
  const tp = useTotpI18n();
  const [showParams, setShowParams] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);
  const hasValidCode = cleanedSecret.length >= 8 && code !== '------' && !error;
  const placeholderGroupSize = digits === 8 ? 4 : 3;

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  return (
    <section className="lg:col-span-5 paper-card rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-editorial text-lg font-semibold">{sf.totpGenTitle}</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onGenerateRandom}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-opacity hover:opacity-85"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Sparkles className="w-3 h-3" />
            {sf.totpRandomSecret}
          </button>
          <button
            type="button"
            onClick={() => setShowParams((v) => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
          >
            {sf.totpParams}
            <ChevronDown className={`w-3 h-3 transition-transform ${showParams ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {showParams && (
        <div
          className="p-3 rounded-xl border grid grid-cols-2 gap-3 text-xs"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
        >
          <div>
            <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              {sf.totpDigitsLabel}
            </div>
            <select
              value={digits}
              onChange={(e) => onDigitsChange(Number(e.target.value) === 8 ? 8 : 6)}
              className="acct-input h-8 py-0 text-xs"
            >
              <option value={6}>6</option>
              <option value={8}>8</option>
            </select>
          </div>
          <div>
            <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              {sf.totpPeriodLabel}
            </div>
            <select
              value={period}
              onChange={(e) => onPeriodChange(Number(e.target.value) === 60 ? 60 : 30)}
              className="acct-input h-8 py-0 text-xs"
            >
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
        </div>
      )}

      {/* 密钥输入框 */}
      <div>
        <div className="relative">
          <input
            ref={secretInputRef}
            type="text"
            value={secretInput}
            onChange={(e) => onSecretChange(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              const lines = pasted
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
              if (lines.length > 1) {
                e.preventDefault();
                onMultiLinePaste(lines);
              }
            }}
            placeholder={sf.totpSecretPlaceholder}
            className="acct-input h-12 rounded-xl text-sm font-mono-num tracking-wide pr-16"
            style={{ borderColor: hasValidCode ? 'var(--border-strong)' : undefined }}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {secretInput ? (
              <>
                <button
                  type="button"
                  onClick={onClearSecret}
                  className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-black/5"
                  style={{ color: 'var(--ink-muted)' }}
                  title={tp.clearTooltip}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(cleanedSecret || secretInput);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 1400);
                  }}
                  className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-black/5"
                  style={{ color: copiedSecret ? 'var(--success)' : 'var(--ink-secondary)' }}
                  title={tp.copySecretTooltip}
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onPasteClipboard}
                className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-black/5"
                style={{ color: 'var(--ink-secondary)' }}
                title={tp.pasteClipboardTooltip}
              >
                <ClipboardPaste className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {hasValidCode ? (
          <div
            className="mt-2 text-[11.5px] inline-flex items-center gap-1"
            style={{ color: 'var(--success)' }}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {fmt(tp.validSecretHint, { len: cleanedSecret.length })}
          </div>
        ) : error ? (
          <div
            className="mt-2 text-[11.5px] inline-flex items-center gap-1"
            style={{ color: 'var(--danger)' }}
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        ) : (
          <div
            className="mt-2 text-[11.5px] inline-flex items-center gap-1"
            style={{ color: 'var(--ink-muted)' }}
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            {sf.totpSecretHint}
          </div>
        )}
      </div>

      {/* 实时动态验证码展示 */}
      {hasValidCode ? (
        <div
          className="rounded-2xl px-5 py-6 border text-center space-y-3"
          style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
            {issuer || accountName
              ? `${issuer}${issuer && accountName ? ' · ' : ''}${accountName}`
              : sf.totpCodeLabel}
          </div>
          <button
            type="button"
            onClick={() => void copyCode()}
            title={sf.totpCopyCode}
            className="font-mono-num text-4xl sm:text-[42px] font-bold tracking-[0.16em] cursor-pointer hover:opacity-80 transition-opacity"
          >
            {formatOtpDisplay(code)}
          </button>

          <div className="flex items-center justify-center gap-4 pt-1">
            <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
                <circle
                  cx="20"
                  cy="20"
                  r={radius}
                  fill="none"
                  stroke="var(--border-color)"
                  strokeWidth="3.5"
                />
                <circle
                  cx="20"
                  cy="20"
                  r={radius}
                  fill="none"
                  stroke={remaining <= 5 ? 'var(--danger)' : 'var(--accent)'}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <span className="absolute font-mono-num text-[11px] font-semibold">{remaining}</span>
            </div>
            <div className="text-left">
              <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                {sf.totpNextCode}
              </div>
              <div className="font-mono-num text-sm font-semibold" style={{ color: 'var(--ink-secondary)' }}>
                {formatOtpDisplay(nextCode)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="rounded-2xl px-5 py-7 border text-center space-y-5"
          style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-color)' }}
        >
          <div className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>
            {sf.totpCodeLabel}
          </div>
          <div className="flex items-center justify-center gap-5 py-2" aria-hidden="true">
            <div className="flex items-center gap-2">
              {Array.from({ length: placeholderGroupSize }).map((_, idx) => (
                <span
                  key={`l-${idx}`}
                  className="inline-block w-5 sm:w-6 h-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--border-strong)' }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {Array.from({ length: placeholderGroupSize }).map((_, idx) => (
                <span
                  key={`r-${idx}`}
                  className="inline-block w-5 sm:w-6 h-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--border-strong)' }}
                />
              ))}
            </div>
          </div>
          <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            {sf.totpWaitingCode}
          </div>
        </div>
      )}

      {/* 复制与保存操作栏 */}
      <div className="space-y-2.5">
        <div className="grid grid-cols-12 gap-2.5">
          <button
            type="button"
            disabled={!hasValidCode}
            onClick={() => void copyCode()}
            className="col-span-8 py-2.5 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedCode ? sf.totpCopiedCode : sf.totpCopyCode}
          </button>
          <button
            type="button"
            disabled={!hasValidCode || savingVault}
            onClick={onSaveCurrent}
            className="col-span-4 py-2.5 rounded-full text-xs font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {savingVault ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <KeyRound className="w-3.5 h-3.5" />
            )}
            {sf.totpSaveBtn}
          </button>
        </div>
        <div
          className="flex items-center justify-center gap-1 text-[11px]"
          style={{ color: 'var(--ink-muted)' }}
        >
          <Clock className="w-3 h-3 shrink-0" />
          <span>{sf.totpDeviceClock}</span>
        </div>
      </div>

      {hasValidCode && qrDataUrl && (
        <TotpQrCard
          qrDataUrl={qrDataUrl}
          otpAuthUri={otpAuthUri}
          issuer={issuer}
          accountName={accountName}
          onIssuerChange={onIssuerChange}
          onAccountNameChange={onAccountNameChange}
          onOpenQrZoom={onOpenQrZoom}
          onDownloadQr={onDownloadQr}
        />
      )}
    </section>
  );
}
