import { formatWarrantyTypeShort } from '@shared/domain/warranty';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  PlugZap,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { useState } from 'react';
import { fmt } from '../i18n';
import { useAccountI18n } from '../i18n/namespaces/account';
import type { AccountDict } from '../i18n/namespaces/account/zh-CN';
import type { OrderWarrantyStatus, TicketOrderSnapshot } from '../types';

export { formatWarrantyTypeShort };

function formatWarrantyTypeLabel(acc: AccountDict, type?: string | null, value?: number | null): string {
  if (type === 'none') return acc.warrantyNone;
  const n = Math.max(1, Number(value) || 1);
  if (type === 'first_login') return fmt(acc.warrantyFirstLogin, { n });
  if (type === 'days') return fmt(acc.warrantyDays, { n });
  return fmt(acc.warrantyFullPeriod, { n });
}

export function WarrantyStatusBadge({
  warranty,
  compact = false,
}: {
  warranty?: OrderWarrantyStatus | null;
  compact?: boolean;
}) {
  if (!warranty) return null;

  const palette =
    warranty.status === 'in_warranty'
      ? { bg: 'var(--success-soft)', color: 'var(--success)', Icon: ShieldCheck }
      : warranty.status === 'first_login'
        ? { bg: 'var(--accent-soft)', color: 'var(--accent)', Icon: ShieldCheck }
        : warranty.status === 'expired'
          ? { bg: 'var(--danger-soft)', color: 'var(--danger)', Icon: ShieldAlert }
          : { bg: 'var(--bg-subtle)', color: 'var(--ink-muted)', Icon: ShieldOff };

  const Icon = palette.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${
        compact ? 'px-2 py-0.5 text-[10.5px]' : 'px-2.5 py-0.5 text-[11px]'
      }`}
      style={{ backgroundColor: palette.bg, color: palette.color }}
      title={warranty.warranty_summary}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {warranty.badge_label}
    </span>
  );
}

export function TicketOrderCard({
  order,
  showDeliveredPayload = false,
  title,
  onReplaceViaUpstream,
  replacingUpstream = false,
}: {
  order: TicketOrderSnapshot;
  showDeliveredPayload?: boolean;
  title?: string;
  onReplaceViaUpstream?: () => void;
  replacingUpstream?: boolean;
}) {
  const acc = useAccountI18n();
  const [payloadOpen, setPayloadOpen] = useState(false);
  const [copiedNo, setCopiedNo] = useState(false);
  const [copiedUpNo, setCopiedUpNo] = useState(false);
  const cardTitle = title ?? acc.tocDefaultTitle;

  const orderStatusLabel =
    order.status === 'refunded'
      ? acc.tocStatusRefunded
      : order.status === 'delivered'
        ? acc.tocStatusDelivered
        : order.status === 'upstream_pending'
          ? acc.tocStatusUpstreamPending
          : order.status === 'fulfillment_failed'
            ? acc.tocStatusFulfillmentFailed
            : order.status === 'paid'
              ? acc.tocStatusPaid
              : order.status;

  return (
    <div
      className="p-4 rounded-xl border space-y-2.5 text-xs"
      style={{
        borderColor: order.warranty.in_warranty
          ? 'color-mix(in srgb, var(--success) 35%, var(--border-color))'
          : order.warranty.status === 'expired'
            ? 'color-mix(in srgb, var(--danger) 35%, var(--border-color))'
            : 'var(--border-color)',
        backgroundColor: 'var(--bg-canvas)',
      }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b"
        style={{ borderColor: 'var(--border-color)' }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <ReceiptText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="font-semibold">{cardTitle}</span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(order.order_no);
              setCopiedNo(true);
              setTimeout(() => setCopiedNo(false), 1400);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono-num text-[11px] font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-primary)' }}
            title={acc.tocCopyOrderTitle}
          >
            {order.order_no}
            {copiedNo ? (
              <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
            ) : (
              <Copy className="w-3 h-3 opacity-60" />
            )}
          </button>
          <span
            className="text-[10.5px] px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: order.status === 'refunded' ? 'var(--danger-soft)' : 'var(--bg-subtle)',
              color: order.status === 'refunded' ? 'var(--danger)' : 'var(--ink-secondary)',
            }}
          >
            {orderStatusLabel}
          </span>
        </div>
        <WarrantyStatusBadge warranty={order.warranty} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-[11.5px]">
        <div className="sm:col-span-2">
          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.tocProductSpecHeading}
          </div>
          <div className="font-semibold mt-0.5 leading-snug">{order.product_title}</div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            {fmt(acc.tocSpecLine, {
              spec: order.spec_name || acc.tocStandardSpec,
              qty: order.quantity,
            })}
          </div>
        </div>
        <div>
          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.tocAmountChannelHeading}
          </div>
          <div className="font-mono-num font-semibold text-sm mt-0.5" style={{ color: 'var(--accent)' }}>
            ¥{Number(order.total_amount).toFixed(2)}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            {order.payment_method === 'balance' ? acc.tocPayBalance : acc.tocPayOnline} ·{' '}
            {order.tenant_slug ? fmt(acc.tocSiteTenant, { slug: order.tenant_slug }) : acc.tocSiteMain}
          </div>
        </div>
        <div>
          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
            {acc.tocEmailTimeHeading}
          </div>
          <div className="font-mono-num truncate mt-0.5">{order.contact_email}</div>
          <div className="font-mono-num text-[11px] mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
            {order.created_at}
          </div>
        </div>
      </div>

      {/* Warranty Policy & Expiration Detail Strip */}
      <div
        className="px-3 py-2 rounded-lg flex flex-wrap items-center justify-between gap-2 text-[11px]"
        style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
      >
        <span>
          <strong style={{ color: 'var(--ink-primary)' }}>
            {fmt(acc.tocWarrantyAttrLabel, {
              type: formatWarrantyTypeLabel(acc, order.warranty.warranty_type, order.warranty.warranty_days),
            })}
          </strong>
          {order.warranty.warranty_summary}
        </span>
        {order.warranty.expires_at && (
          <span
            className="inline-flex items-center gap-1 font-mono-num shrink-0"
            style={{ color: 'var(--ink-muted)' }}
          >
            <Clock className="w-3 h-3" />
            {fmt(acc.tocWarrantyExpires, { expires: order.warranty.expires_at })}
          </span>
        )}
      </div>

      {/* Super-Admin Exclusive Upstream Provenance & Net Profit Strip (never populated for agents/buyers) */}
      {order.upstream_info &&
        (order.upstream_info.fulfillment_source === 'upstream' || order.upstream_info.has_bindings) && (
          <div
            className="px-3 py-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-[11px]"
            style={{
              borderColor: 'color-mix(in srgb, var(--accent) 30%, var(--border-color))',
              backgroundColor: 'var(--bg-surface)',
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold text-[10.5px]"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <PlugZap className="w-3 h-3" />
                {acc.tocUpstreamBadge}
              </span>
              {order.upstream_info.upstream_source_name && (
                <span className="font-medium">{order.upstream_info.upstream_source_name}</span>
              )}
              {order.upstream_info.upstream_order_no && (
                <button
                  type="button"
                  onClick={async () => {
                    const upNo = order.upstream_info?.upstream_order_no;
                    if (!upNo) return;
                    await navigator.clipboard.writeText(upNo);
                    setCopiedUpNo(true);
                    setTimeout(() => setCopiedUpNo(false), 1400);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono-num cursor-pointer"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-primary)' }}
                  title={acc.tocCopyUpstreamTitle}
                >
                  {fmt(acc.tocUpstreamOrderNo, { no: order.upstream_info.upstream_order_no })}
                  {copiedUpNo ? (
                    <Check className="w-3 h-3" style={{ color: 'var(--success)' }} />
                  ) : (
                    <Copy className="w-3 h-3 opacity-60" />
                  )}
                </button>
              )}
              <span className="font-mono-num" style={{ color: 'var(--ink-secondary)' }}>
                {fmt(acc.tocUpstreamCost, {
                  amount: Number(order.upstream_info.upstream_cost_total || 0).toFixed(2),
                })}
              </span>
              <span
                className="font-mono-num font-semibold"
                style={{ color: order.upstream_info.net_profit >= 0 ? 'var(--success)' : 'var(--danger)' }}
              >
                {fmt(acc.tocUpstreamProfit, {
                  amount: Number(order.upstream_info.net_profit || 0).toFixed(2),
                })}
              </span>
            </div>

            {onReplaceViaUpstream && order.upstream_info.has_bindings && (
              <button
                type="button"
                disabled={replacingUpstream}
                onClick={onReplaceViaUpstream}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
              >
                <RefreshCw className={`w-3 h-3 ${replacingUpstream ? 'animate-spin' : ''}`} />
                {replacingUpstream ? acc.tocUpstreamReplacing : acc.tocUpstreamReplaceBtn}
              </button>
            )}
          </div>
        )}

      {showDeliveredPayload && order.delivered_payload && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setPayloadOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            style={{ color: 'var(--accent)' }}
          >
            {payloadOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {payloadOpen ? acc.tocHidePayloadBtn : acc.tocShowPayloadBtn}
          </button>
          {payloadOpen && (
            <pre
              className="mt-2 p-3 rounded-lg border font-mono-num text-[11px] whitespace-pre-wrap break-all max-h-40 overflow-y-auto"
              style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
            >
              {order.delivered_payload}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
