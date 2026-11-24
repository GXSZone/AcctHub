/**
 * 2FA 二维码扫码展示、链接复制与服务名/账号编辑卡
 */

import { Check, Download, Link2, Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { useTotpI18n } from '../../i18n/namespaces/totp';

interface TotpQrCardProps {
  qrDataUrl: string;
  otpAuthUri: string;
  issuer: string;
  accountName: string;
  onIssuerChange: (v: string) => void;
  onAccountNameChange: (v: string) => void;
  onOpenQrZoom: () => void;
  onDownloadQr: () => void;
}

export function TotpQrCard({
  qrDataUrl,
  otpAuthUri,
  issuer,
  accountName,
  onIssuerChange,
  onAccountNameChange,
  onOpenQrZoom,
  onDownloadQr,
}: TotpQrCardProps) {
  const tp = useTotpI18n();
  const [copiedUri, setCopiedUri] = useState(false);

  return (
    <div
      className="p-4 rounded-2xl border space-y-3.5"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={onOpenQrZoom}
            className="p-0 border-0 bg-transparent cursor-pointer block rounded-xl"
            aria-label={tp.zoomQrAria}
          >
            <img
              src={qrDataUrl}
              alt={tp.qrAlt}
              className="w-24 h-24 rounded-xl border p-1 bg-white"
              style={{ borderColor: 'var(--border-color)' }}
            />
          </button>
          <button
            type="button"
            onClick={onOpenQrZoom}
            className="absolute -right-1.5 -bottom-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            title={tp.zoomQrTooltip}
          >
            <Maximize2 className="w-3 h-3" />
          </button>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold">{tp.qrScanTitle}</div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            {tp.qrScanDesc}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(otpAuthUri);
            setCopiedUri(true);
            setTimeout(() => setCopiedUri(false), 1600);
          }}
          className="py-2 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center justify-center gap-1.5"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
        >
          {copiedUri ? (
            <Check className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
          ) : (
            <Link2 className="w-3.5 h-3.5" />
          )}
          {copiedUri ? tp.copiedUriBtn : tp.copyUriBtn}
        </button>
        <button
          type="button"
          onClick={onDownloadQr}
          className="py-2 rounded-xl border text-xs font-medium cursor-pointer inline-flex items-center justify-center gap-1.5"
          style={{ borderColor: 'var(--border-strong)', backgroundColor: 'var(--bg-surface)' }}
        >
          <Download className="w-3.5 h-3.5" />
          {tp.downloadBtn}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {tp.issuerLabel}
          </div>
          <input
            type="text"
            value={issuer}
            onChange={(e) => onIssuerChange(e.target.value)}
            placeholder={tp.issuerPh}
            className="acct-input h-9 text-xs"
          />
        </div>
        <div>
          <div className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
            {tp.accountLabel}
          </div>
          <input
            type="text"
            value={accountName}
            onChange={(e) => onAccountNameChange(e.target.value)}
            placeholder={tp.accountPh}
            className="acct-input h-9 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
