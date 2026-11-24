import type {
  AccountRechargeIntentInput,
  AccountSandboxRechargeInput,
  ChangePasswordInput,
  RedeemCdkInput,
  UpdateProfileInput,
} from '@shared/index';
import type { AuthUser } from '../../db/types';
import { type Env, isSandboxEnabled, type TenantContext } from '../../env';
import { hashPassword, verifyPassword } from '../../infra/auth-crypto';
import { generateBizNo } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { verifyTurnstileIfConfigured } from '../../infra/security';
import { getAuthUser } from '../auth/auth.service';
import { sanitizeOrderForUser } from '../orders/order-snapshot.repo';
import { createPaymentIntent } from '../payment/payment.service';
import {
  findRechargeCdkByCode,
  findUserPasswordHash,
  getConfiguredMinTopupAmountRepo,
  listMemberOrdersWithWarranty,
  listUserLoginLogs,
  loadAccountSummaryStats,
  updateUserDisplayName,
  updateUserPasswordHash,
} from './account.repo';
import { redeemCdkWithWalletPosting } from './account-posting.repo';
import { creditUserBalance, listUserWalletTransactions, recordWalletTx } from './wallet.repo';

/** 要求有效登录态，未登录时统一抛出 401 */
export async function requireAuthUser(req: Request, env: Env, tenant: TenantContext): Promise<AuthUser> {
  const user = await getAuthUser(req, env, tenant);
  if (!user) throw Errors.unauthorized('请先登录账号');
  return user;
}

/** 会员中心首页概览（严格按 user_id 隔离） */
export async function getMemberSummary(env: Env, user: AuthUser) {
  const db = createDb(env.DB);
  const monthIso = `${new Date().toISOString().slice(0, 7)}-01`;

  const [stats, recentOrdersRaw, recentTx] = await Promise.all([
    loadAccountSummaryStats(db, user.id, monthIso),
    listMemberOrdersWithWarranty(db, user.id, 5),
    listUserWalletTransactions(db, user.id, { limit: 8 }),
  ]);

  const recentOrders = await Promise.all(
    recentOrdersRaw.map((r) =>
      sanitizeOrderForUser(env, r.order, {
        warranty_type: r.order.warrantyType || r.prodWarrantyType || 'full_period',
        warranty_days: r.order.warrantyDays ?? r.prodWarrantyDays ?? 30,
        warranty_summary: r.order.warrantySummary || r.prodWarrantySummary || '',
      })
    )
  );

  return {
    balance: user.balance,
    monthly_spend: stats.monthlySpend,
    total_orders: stats.totalOrders,
    open_tickets: stats.openTickets,
    totp_count: stats.totpCount,
    recent_orders: recentOrders,
    recent_transactions: recentTx,
  };
}

/** 会员资金账单流水 */
export async function getMemberTransactions(env: Env, user: AuthUser, txType: string) {
  const db = createDb(env.DB);
  const transactions = await listUserWalletTransactions(db, user.id, {
    type: txType || undefined,
    limit: 100,
  });
  return { balance: user.balance, transactions };
}

/** 发起会员钱包异步在线充值支付单 */
export async function createMemberRechargeIntent(
  env: Env,
  user: AuthUser,
  tenant: TenantContext,
  originUrl: string,
  input: AccountRechargeIntentInput
) {
  const db = createDb(env.DB);
  const minTopup = await getConfiguredMinTopupAmountRepo(db);
  const amount = Number(input.amount.toFixed(2));
  if (amount < minTopup) {
    throw Errors.validation(`单次余额充值金额不能低于 ¥${minTopup}`);
  }
  const refNo = generateBizNo('RCG');
  const intent = await createPaymentIntent(env, {
    bizType: 'wallet_recharge',
    bizRef: refNo,
    userId: user.id,
    siteAgentId: tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0,
    provider: input.payment_method,
    amountCny: amount,
    subject: `AcctHub 钱包余额充值 ¥${amount.toFixed(2)}`,
    originUrl,
    returnUrl: `${originUrl}/account/recharge`,
    customerEmail: user.email,
  });

  return {
    ok: true,
    requires_payment: true,
    payment_intent: {
      intent_no: intent.intent_no,
      biz_type: 'wallet_recharge' as const,
      provider: intent.provider,
      currency: intent.currency,
      amount_cny: intent.amount_cny,
      pay_amount: intent.pay_amount,
      pay_url: intent.pay_url,
      qr_content: intent.qr_content,
      status: intent.status,
      expires_at: intent.expires_at,
      sandbox_simulated: intent.sandbox_simulated,
      view_token: intent.view_token,
    },
  };
}

