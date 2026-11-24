import type { CreateOrderInput } from '@shared/index';
import type { OrderRow } from '../../db/schema/index';
import type { AuthUser } from '../../db/types';
import { type Env, isSandboxEnabled, type TenantContext } from '../../env';
import { sha256Hex, timingSafeEqual, verifyPassword } from '../../infra/crypto';
import { type AppDatabase, createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { isSiteMailAutoDeliveryReady } from '../../infra/mail';
import { verifyTurnstileIfConfigured } from '../../infra/security';
import { getAuthUser } from '../auth/auth.service';
import { isAsyncPaymentProvider } from '../payment/payment.gateway';
import { mayFulfillPayment } from '../payment/payment.provenance';
import { findPaymentIntentByNo } from '../payment/payment.repo';
import { isTenantPaymentPluginEnabled } from '../payment/tenant-payment.service';
import { sanitizeOrderForUser } from './order-snapshot.repo';
import { isOrderOwner, mayReadOrder } from './orders.access';
import { presentCashierIntent } from './orders.promo';
import { findIdempotentOrder, isPaymentPluginEnabled } from './orders.repo';

export async function assertRetailPaymentMethodAvailable(
  env: Env,
  db: AppDatabase,
  paymentMethod: string,
  tenant?: TenantContext,
  productOwnerAgentId = 0
): Promise<{ paymentOwnerAgentId: number; settlementMode: 'platform_collect' | 'tenant_direct_collect' }> {
  // 反洗钱与反二清硬铁律：分站私有商品严禁进入主站资金账户、站内余额或平台收银台，必须强制走该分站自有收款账户直收
  if (productOwnerAgentId > 0) {
    if (paymentMethod === 'balance' || paymentMethod === 'demo_instant') {
      throw Errors.forbidden('分站私有商品仅支持通过该分站自有收款账户直收，严禁使用站内余额或主站演示通道');
    }
    if (!isAsyncPaymentProvider(paymentMethod)) {
      throw Errors.forbidden('此支付通道暂不可用，请切换该分站已启用的自有收款通道');
    }
    if (
      !tenant?.isSubAgent ||
      tenant.agentId !== productOwnerAgentId ||
      !tenant.capabilities?.allow_own_payment ||
      !(await isTenantPaymentPluginEnabled(db, productOwnerAgentId, paymentMethod))
    ) {
      throw Errors.forbidden('该私有商品必须通过分站自有收款账户支付，当前分站尚未启用此自有收款通道');
    }
    return { paymentOwnerAgentId: productOwnerAgentId, settlementMode: 'tenant_direct_collect' };
  }

  if (paymentMethod === 'balance') {
    return { paymentOwnerAgentId: 0, settlementMode: 'platform_collect' };
  }
  if (paymentMethod === 'demo_instant') {
    if (!isSandboxEnabled(env)) throw Errors.sandboxDisabled('生产环境已关闭内置演示收银台');
    if (!(await isPaymentPluginEnabled(db, paymentMethod))) {
      throw Errors.validation(`支付通道「${paymentMethod}」不存在或已停用，请切换其他可用支付方式`);
    }
    return { paymentOwnerAgentId: 0, settlementMode: 'platform_collect' };
  }
  // 资金合规双轨硬隔离：主站商品（productOwnerAgentId === 0）强制走主站收款通道与平台自动分润，绝不允许被分站自有收款通道截流
  if (!(await isPaymentPluginEnabled(db, paymentMethod))) {
    throw Errors.validation(`支付通道「${paymentMethod}」不存在或已停用，请切换其他可用支付方式`);
  }
  return { paymentOwnerAgentId: 0, settlementMode: 'platform_collect' };
}

export async function assertGuestCheckoutAllowed(
  env: Env,
  req: Request,
  currentSiteAgentId: number,
  turnstileToken?: string
) {
  if (!(await isSiteMailAutoDeliveryReady(env, currentSiteAgentId))) {
    throw Errors.unauthorized(
      '当前站点暂未开启自动发信邮箱，游客暂不支持直接下单，请先登录账号购买并在「我的订单」查看凭证'
    );
  }
  const tsCheck = await verifyTurnstileIfConfigured(req, env, 'order_create', turnstileToken);
  if (!tsCheck.ok) throw Errors.forbidden(tsCheck.error);
}

export async function prepareCheckoutInput(body: CreateOrderInput, user: AuthUser | null) {
  const email = body.contact_email.toLowerCase();
  const qty = body.quantity;
  const idemKey = body.idempotency_key ?? '';
  const queryPassword = body.query_password ?? '';
  const paymentMethod = body.payment_method;
  if (idemKey && !user && !body.checkout_secret) throw Errors.validation('游客结账重试缺少会话凭据');
  const checkoutSecretHash = body.checkout_secret
    ? await sha256Hex(`checkout-secret:${body.checkout_secret}`)
    : null;
  const checkoutPayloadHash = idemKey
    ? await sha256Hex(
        JSON.stringify([
          body.product_id,
          body.spec_id ?? null,
          qty,
          email,
          paymentMethod,
          body.coupon_code?.toUpperCase() || '',
          Boolean(body.use_promo_balance),
          Object.entries(body.custom_inputs ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ])
      )
    : null;
  return { email, qty, idemKey, queryPassword, paymentMethod, checkoutSecretHash, checkoutPayloadHash };
}

export async function recoverCheckout(
  env: Env,
  db: ReturnType<typeof createDb>,
  order: OrderRow,
  user: AuthUser | null,
  proofHash: string | null,
  siteId: number,
  originalInput?: { payloadHash: string | null; password: string }
) {
  const guestSession = Boolean(
    proofHash && order.checkoutSecretHash && timingSafeEqual(proofHash, order.checkoutSecretHash)
  );
  const permitted =
    order.userId === null
      ? guestSession && (await mayReadOrder(order, null, { authorized: true, checkoutSession: true }))
      : isOrderOwner(order, user) && order.userId === user?.id;
  if (!permitted) throw Errors.conflict('无法使用当前会话恢复这笔结账，请从原下单会话重试');
  if (originalInput) {
    const { payloadHash, password } = originalInput;
    if (
      order.checkoutPayloadHash !== payloadHash ||
      !payloadHash ||
      (order.queryPasswordHash
        ? !password || !(await verifyPassword(password, order.queryPasswordHash))
        : Boolean(password))
    ) {
      throw Errors.conflict('本次结账参数已变化，请使用原下单信息重试');
    }
  }
  if (order.status === 'processing') {
    throw Errors.conflict('订单正在创建，请稍候重试同一笔结账');
  }
  const result = {
    order: await sanitizeOrderForUser(env, order),
    balance: user?.balance,
    idempotent_replay: true,
  };
  if (!order.paymentIntentNo || !['pending_payment', 'paid', 'upstream_pending'].includes(order.status)) {
    return result;
  }
  const intent = await findPaymentIntentByNo(db, order.paymentIntentNo);
  if (
    intent?.biz_type !== 'order' ||
    intent.biz_ref !== order.orderNo ||
    intent.site_agent_id !== siteId ||
    intent.user_id !== order.userId ||
    !mayFulfillPayment(env, intent)
  )
    return result;
  const extra = safeJsonParse<Record<string, unknown>>(intent.payload_json, {});
  const viewToken = typeof extra.view_token === 'string' ? extra.view_token : undefined;
  return {
    ...result,
    requires_payment: intent.status === 'pending',
    payment_intent: presentCashierIntent(env, intent, viewToken),
  };
}

export async function readCheckout(
  env: Env,
  req: Request,
  tenant: TenantContext,
  key: string,
  proof: string
) {
  const db = createDb(env.DB);
  const siteId = tenant.isSubAgent ? tenant.agentId : null;
  const user = await getAuthUser(req, env, tenant);
  const order = await findIdempotentOrder(db, key, '', siteId);
  if (!order) return { found: false as const };
  const proofHash = await sha256Hex(`checkout-secret:${proof}`);
  // 无效的会话凭据与未找到订单使用相同的响应。
  if (
    !order.checkoutSecretHash ||
    !timingSafeEqual(proofHash, order.checkoutSecretHash) ||
    (order.userId !== null && order.userId !== user?.id)
  )
    return { found: false as const };
  return { found: true as const, ...(await recoverCheckout(env, db, order, user, proofHash, siteId ?? 0)) };
}
