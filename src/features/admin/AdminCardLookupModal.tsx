/**
 * 按卡密明文内容反查归属商品与订单弹窗（售后防骗核验）
 */

import { Loader2, Search, X } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { adminRiskApi, type CardLookupMatch } from '../../api/admin-risk.api';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';

export function AdminCardLookupModal({
  open,
  onClose,
  showToast,
}: {
  open: boolean;
  onClose: () => void;
  showToast: (msg: string) => void;
}) {
  const rf = useRiskControlI18n();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<CardLookupMatch[] | null>(null);

  if (!open) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 3) return;
    setLoading(true);
    try {
      const res = await adminRiskApi.lookupCards(query.trim());
      setMatches(res.matches);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="paper-card rounded-2xl w-full max-w-2xl max-h-[84vh] flex flex-col overflow-hidden text-xs">
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h3 className="font-editorial text-lg font-semibold">{rf.cardLookupTitle}</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              minLength={3}
              required
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={rf.cardLookupPlaceholder}
              className="acct-input font-mono-num flex-1"
            />
            <button
              type="submit"
              disabled={loading || query.trim().length < 3}
              className="px-4 py-2 rounded-xl font-semibold cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              {rf.cardLookupSearchBtn}
            </button>
          </form>

          {matches !== null &&
            (matches.length === 0 ? (
              <p className="py-8 text-center" style={{ color: 'var(--ink-muted)' }}>
                {rf.cardLookupEmpty}
              </p>
            ) : (
              <div className="space-y-2">
                {matches.map((m) => (
                  <div
                    key={m.card_id}
                    className="p-3.5 rounded-xl border space-y-1"
                    style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {m.product_title} ({m.spec_id})
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full font-mono-num text-[10.5px]"
                        style={{
                          backgroundColor:
                            m.status === 'available' ? 'var(--success-soft)' : 'var(--accent-soft)',
                          color: m.status === 'available' ? 'var(--success)' : 'var(--accent)',
                        }}
                      >
                        {m.is_loop ? rf.cardLoopBadge : m.status}
                      </span>
                    </div>
                    <div className="font-mono-num text-[11.5px] break-all">{m.card_content}</div>
                    {m.order_no && (
                      <div className="font-mono-num text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                        Order: {m.order_no} · {m.contact_email || '-'} · IP: {m.buyer_ip || '-'} ·{' '}
                        {m.sold_at || ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
