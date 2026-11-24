import { type Env, isSandboxEnabled } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { dispatchOpsNotification } from '../../infra/notify';
import { planAgentUpgrade } from '../agent/upgrade-plan.service';
import { postAgentUpgradePayment } from '../agent/upgrade-posting.repo';
import { fulfillPaidAsyncOrder } from './payment.fulfillment';
import { mayFulfillPayment } from './payment.provenance';
import {
  claimPaidIntentForFulfillRetryAtomic,
  findPaymentIntentByNo,
  listRecoverablePaidIntentsRepo,
  markIntentFulfillDoneRepo,
  markIntentFulfillFailedRepo,
  type PaymentFulfillLease,
  type PaymentIntentRow,
  renewPaymentFulfillLease,
} from './payment.repo';
import { completePaymentPosting, paymentPostingState, postPaidWalletRecharge } from './payment-posting.repo';

/** 统一分发已锁定 payment_intent 的后续业务入账/升级/交付（严格幂等可重入） */
export async function executeFulfillForPaidIntent(
  env: Env,
  intent: PaymentIntentRow,
  originUrl: string,
  options?: { allowProcessingRecovery?: boolean }
): Promise<void> {
  if (!mayFulfillPayment(env, intent)) throw Errors.forbidden('此支付单不允许在当前环境履约');
  const db = createDb(env.DB);
  const extra = safeJsonParse<Record<string, unknown>>(intent.payload_json, {});
  if ((await findPaymentIntentByNo(db, intent.intent_no))?.fulfill_status === 'done') return;
  if (!intent.fulfill_lease_token) throw Errors.conflict('支付履约未持有租约');
  const lease = {
    intentNo: intent.intent_no,
    token: intent.fulfill_lease_token,
  } satisfies PaymentFulfillLease;
  const renewLease = async () => {
    if (!(await renewPaymentFulfillLease(db, lease))) throw Errors.conflict('支付履约租约已失效');
  };
  await renewLease();

  if (intent.biz_type === 'order') {
    await fulfillPaidAsyncOrder(env, intent.biz_ref, extra, originUrl, {
      ...options,
      lease,
      renewLease,
    });
    return;
  }

  if (intent.biz_type === 'wallet_recharge') {
    if (!intent.user_id) {
      throw Errors.validation(`钱包充值支付单缺少 user_id（${intent.intent_no}）`);
    }
    if (!(await postPaidWalletRecharge(db, intent, lease))) throw Errors.conflict('钱包充值入账条件未满足');
    return;
  }

  if (intent.biz_type === 'agent_upgrade') {
    if (!intent.user_id) {
      throw Errors.validation(`代理升级支付单缺少 user_id（${intent.intent_no}）`);
    }
    const targetTierId = Number(extra.target_tier_id || 0);
    const upstreamOwnerId = Number(extra.upstream_owner_id || 0);
    const desiredSlug = typeof extra.desired_slug === 'string' ? extra.desired_slug : undefined;
    const desiredBrandName =
      typeof extra.desired_brand_name === 'string' ? extra.desired_brand_name : undefined;
    const amount = Number(intent.amount_cny);

    const plan = await planAgentUpgrade(env, {
      userId: intent.user_id,
      amount,
      ownerId: upstreamOwnerId,
      tierId: targetTierId || undefined,
      desiredSlug,
      desiredBrandName,
    });
    await renewLease();
    const state = paymentPostingState(intent, lease);
    const posted = await postAgentUpgradePayment(db, {
      refNo: intent.intent_no,
      plan,
      amount,
      tierName: plan.tier?.name || '认证代理',
      paymentMethod: intent.provider,
      guard: exists(db.select({ id: paymentIntents.id }).from(paymentIntents).where(state)),
      finish: (owned) => completePaymentPosting(db, state, owned),
    });
    if (posted.amount === null) throw Errors.conflict('代理升级入账条件未满足');
  }
}

/** 定时补偿扫描：自动拉起已付款但未完成履约/入账的异常支付单（修复 L2 漏单） */
export async function recoverUnfulfilledPaidIntents(
  env: Env,
  originUrl = ''
): Promise<{ recovered: number; failed: number }> {
  const db = createDb(env.DB);
  const allowSandbox = isSandboxEnabled(env);
  const candidates = await listRecoverablePaidIntentsRepo(db, 30, allowSandbox);
  let recovered = 0;
  let failed = 0;

  for (const item of candidates) {
    const claimed = await claimPaidIntentForFulfillRetryAtomic(db, item.intent_no, allowSandbox);
    if (!claimed) continue;
    try {
      await executeFulfillForPaidIntent(env, claimed, originUrl, { allowProcessingRecovery: true });
      if (await finalizeFulfilledPayment(db, claimed)) recovered += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const marked = await markIntentFulfillFailedRepo(
        db,
        claimed.intent_no,
        claimed.fulfill_lease_token,
        msg
      );
      if (!marked) continue;
      failed += 1;
      void dispatchOpsNotification(env, 'upstream_alert', '【L2补偿重试失败】支付单履约异常', [
        `支付单号：${claimed.intent_no}（${claimed.biz_type} / ${claimed.biz_ref}）`,
        `错误信息：${msg}`,
      ]);
    }
  }

  return { recovered, failed };
}

/** 单笔按需补偿已付款但未履约完成的支付单（供 S4 单笔 /check 接口调用，不扫描全站） */
export async function recoverSinglePaidIntent(env: Env, intentNo: string, originUrl = ''): Promise<boolean> {
  const db = createDb(env.DB);
  const claimed = await claimPaidIntentForFulfillRetryAtomic(db, intentNo, isSandboxEnabled(env));
  if (!claimed) return false;
  try {
    await executeFulfillForPaidIntent(env, claimed, originUrl, { allowProcessingRecovery: true });
    return await finalizeFulfilledPayment(db, claimed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const marked = await markIntentFulfillFailedRepo(db, claimed.intent_no, claimed.fulfill_lease_token, msg);
    if (!marked) return false;
    void dispatchOpsNotification(env, 'upstream_alert', '【L2按需补偿失败】支付单履约异常', [
      `支付单号：${claimed.intent_no}（${claimed.biz_type} / ${claimed.biz_ref}）`,
      `错误信息：${msg}`,
    ]);
    return false;
  }
}

export async function finalizeFulfilledPayment(db: ReturnType<typeof createDb>, intent: PaymentIntentRow) {
  if (await markIntentFulfillDoneRepo(db, intent.intent_no, intent.fulfill_lease_token)) return true;
  return (await findPaymentIntentByNo(db, intent.intent_no))?.fulfill_status === 'done';
}

import { exists } from 'drizzle-orm';
import { paymentIntents } from '../../db/schema/index';