/** 会员沙盒直充（生产环境强制 403 禁用） */
export async function executeSandboxRecharge(env: Env, user: AuthUser, input: AccountSandboxRechargeInput) {
  if (!isSandboxEnabled(env)) {
    throw Errors.sandboxDisabled('生产环境已关闭免回调沙盒直充，请使用充值卡密 (CDK) 或真实支付网关回调');
  }
  const db = createDb(env.DB);
  const minTopup = await getConfiguredMinTopupAmountRepo(db);
  const amount = Number(input.amount.toFixed(2));
  if (amount < minTopup) {
    throw Errors.validation(`单次余额充值金额不能低于 ¥${minTopup}`);
  }
  const refNo = generateBizNo('RCG');
  const newBalance = await creditUserBalance(db, user.id, amount);

  await recordWalletTx(env, {
    userId: user.id,
    type: 'recharge',
    amount,
    balanceAfter: newBalance,
    refNo,
    note: `充值中心在线充值（通道：${input.payment_method}）`,
  });

  return { ok: true, ref_no: refNo, added: amount, balance: newBalance };
}

/** 充值卡密 (CDK) CAS 原子兑换防并发双花 */
export async function redeemMemberCdk(env: Env, req: Request, user: AuthUser, input: RedeemCdkInput) {
  const tsCheck = await verifyTurnstileIfConfigured(
    req,
    env,
    'redeem_cdk',
    input['cf-turnstile-response'] || input.turnstile_token
  );
  if (!tsCheck.ok) throw Errors.forbidden(tsCheck.error);

  const db = createDb(env.DB);
  const code = input.code.trim().toUpperCase();
  const cdk = await findRechargeCdkByCode(db, code);
  if (!cdk) throw Errors.notFound('充值卡密不存在，请核对是否输入完整');
  if (cdk.status !== 'available') throw Errors.conflict('该充值卡密已被兑换使用');

  const newBalance = await redeemCdkWithWalletPosting(db, { cdk, userId: user.id, email: user.email });
  if (newBalance === null) throw Errors.conflict('该充值卡密刚刚已被兑换，请勿重复提交');

  return { ok: true, code: cdk.code, added: cdk.amount, balance: newBalance };
}

/** 获取账号安全信息与近期登录审计日志 */
export async function getMemberSecurityInfo(env: Env, user: AuthUser) {
  const db = createDb(env.DB);
  const logs = await listUserLoginLogs(db, user.id);
  return {
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    login_logs: logs,
  };
}

/** 更新会员显示昵称 */
export async function updateMemberProfile(env: Env, user: AuthUser, input: UpdateProfileInput) {
  const db = createDb(env.DB);
  const name = input.display_name.trim();
  await updateUserDisplayName(db, user.id, name);
  return { ok: true, display_name: name };
}

/** 验证原密码后原子更新密码哈希及会话版本 */
export async function changeMemberPassword(env: Env, user: AuthUser, input: ChangePasswordInput) {
  const db = createDb(env.DB);
  const currentHash = await findUserPasswordHash(db, user.id);
  if (!currentHash || !(await verifyPassword(input.current_password, currentHash))) {
    throw Errors.validation('当前原密码验证失败');
  }
  const newHash = await hashPassword(input.new_password);
  if (!(await updateUserPasswordHash(db, user.id, currentHash, newHash))) {
    throw Errors.conflict('密码已发生变化，请重新登录');
  }
  return { ok: true };
}
