import { KeyRound, Loader2, Lock } from 'lucide-react';
import { useState } from 'react';
import { useCommerceI18n } from '../../i18n/namespaces/commerce';

interface ProductAccessGateProps {
  productTitle: string;
  loading?: boolean;
  hasAttemptedWrong?: boolean;
  onUnlock: (code: string) => void;
}

export function ProductAccessGate({
  productTitle,
  loading = false,
  hasAttemptedWrong = false,
  onUnlock,
}: ProductAccessGateProps) {
  const cm = useCommerceI18n();
  const [code, setCode] = useState('');

  return (
    <div className="max-w-lg mx-auto paper-card rounded-2xl p-6 sm:p-8 space-y-5 text-center">
      <div
        className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        <Lock className="w-6 h-6" />
      </div>
      <div>
        <h1 className="font-editorial text-2xl font-semibold">{productTitle}</h1>
        <div className="text-sm font-semibold mt-2">{cm.accessLockedTitle}</div>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {cm.accessLockedDesc}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          onUnlock(code.trim());
        }}
        className="space-y-3"
      >
        <div className="relative">
          <input
            type="text"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={cm.accessCodePlaceholder}
            className="acct-input text-center font-mono-num"
          />
        </div>
        {hasAttemptedWrong && (
          <div className="text-xs font-medium" style={{ color: 'var(--danger)' }}>
            {cm.accessWrongErr}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !code.trim()}
          className="w-full py-2.5 rounded-xl text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          {cm.accessUnlockBtn}
        </button>
      </form>
    </div>
  );
}
