/**
 * 运营总控后台：全站会员管理（检索筛选、冻结/解冻、拉黑/解除、安全删除、严格守恒余额调账与流水查验）
 */

import type { AdminMemberItemDto } from '@shared/index';
import { Ban, History, KeyRound, Loader2, RotateCcw, Search, Trash2, Users, Wallet } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { openConfirm } from '../../components/ConfirmDialog';
import { fmt } from '../../i18n';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';
import { useRiskControlI18n } from '../../i18n/namespaces/risk-control';
import { useAdminMembersQuery } from '../../queries/admin.queries';
import { AdminMemberAdjustModal, AdminMemberResetPwdModal, AdminMemberTxModal } from './AdminMemberModals';

interface AdminMembersTabProps {
  showToast: (msg: string) => void;
}

export function AdminMembersTab({ showToast }: AdminMembersTabProps) {
  const ao = useAdminOpsI18n();
  const rf = useRiskControlI18n();
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'agent' | 'admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blacklisted'>('all');
  const [page, setPage] = useState(1);

  const [adjustTarget, setAdjustTarget] = useState<AdminMemberItemDto | null>(null);
  const [resetPwdTarget, setResetPwdTarget] = useState<AdminMemberItemDto | null>(null);
  const [txTargetId, setTxTargetId] = useState<number | null>(null);

  const membersQuery = useAdminMembersQuery({
    q: appliedSearch || undefined,
    role: roleFilter,
    status: statusFilter,
    page,
    page_size: 20,
  });

  const data = membersQuery.data;
  const items = data?.items ?? [];
  const summary = data?.summary;
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.page_size ?? 20)));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setAppliedSearch(searchInput.trim());
  };

  const handleChangeStatus = async (m: AdminMemberItemDto, nextStatus: 'active' | 'blacklisted') => {
    const title = nextStatus === 'blacklisted' ? ao.memBlacklistTitle : ao.memRestoreTitle;
    const description = fmt(nextStatus === 'blacklisted' ? ao.memBlacklistDesc : ao.memRestoreDesc, {
      email: m.email,
    });
    const confirmLabel = nextStatus === 'blacklisted' ? ao.memBlacklistBtn : ao.memUnblacklistBtn;
    const ok = await openConfirm({
      title,
      description,
      confirmLabel,
      tone: nextStatus === 'active' ? 'accent' : 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.updateMemberStatus(m.id, { status: nextStatus });
      await membersQuery.refetch();
      showToast(ao.memStatusUpdatedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : ao.finLoadError);
    }
  };

  const handleDeleteMember = async (m: AdminMemberItemDto) => {
    const ok = await openConfirm({
      title: ao.memDeleteTitle,
      description: fmt(ao.memDeleteDesc, { email: m.email }),
      confirmLabel: ao.memDeleteBtn,
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await adminApi.deleteMember(m.id);
      await membersQuery.refetch();
      showToast(ao.memDeletedToast);
    } catch (err) {
      showToast(err instanceof Error ? err.message : ao.finLoadError);
    }
  };

  return (
    <div className="space-y-5">
      {/* 顶部 4 项会员与余额负债汇总 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: ao.memStatTotal, value: String(summary.total_users), accent: false },
            { label: ao.memStatAgents, value: String(summary.agent_users), accent: false },
            { label: ao.memStatBalance, value: `¥${summary.total_balance.toFixed(2)}`, accent: true },
            { label: ao.memStatPromo, value: `¥${summary.total_promo_balance.toFixed(2)}`, accent: false },
          ].map((c) => (
            <div key={c.label} className="paper-card rounded-2xl p-4 space-y-1">
              <div className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                {c.label}
              </div>
              <div
                className="text-2xl font-bold font-mono-num"
                style={{ color: c.accent ? 'var(--accent)' : 'var(--ink-primary)' }}
              >
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 检索与筛选栏 + 会员表格 */}
      <div className="paper-card rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {(
                [
                  ['all', ao.memRoleAll],
                  ['user', ao.memRoleUser],
                  ['agent', ao.memRoleAgent],
                  ['admin', ao.memRoleAdmin],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setRoleFilter(k);
                    setPage(1);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border cursor-pointer"
                  style={{
                    backgroundColor: roleFilter === k ? 'var(--accent-soft)' : 'var(--bg-surface)',
                    borderColor: roleFilter === k ? 'transparent' : 'var(--border-color)',
                    color: roleFilter === k ? 'var(--accent)' : 'var(--ink-secondary)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as 'all' | 'active' | 'blacklisted');
                setPage(1);
              }}
              className="acct-input py-1.5 px-2.5 text-xs w-auto"
            >
              <option value="all">{ao.memStatusAll}</option>
              <option value="active">{ao.memStatusActive}</option>
              <option value="blacklisted">{ao.memStatusBlacklisted}</option>
            </select>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--ink-muted)' }}
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={ao.memSearchPlaceholder}
                className="acct-input pl-8 py-1.5 text-xs w-56"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {membersQuery.isLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-xs space-y-2" style={{ color: 'var(--ink-muted)' }}>
            <Users className="w-6 h-6 mx-auto opacity-50" />
            <p>{ao.memEmpty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr
                  className="border-b whitespace-nowrap"
                  style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                >
                  <th className="py-2 pr-4">{ao.memColMember}</th>
                  <th className="py-2 pr-4">{ao.memColRoleSite}</th>
                  <th className="py-2 pr-4">{ao.memColBalance}</th>
                  <th className="py-2 pr-4">{ao.memColOrders}</th>
                  <th className="py-2 pr-4">{ao.memColCreated}</th>
                  <th className="py-2 text-right">{ao.memColActions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const isBlacklisted = m.status === 'blacklisted' || m.status !== 'active';
                  return (
                    <tr
                      key={m.id}
                      className="border-b last:border-b-0 align-middle"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      <td className="py-3 pr-4">
                        <div className="font-semibold flex items-center gap-1.5">
                          <span>{m.display_name}</span>
                          {isBlacklisted && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: 'var(--danger-soft)',
                                color: 'var(--danger)',
                              }}
                              title={m.status_note || undefined}
                            >
                              {ao.memStatusBlacklisted}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono-num" style={{ color: 'var(--ink-muted)' }}>
                          #{m.id} · {m.email}
                        </div>
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <span
                          className="inline-block px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                          style={{
                            backgroundColor:
                              m.role === 'admin'
                                ? 'var(--danger-soft)'
                                : m.role === 'agent'
                                  ? 'var(--accent-soft)'
                                  : 'var(--bg-subtle)',
                            color:
                              m.role === 'admin'
                                ? 'var(--danger)'
                                : m.role === 'agent'
                                  ? 'var(--accent)'
                                  : 'var(--ink-secondary)',
                          }}
                        >
                          {m.role === 'admin'
                            ? ao.memRoleAdmin
                            : m.role === 'agent'
                              ? ao.memRoleAgent
                              : ao.memRoleUser}
                        </span>
                        <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                          {m.site_slug ? `@${m.site_slug}` : ao.memSiteMain}
                          {m.agent_slug ? ` · @${m.agent_slug}` : ''}
                        </div>
                      </td>
                      <td className="py-3 pr-4 font-mono-num whitespace-nowrap">
                        <div className="font-semibold" style={{ color: 'var(--success)' }}>
                          ¥{m.balance.toFixed(2)}
                        </div>
                        {m.promo_balance > 0 && (
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            Promo ¥{m.promo_balance.toFixed(2)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4 font-mono-num whitespace-nowrap">
                        <div>
                          ¥{m.total_spent.toFixed(2)}{' '}
                          <span style={{ color: 'var(--ink-muted)' }}>({m.order_count})</span>
                        </div>
                        {m.total_recharged > 0 && (
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-muted)' }}>
                            Upgrade ¥{m.total_recharged.toFixed(0)}
                          </div>
                        )}
                      </td>
                      <td
                        className="py-3 pr-4 font-mono-num text-[11px] whitespace-nowrap"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {m.created_at}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setAdjustTarget(m)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium cursor-pointer"
                            style={{ borderColor: 'var(--border-strong)', color: 'var(--ink-primary)' }}
                          >
                            <Wallet className="w-3 h-3" />
                            {ao.memAdjustBtn}
                          </button>
                          <button
                            type="button"
                            onClick={() => setTxTargetId(m.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium cursor-pointer"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                          >
                            <History className="w-3 h-3" />
                            {ao.memTxBtn}
                          </button>
                          {m.role !== 'admin' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setResetPwdTarget(m)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium cursor-pointer"
                                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                              >
                                <KeyRound className="w-3 h-3" />
                                {rf.memResetPwdBtn}
                              </button>
                              {isBlacklisted ? (
                                <button
                                  type="button"
                                  onClick={() => void handleChangeStatus(m, 'active')}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium cursor-pointer"
                                  style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  {ao.memUnblacklistBtn}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleChangeStatus(m, 'blacklisted')}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium cursor-pointer"
                                  style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                                  title={ao.memBlacklistBtn}
                                >
                                  <Ban className="w-3 h-3" />
                                  {ao.memBlacklistBtn}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteMember(m)}
                                className="inline-flex items-center p-1.5 rounded-lg border cursor-pointer"
                                style={{ borderColor: 'var(--border-color)', color: 'var(--ink-muted)' }}
                                title={ao.memDeleteBtn}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 分页条 */}
        {data && data.total > data.page_size && (
          <div
            className="flex items-center justify-between pt-3 border-t text-xs"
            style={{ borderColor: 'var(--border-color)' }}
          >
            <span style={{ color: 'var(--ink-muted)' }}>
              {fmt(ao.memPageSummary, { total: data.total, page, pages: totalPages })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 rounded-lg border cursor-pointer disabled:opacity-40"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {ao.memPrevPage}
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 rounded-lg border cursor-pointer disabled:opacity-40"
                style={{ borderColor: 'var(--border-color)' }}
              >
                {ao.memNextPage}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 人工余额调账弹窗 */}
      <AdminMemberAdjustModal
        target={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onDone={async () => {
          await membersQuery.refetch();
        }}
        showToast={showToast}
      />

      {/* 会员流水抽屉弹窗 */}
      <AdminMemberTxModal userId={txTargetId} onClose={() => setTxTargetId(null)} />

      {/* 管理员代重置密码弹窗 */}
      <AdminMemberResetPwdModal
        target={resetPwdTarget}
        onClose={() => setResetPwdTarget(null)}
        showToast={showToast}
      />
    </div>
  );
}
