/**
 * 页脚商用合规条款页（/legal/terms | /legal/privacy | /legal/refund）
 */

import { ArrowLeft, FileText } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useTenant } from '../app/TenantContext';
import { RichContentRenderer } from '../components/RichContentRenderer';
import { useRiskControlI18n } from '../i18n/namespaces/risk-control';

export function LegalPage() {
  const { type = 'terms' } = useParams<{ type: string }>();
  const { bootstrap } = useTenant();
  const rf = useRiskControlI18n();
  const settings = bootstrap?.settings ?? {};

  const isPrivacy = type === 'privacy';
  const isRefund = type === 'refund';

  const title = isPrivacy ? rf.legalPrivacyTitle : isRefund ? rf.legalRefundTitle : rf.legalTermsTitle;
  const customContent = isPrivacy
    ? settings.legal_privacy
    : isRefund
      ? settings.legal_refund
      : settings.legal_terms;
  const fallbackContent = isPrivacy
    ? rf.legalDefaultPrivacy
    : isRefund
      ? rf.legalDefaultRefund
      : rf.legalDefaultTerms;
  const content = (customContent || '').trim() || fallbackContent;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium no-underline"
        style={{ color: 'var(--accent)' }}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        {rf.legalBackHome}
      </Link>

      <article className="paper-card rounded-2xl p-6 sm:p-8 space-y-5">
        <div
          className="flex items-center justify-between gap-3 pb-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <h1 className="font-editorial text-2xl font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Link
              to="/legal/terms"
              className="underline"
              style={{ color: !isPrivacy && !isRefund ? 'var(--accent)' : 'var(--ink-muted)' }}
            >
              {rf.legalTermsTitle}
            </Link>
            <Link
              to="/legal/privacy"
              className="underline"
              style={{ color: isPrivacy ? 'var(--accent)' : 'var(--ink-muted)' }}
            >
              {rf.legalPrivacyTitle}
            </Link>
            <Link
              to="/legal/refund"
              className="underline"
              style={{ color: isRefund ? 'var(--accent)' : 'var(--ink-muted)' }}
            >
              {rf.legalRefundTitle}
            </Link>
          </div>
        </div>

        <div className="text-sm leading-relaxed">
          <RichContentRenderer content={content} />
        </div>

        <div
          className="pt-4 border-t text-xs"
          style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
        >
          {bootstrap?.settings?.brand_name || 'AcctHub'} · {rf.legalUpdatedNote}
        </div>
      </article>
    </div>
  );
}
