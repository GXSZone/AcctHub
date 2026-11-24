import type { FlashSaleSnapshot } from '@shared/domain/commerce-modes';
import { Flame, Timer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmt } from '../../i18n';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';
import { useDisplayCurrency } from '../../lib/currency';

function formatCountdown(targetIso: string, nowMs: number): string {
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return '00:00:00';
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const hhmmss = [hours, mins, secs].map((n) => String(n).padStart(2, '0')).join(':');
  return days > 0 ? `${days}d ${hhmmss}` : hhmmss;
}

export function FlashSaleBanner({ flashSale }: { flashSale?: FlashSaleSnapshot }) {
  const cm = useCommerceI18n();
  const { formatMoneyFixed } = useDisplayCurrency();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const activeOrUpcoming =
    flashSale &&
    (flashSale.status === 'active' || flashSale.status === 'upcoming' || flashSale.status === 'sold_out');

  useEffect(() => {
    if (!activeOrUpcoming || flashSale.status === 'sold_out') return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeOrUpcoming, flashSale?.status]);

  if (!activeOrUpcoming || !flashSale) return null;

  const targetIso = flashSale.status === 'upcoming' ? flashSale.start_at : flashSale.end_at;
  const countdown = formatCountdown(targetIso, nowMs);
  const pct =
    flashSale.limit > 0
      ? Math.min(100, Math.round((flashSale.sold / Math.max(1, flashSale.limit)) * 100))
      : 0;

  return (
    <div
      className="rounded-2xl border p-4 space-y-2.5"
      style={{
        borderColor: 'var(--accent)',
        backgroundColor: 'var(--accent-soft)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex items-center gap-1.5 text-xs font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          <Flame className="w-4 h-4" />
          <span>
            {flashSale.status === 'upcoming'
              ? cm.flashTitleUpcoming
              : flashSale.status === 'sold_out'
                ? cm.flashTitleSoldOut
                : cm.flashTitleActive}
          </span>
        </div>

        {flashSale.status !== 'sold_out' && targetIso && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono-num font-semibold"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>
              {flashSale.status === 'upcoming' ? cm.flashStartsIn : cm.flashEndsIn} {countdown}
            </span>
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-3 text-[11px]"
        style={{ color: 'var(--ink-secondary)' }}
      >
        <span>
          {flashSale.limit > 0
            ? fmt(cm.flashLeftQuota, { left: flashSale.remaining ?? 0 })
            : cm.flashUnlimited}
        </span>
        {flashSale.price && (
          <span className="font-mono-num font-semibold" style={{ color: 'var(--accent)' }}>
            {formatMoneyFixed(flashSale.price)}
          </span>
        )}
      </div>

      {flashSale.limit > 0 && (
        <div
          className="h-1.5 w-full rounded-full overflow-hidden"
          style={{ backgroundColor: 'var(--bg-surface)' }}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }}
          />
        </div>
      )}
    </div>
  );
}
