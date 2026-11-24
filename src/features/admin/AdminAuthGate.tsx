/**
 * 总控后台管理员登录入口
 */

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { setupApi } from '../../api/setup.api';
import { useAdminCoreI18n } from '../../i18n/namespaces/admin-core';

interface AdminAuthGateProps {
  authError: string;
  onOpenAuth: () => void;
}

export function AdminAuthGate({ authError, onOpenAuth }: AdminAuthGateProps) {
  const ac = useAdminCoreI18n();
  const setupQuery = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => setupApi.status(),
    retry: false,
  });

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <div className="paper-card rounded-2xl p-6 sm:p-8">
        {setupQuery.data?.requires_setup && (
          <div
            className="mb-4 p-3.5 rounded-xl border text-xs space-y-2"
            style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
          >
            <div className="font-semibold" style={{ color: 'var(--accent)' }}>
              {ac.gateNeedSetup}
            </div>
            <Link
              to="/setup"
              className="inline-block px-3.5 py-1.5 rounded-lg text-xs font-semibold no-underline"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              {ac.gateGoSetup}
            </Link>
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <h1 className="font-editorial text-2xl font-semibold">{ac.gateTitle}</h1>
        </div>
        <p className="text-xs leading-relaxed mb-5" style={{ color: 'var(--ink-secondary)' }}>
          {ac.gateSubtitle}
        </p>

        {authError && (
          <div className="text-xs mb-3" style={{ color: 'var(--danger)' }}>
            {authError}
          </div>
        )}
        <button
          type="button"
          onClick={onOpenAuth}
          className="w-full py-2.5 rounded-xl text-sm font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {ac.gateLoginBtn}
        </button>
      </div>
    </div>
  );
}
