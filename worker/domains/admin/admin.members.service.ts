import {
  type AdminAdjustMemberBalanceInput,
  type AdminMembersQuery,
  type AdminUpdateMemberStatusInput,
  roundCurrency,
} from '@shared/index';
import type { Env } from '../../env';
import { type AuditActorContext, recordAdminAudit } from '../../infra/audit';
import { generateBizNo } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { getUserBalance, listUserWalletTransactions } from '../account/wallet.repo';
import {
  accountCanPost,
  commitWalletEvent,
  walletEventKey,
  walletPosting,
} from '../account/wallet-event.repo';
import { findUserById } from '../auth/auth.repo';
import {
  countMemberFinancialBindingsRepo,
  deleteCleanMemberRepo,
  queryAdminMembersRepo,
  revokeMemberSessionsRepo,
  updateMemberStatusRepo,
} from './admin.members.repo';

/** 查询全站会员列表与核心汇总统计 */
export async function listAdminMembers(env: Env, query: AdminMembersQuery) {
  return queryAdminMembersRepo(createDb(env.DB), query);
}

/** 查询指定会员近 50 条钱包资金流水 */
export async function listAdminMemberTransactions(env: Env, userId: number) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');
  const transactions = await listUserWalletTransactions(db, userId, { limit: 50 });
  return {
    user: {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      balance: Number(user.balance || 0),
      promo_balance: Number(user.promoBalance || 0),
    },
    transactions,
  };
}

/** 总控后台人工调账（正数加款、负数扣款；通过原子资金事件同步写入不可变 wallet_transactions，确保 100% 钱包守恒） */
export async function adjustAdminMemberBalance(
  env: Env,
  actor: AuditActorContext,
  userId: number,
  input: AdminAdjustMemberBalanceInput
) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');

  const amount = roundCurrency(input.amount);
  const beforeBalance = Number(user.balance || 0);
  if (amount < 0 && beforeBalance + amount < -0.001) {
    throw Errors.validation(
      `余额不足，无法扣减 ¥${Math.abs(amount).toFixed(2)}（当前余额 ¥${beforeBalance.toFixed(2)}）`
    );
  }

  const refNo = generateBizNo('ADJ');
  const event = await commitWalletEvent(
    db,
    {
      eventKey: walletEventKey('admin-balance-adjust', refNo),
      amount,
      when: accountCanPost(db, userId, amount),
    },
    (owned) =>
      walletPosting(db, owned, {
        userId,
        amount,
        type: 'admin_adjust',
        refNo,
        note: `总控调账（${actor.actorEmail}）：${input.reason}`,
      })
  );

  if (!event.applied) {
    throw Errors.conflict('调账失败，账户余额已变动或不足，请刷新后重试');
  }

  const balanceAfter = await getUserBalance(db, userId);
  await recordAdminAudit(db, actor, {
    action: 'member.adjust_balance',
    targetType: 'user',
    targetId: userId,
    summary: `为会员 ${user.email} 人工调账 ${amount >= 0 ? '+' : ''}¥${amount.toFixed(2)}（原因：${input.reason}）`,
    before: { balance: beforeBalance },
    after: { balance: balanceAfter, ref_no: refNo, delta: amount, reason: input.reason },
  });

  return { ok: true, ref_no: refNo, balance: balanceAfter };
}

/** 强制下线指定会员的全部登录会话 */
export async function revokeAdminMemberSessions(env: Env, actor: AuditActorContext, userId: number) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');
  if (user.id === actor.actorUserId) {
    throw Errors.validation('无法强制下线当前正在使用的管理员自身会话');
  }

  await revokeMemberSessionsRepo(db, userId);
  await recordAdminAudit(db, actor, {
    action: 'member.revoke_sessions',
    targetType: 'user',
    targetId: userId,
    summary: `强制下线会员 ${user.email} 的全部登录会话`,
  });
  return { ok: true };
}

/** 更新会员账号状态（正常 / 拉黑）；拉黑会立即吊销全部会话并触发全站邮箱级联防封禁 */
export async function updateAdminMemberStatus(
  env: Env,
  actor: AuditActorContext,
  userId: number,
  input: AdminUpdateMemberStatusInput
) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');
  if (user.role === 'admin' || user.id === actor.actorUserId) {
    throw Errors.forbidden('不可拉黑管理员账号');
  }

  const beforeStatus = user.status || 'active';
  const note = (input.reason || '').trim().slice(0, 180);
  await updateMemberStatusRepo(db, userId, input.status, note);

  const labelMap = { active: '解除拉黑', blacklisted: '加入全站黑名单' } as const;
  await recordAdminAudit(db, actor, {
    action: `member.status_${input.status}`,
    targetType: 'user',
    targetId: userId,
    summary: `将会员 ${user.email} 状态调整为「${labelMap[input.status]}」${note ? `（原因：${note}）` : ''}`,
    before: { status: beforeStatus, status_note: user.statusNote || '' },
    after: { status: input.status, status_note: note },
  });

  return { ok: true, status: input.status };
}

/** 安全删除会员账号（带资金守恒硬拦截：凡有余额、订单、财务流水或代理身份均拒绝物理删除，提示改用拉黑） */
export async function deleteAdminMember(env: Env, actor: AuditActorContext, userId: number) {
  const db = createDb(env.DB);
  const user = await findUserById(db, userId);
  if (!user) throw Errors.notFound('会员账号不存在');
  if (user.role === 'admin' || user.id === actor.actorUserId) {
    throw Errors.forbidden('不可删除管理员账号');
  }
  if (Math.abs(Number(user.balance || 0)) > 0.001 || Math.abs(Number(user.promoBalance || 0)) > 0.001) {
    throw Errors.conflict('该会员账户仍有未结余额或推广消费金，为保障资金守恒不可物理删除，请改用「拉黑」');
  }
  const bindings = await countMemberFinancialBindingsRepo(db, userId);
  if (bindings.agents > 0) {
    throw Errors.conflict('该会员已开通代理分站，不可直接物理删除，请改用「拉黑」');
  }
  if (bindings.orders > 0 || bindings.walletTx > 0 || bindings.promoTx > 0 || bindings.recharges > 0) {
    throw Errors.conflict(
      '该会员存在历史订单或资金流水，为保障财务对账守恒不可物理删除，请改用「冻结」或「拉黑」'
    );
  }

  await deleteCleanMemberRepo(db, userId);
  await recordAdminAudit(db, actor, {
    action: 'member.delete',
    targetType: 'user',
    targetId: userId,
    summary: `物理删除无交易空会员账号 ${user.email} (#${userId})`,
    before: { email: user.email, display_name: user.displayName, role: user.role },
  });

  return { ok: true };
}
