/**
 * 支付完成后商品页顶部签发凭证展示横幅
 */

import { Check, CheckCircle2, Copy, Headphones, KeyRound, Mail } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CredentialCard } from '../../components/CredentialCard';
import { fmt } from '../../i18n';
import { useStorefrontI18n } from '../../i18n/namespaces/storefront';
import { toast } from '../../lib/toast';
import { prepareTotpHandoff } from '../../lib/totp-handoff';
import type { OrderRecord, UserProfile } from '../../types';

interface ProductDeliveredBannerProps {
  order: OrderRecord;
  user: UserProfile | null;
  tenant?: string | null;
}

export function ProductDeliveredBanner({ order, user }: ProductDeliveredBannerProps) {
  const sf = useStorefrontI18n();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [copiedLookup, setCopiedLookup] = useState(false);
  const publicNo = order.public_order_no;

  const extracted2fa = useMemo(() => {
    if (!order.delivered_payload) return null;
    const m = order.delivered_payload.match(/2FA:([A-Z2-7]{8,})/i);
    return m ? m[1] : null;
  }, [order.delivered_payload]);

  const copyPayload = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(sf.copyAllCopied);
    setTimeout(() => setCopied(false), 1800);
  };

  const mailHint =
    order.mail_delivery?.status === 'sent'
      ? fmt(sf.mailStatusSent, { email: order.contact_email })
      : order.mail_delivery?.status === 'pending'
        ? fmt(sf.mailStatusPending, { email: order.contact_email })
        : order.mail_delivery?.status === 'disabled'
          ? sf.mailStatusDisabled
          : null;

  return (
    <section
      className="mb-8 rounded-2xl p-6 border-2"
      style={{ backgroundColor: 'var(--success-soft)', borderColor: 'var(--success)' }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="w-6 h-6 shrink-0" style={{ color: 'var(--success)' }} />
          <div>
            <h2 className="font-editorial text-xl font-semibold" style={{ color: 'var(--ink-primary)' }}>
              {sf.deliveredTitle}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
              {fmt(sf.deliveredMeta, {
                orderNo: publicNo || order.order_no,
                amount: order.total_amount.toFixed(2),
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {publicNo && (
            <button
              type="button"
              className="rounded-xl border px-3.5 py-2 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(publicNo);
                setCopiedLookup(true);
                toast.success(sf.checkoutLookupCopied);
              }}
            >
              {copiedLookup ? sf.checkoutLookupCopied : sf.checkoutLookupCopy}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copyPayload(order.delivered_payload)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer"
            style={{ backgroundColor: 'var(--success)', color: '#FAF9F5' }}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? sf.copyAllCopied : sf.copyAllBtn}
          </button>
          {extracted2fa && (
            <button
              type="button"
              onClick={() => navigate(prepareTotpHandoff({ secret: extracted2fa }))}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer border"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-strong)',
                color: 'var(--ink-primary)',
              }}
            >
              <KeyRound className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {sf.parse2faBtn}
            </button>
          )}
          {user && (
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/account/tickets?order_no=${encodeURIComponent(order.order_no)}&category=after_sale`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium cursor-pointer border"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-strong)',
                color: 'var(--ink-primary)',
              }}
            >
              <Headphones className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              {sf.applyTicketBtn}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4">
        <CredentialCard payload={order.delivered_payload} productTitle={order.product_title} user={user} />
      </div>

      {mailHint && (
        <div
          className="mt-3 flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs"
          style={{
            backgroundColor: 'var(--bg-surface)',
            color: order.mail_delivery?.status === 'disabled' ? 'var(--warning)' : 'var(--ink-secondary)',
          }}
        >
          <Mail className="w-3.5 h-3.5 shrink-0" />
          <span>{mailHint}</span>
        </div>
      )}
    </section>
  );
}
