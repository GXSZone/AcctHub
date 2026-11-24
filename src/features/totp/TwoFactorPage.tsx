/**
 * 离线 2FA 动态验证码生成器与加密密钥箱主页面（基于 TanStack Query v5）
 */

import { Cloud, HardDrive } from 'lucide-react';
import QRCode from 'qrcode';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { accountApi } from '../../api/account.api';
import { fmt } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { useTotpI18n } from '../../i18n/namespaces/totp';
import { toast } from '../../lib/toast';
import {
  buildOtpAuthUri,
  cleanSecret,
  generateRandomBase32Secret,
  generateTOTP,
  parseOtpAuthUri,
} from '../../lib/totp';
import { takeTotpHandoff } from '../../lib/totp-handoff';
import { useTotpVaultQuery } from '../../queries/account.queries';
import type { TotpVaultItem, UserProfile } from '../../types';
import { TotpGeneratorCard } from './TotpGeneratorCard';
import { TotpModals } from './TotpModals';
import { TotpVaultPanel } from './TotpVaultPanel';
import {
  loadLocalTotpVault,
  parseBatchTotpLines,
  saveLocalTotpVault,
  TOTP_VAULT_LIMIT,
} from './totp-vault.storage';

export function TwoFactorPage({ user }: { user?: UserProfile | null }) {
  const sf = useStorefrontI18n();
  const tp = useTotpI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [secretInput, setSecretInput] = useState('');
  const [issuer, setIssuer] = useState('');
  const [accountName, setAccountName] = useState('');
  const [digits, setDigits] = useState<6 | 8>(6);
  const [period, setPeriod] = useState<30 | 60>(30);

  const [code, setCode] = useState('------');
  const [nextCode, setNextCode] = useState('------');
  const [remaining, setRemaining] = useState(30);
  const [progress, setProgress] = useState(1);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrZoomOpen, setQrZoomOpen] = useState(false);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const prevUserIdRef = useRef<number | null>(user?.id ?? null);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId) {
      setSecretInput('');
      setIssuer('');
      setAccountName('');
      setError('');
      setQrDataUrl('');
      setQrZoomOpen(false);
      setBatchText('');
      setBatchOpen(false);
    }
    prevUserIdRef.current = currentUserId;
  }, [user?.id]);

  const [localItems, setLocalItems] = useState<TotpVaultItem[]>(() => loadLocalTotpVault());
  const cloudVaultQuery = useTotpVaultQuery(Boolean(user));
  const vaultItems = useMemo(
    () => (user ? (cloudVaultQuery.data?.items ?? []) : localItems),
    [user, cloudVaultQuery.data, localItems]
  );
  const vaultLoading = Boolean(user && cloudVaultQuery.isLoading);

  const [vaultCodes, setVaultCodes] = useState<Record<string, { code: string; remaining: number }>>({});
  const [savingVault, setSavingVault] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchError, setBatchError] = useState('');

  const showToast = (msg: string) => {
    toast.auto(msg);
  };

  useEffect(() => {
    const handoff = takeTotpHandoff();
    if (handoff) {
      setSecretInput(handoff.secret);
      setIssuer(handoff.issuer || '');
      setAccountName(handoff.account || '');
    }
    if (['secret', 'issuer', 'account'].some((key) => searchParams.has(key))) {
      const next = new URLSearchParams(searchParams);
      for (const key of ['secret', 'issuer', 'account']) next.delete(key);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSecretChange = (val: string) => {
    const nonEmptyLines = val
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (nonEmptyLines.length > 1) {
      setBatchText(nonEmptyLines.join('\n'));
      setBatchOpen(true);
      showToast(fmt(tp.detectedLinesToast, { count: nonEmptyLines.length }));
      return;
    }
    const single = val.trim();
    if (single.toLowerCase().startsWith('otpauth://')) {
      const parsed = parseOtpAuthUri(single);
      if (parsed.secret) setSecretInput(parsed.secret);
      if (parsed.issuer) setIssuer(parsed.issuer);
      if (parsed.account) setAccountName(parsed.account);
      setDigits(parsed.digits === 8 ? 8 : 6);
      setPeriod(parsed.period === 60 ? 60 : 30);
    } else {
      setSecretInput(val);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        showToast(tp.clipboardEmptyToast);
        return;
      }
      handleSecretChange(text);
    } catch {
      secretInputRef.current?.focus();
      showToast(tp.pasteHotkeyToast);
    }
  };

  const cleanedSecret = useMemo(() => cleanSecret(secretInput), [secretInput]);
  const otpAuthUri = useMemo(() => {
    if (cleanedSecret.length < 8) return '';
    return buildOtpAuthUri({ secret: cleanedSecret, issuer, account: accountName, digits, period });
  }, [cleanedSecret, issuer, accountName, digits, period]);

  useEffect(() => {
    if (!otpAuthUri) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(otpAuthUri, {
      width: 280,
      margin: 2,
      color: { dark: '#141413', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [otpAuthUri]);

  // 实时 500ms 刷新当前验证码及全部保存的密钥箱
  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (cleanedSecret.length >= 8) {
        try {
          const res = await generateTOTP(cleanedSecret, period, digits);
          if (active) {
            setCode(res.code);
            setNextCode(res.nextCode);
            setRemaining(res.remaining);
            setProgress(res.progress);
            setError('');
          }
        } catch (err) {
          if (active) {
            setCode('------');
            setNextCode('------');
            const rawMsg = err instanceof Error ? err.message : '';
            setError(
              rawMsg === 'INVALID_BASE32_SECRET' ? tp.minLengthSecretErr : rawMsg || tp.invalidSecretErr
            );
          }
        }
      } else {
        setCode('------');
        setNextCode('------');
        setError(secretInput.trim() ? tp.minLengthSecretErr : '');
      }

      if (vaultItems.length > 0) {
        const nextMap: Record<string, { code: string; remaining: number }> = {};
        await Promise.all(
          vaultItems.map(async (item) => {
            try {
              const r = await generateTOTP(item.secret, item.period || 30, item.digits || 6);
              nextMap[item.id] = { code: r.code, remaining: r.remaining };
            } catch {
              nextMap[item.id] = { code: '------', remaining: 30 };
            }
          })
        );
        if (active) setVaultCodes(nextMap);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [cleanedSecret, secretInput, period, digits, vaultItems, tp.invalidSecretErr, tp.minLengthSecretErr]);

  const handleSaveCurrent = async () => {
    if (cleanedSecret.length < 8) return;
    toast.clearErrors();
    setSavingVault(true);
    try {
      const labelIssuer = issuer.trim() || tp.defaultAccountIssuer;
      const labelAccount = accountName.trim() || `${cleanedSecret.slice(0, 6)}...`;
      if (user) {
        await accountApi.totpVaultAdd({
          issuer: labelIssuer,
          account_name: labelAccount,
          secret: cleanedSecret,
          digits,
          period,
        });
        await cloudVaultQuery.refetch();
        showToast(tp.savedCloudToast);
      } else {
        const next: TotpVaultItem[] = [
          {
            id: crypto.randomUUID(),
            issuer: labelIssuer,
            account_name: labelAccount,
            secret: cleanedSecret,
            digits,
            period,
          },
          ...localItems.filter((x) => x.secret !== cleanedSecret),
        ];
        saveLocalTotpVault(next);
        setLocalItems(next);
        showToast(tp.savedLocalToast);
      }
    } catch (err) {
      toast.error(
        err instanceof RangeError ? fmt(tp.localVaultFullErr, { limit: TOTP_VAULT_LIMIT }) : tp.saveFailedErr
      );
    } finally {
      setSavingVault(false);
    }
  };

  const handleDeleteVault = async (id: string) => {
    try {
      if (user) {
        await accountApi.totpVaultDelete(id);
        await cloudVaultQuery.refetch();
      } else {
        const next = localItems.filter((x) => x.id !== id);
        saveLocalTotpVault(next);
        setLocalItems(next);
      }
    } catch {
      toast.error(tp.saveFailedErr);
    }
  };

  const handleBatchImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError('');
    const parsedItems = parseBatchTotpLines(batchText, tp.importFallbackSingle, tp.importFallbackBatch);
    if (parsedItems.length === 0) {
      setBatchError(tp.batchEmptyErr);
      return;
    }
    if (user && parsedItems.length > TOTP_VAULT_LIMIT) {
      setBatchError(fmt(tp.batchLimitErr, { limit: TOTP_VAULT_LIMIT }));
      return;
    }
    setBatchImporting(true);
    try {
      if (user) {
        const res = await accountApi.totpVaultBatch(parsedItems);
        await cloudVaultQuery.refetch();
        showToast(fmt(tp.batchCloudSuccessToast, { count: res.imported }));
      } else {
        const existingSet = new Set(localItems.map((v) => v.secret));
        const additions: TotpVaultItem[] = [];
        for (const item of parsedItems) {
          if (existingSet.has(item.secret)) continue;
          existingSet.add(item.secret);
          additions.push({ ...item, id: crypto.randomUUID() });
        }
        const next = [...additions, ...localItems];
        saveLocalTotpVault(next);
        setLocalItems(next);
        showToast(fmt(tp.batchLocalSuccessToast, { count: additions.length }));
      }
      setBatchText('');
      setBatchOpen(false);
    } catch (err) {
      setBatchError(
        err instanceof RangeError ? fmt(tp.localVaultFullErr, { limit: TOTP_VAULT_LIMIT }) : tp.saveFailedErr
      );
    } finally {
      setBatchImporting(false);
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `2fa-${(issuer || 'accthub').replace(/[^a-z0-9_-]/gi, '')}.png`;
    a.click();
  };

  const hasValidCode = cleanedSecret.length >= 8 && code !== '------' && !error;

  return (
    <div className="max-w-[1160px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-editorial text-3xl font-semibold tracking-tight">{sf.totpTitle}</h1>
          <p className="text-xs sm:text-sm mt-1.5" style={{ color: 'var(--ink-secondary)' }}>
            {sf.totpSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium"
            style={{
              borderColor: 'var(--border-color)',
              backgroundColor: 'var(--bg-surface)',
              color: user ? 'var(--success)' : 'var(--ink-secondary)',
            }}
          >
            {user ? <Cloud className="w-3.5 h-3.5" /> : <HardDrive className="w-3.5 h-3.5" />}
            {user ? sf.totpCloudSync : sf.totpGuestLocal}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <TotpGeneratorCard
          secretInputRef={secretInputRef}
          secretInput={secretInput}
          cleanedSecret={cleanedSecret}
          issuer={issuer}
          accountName={accountName}
          digits={digits}
          period={period}
          code={code}
          nextCode={nextCode}
          remaining={remaining}
          progress={progress}
          error={error}
          qrDataUrl={qrDataUrl}
          otpAuthUri={otpAuthUri}
          savingVault={savingVault}
          onSecretChange={handleSecretChange}
          onMultiLinePaste={(lines) => {
            setBatchText(lines.join('\n'));
            setBatchOpen(true);
            showToast(fmt(tp.detectedLinesToast, { count: lines.length }));
          }}
          onPasteClipboard={() => void handlePasteClipboard()}
          onGenerateRandom={() => {
            setSecretInput(generateRandomBase32Secret(32));
            if (!issuer.trim()) setIssuer('Google');
          }}
          onDigitsChange={setDigits}
          onPeriodChange={setPeriod}
          onIssuerChange={setIssuer}
          onAccountNameChange={setAccountName}
          onClearSecret={() => {
            setSecretInput('');
            setError('');
            secretInputRef.current?.focus();
          }}
          onSaveCurrent={() => void handleSaveCurrent()}
          onOpenQrZoom={() => setQrZoomOpen(true)}
          onDownloadQr={handleDownloadQr}
        />

        <TotpVaultPanel
          user={user}
          vaultItems={vaultItems}
          vaultLoading={vaultLoading}
          vaultCodes={vaultCodes}
          hasValidCode={hasValidCode}
          savingVault={savingVault}
          onSelectVaultItem={(item) => {
            setSecretInput(item.secret);
            setIssuer(item.issuer);
            setAccountName(item.account_name);
            setDigits(item.digits === 8 ? 8 : 6);
            setPeriod(item.period === 60 ? 60 : 30);
          }}
          onSaveCurrent={() => void handleSaveCurrent()}
          onFocusSecretPrompt={() => {
            secretInputRef.current?.focus();
            showToast(tp.focusPromptToast);
          }}
          onOpenBatchImport={() => {
            setBatchError('');
            setBatchOpen(true);
          }}
          onDeleteItem={(id) => void handleDeleteVault(id)}
        />
      </div>

      <TotpModals
        qrZoomOpen={qrZoomOpen}
        qrDataUrl={qrDataUrl}
        issuer={issuer}
        accountName={accountName}
        onCloseQrZoom={() => setQrZoomOpen(false)}
        batchOpen={batchOpen}
        batchText={batchText}
        batchImporting={batchImporting}
        batchError={batchError}
        onBatchTextChange={setBatchText}
        onBatchSubmit={(e) => void handleBatchImport(e)}
        onCloseBatch={() => setBatchOpen(false)}
      />
    </div>
  );
}
