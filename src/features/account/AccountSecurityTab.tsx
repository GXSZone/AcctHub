/**
 * 会员中心账户安全、昵称与近期登录日志 Tab
 */

import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountApi } from '../../api/account.api';
import { useAccountI18n } from '../../i18n/namespaces/account';
import { useAccountSecurityQuery } from '../../queries/account.queries';
import { useAuthActions, useAuthScope } from '../../queries/storefront.queries';
import type { UserProfile } from '../../types';
import { AccountOAuthBindingsCard } from '../oauth/AccountOAuthBindingsCard';

interface AccountSecurityTabProps {
  user: UserProfile;
  onRefreshUser: () => void;
  onToast: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AccountSecurityTab({ user, onRefreshUser, onToast, onError }: AccountSecurityTabProps) {
  const acc = useAccountI18n();
  const { clearSession } = useAuthActions(useAuthScope());
  const securityQuery = useAccountSecurityQuery(true);
  const [displayName, setDisplayName] = useState(user.display_name || '');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [secSaving, setSecSaving] = useState(false);

  useEffect(() => {
    if (securityQuery.data?.display_name) {
      setDisplayName(securityQuery.data.display_name);
    }
  }, [securityQuery.data?.display_name]);

  const loginLogs = securityQuery.data?.login_logs ?? [];

  return (
    <div className="space-y-5">
      <h1 className="font-editorial text-2xl sm:text-3xl font-semibold">{acc.secTitle}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSecSaving(true);
            onError('');
            try {
              await accountApi.updateProfile(displayName);
              onRefreshUser();
              onToast(acc.secProfileToast);
            } catch (err) {
              onError(err instanceof Error ? err.message : acc.secProfileFailErr);
            } finally {
              setSecSaving(false);
            }
          }}
          className="paper-card rounded-2xl p-6 space-y-4"
        >
          <h2 className="font-editorial text-lg font-semibold">{acc.secProfileHeading}</h2>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.secEmailLabel}</div>
            <input type="text" disabled value={user.email} className="acct-input opacity-70 font-mono-num" />
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.secNicknameLabel}</div>
            <input
              type="text"
              required
              minLength={2}
              maxLength={32}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="acct-input"
            />
          </div>
          <button
            type="submit"
            disabled={secSaving}
            className="px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {acc.secSaveNicknameBtn}
          </button>
        </form>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSecSaving(true);
            onError('');
            try {
              await accountApi.updatePassword(curPwd, newPwd);
              setCurPwd('');
              setNewPwd('');
              onToast(acc.secPwdToast);
              clearSession();
            } catch (err) {
              onError(err instanceof Error ? err.message : acc.secPwdFailErr);
            } finally {
              setSecSaving(false);
            }
          }}
          className="paper-card rounded-2xl p-6 space-y-4"
        >
          <h2 className="font-editorial text-lg font-semibold flex items-center gap-1.5">
            <Lock className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            {acc.secPwdHeading}
          </h2>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.secCurPwdLabel}</div>
            <input
              type="password"
              required
              value={curPwd}
              onChange={(e) => setCurPwd(e.target.value)}
              className="acct-input"
            />
          </div>
          <div>
            <div className="block text-xs font-semibold mb-1">{acc.secNewPwdLabel}</div>
            <input
              type="password"
              required
              minLength={6}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="acct-input"
            />
          </div>
          <button
            type="submit"
            disabled={secSaving}
            className="px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
          >
            {acc.secChangePwdBtn}
          </button>
        </form>
      </div>

      <AccountOAuthBindingsCard onToast={onToast} onError={onError} />

      <div className="paper-card rounded-2xl p-6 space-y-3">
        <h2 className="font-editorial text-lg font-semibold">{acc.secLogsHeading}</h2>
        {loginLogs.length === 0 ? (
          <p className="text-xs py-4" style={{ color: 'var(--ink-muted)' }}>
            {acc.secLogsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-4">{acc.secLogColTime}</th>
                  <th className="py-2 pr-4">{acc.secLogColIp}</th>
                  <th className="py-2">{acc.secLogColUa}</th>
                </tr>
              </thead>
              <tbody>
                {loginLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-color)' }}
                  >
                    <td className="py-2 pr-4 font-mono-num whitespace-nowrap">{log.created_at}</td>
                    <td className="py-2 pr-4 font-mono-num whitespace-nowrap">{log.ip}</td>
                    <td className="py-2 truncate max-w-md" style={{ color: 'var(--ink-muted)' }}>
                      {log.user_agent}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
