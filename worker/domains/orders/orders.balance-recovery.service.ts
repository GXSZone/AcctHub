import type { OrderRow } from '../../db/schema/index';
import type { ProductSpec } from '../../db/types';
import type { Env } from '../../env';
import {
  INVENTORY_CREDENTIAL_SCOPE,
  readStoredCredential,
  sealDeliveryPayload,
} from '../../infra/credential-storage';
import { type AppDatabase, createDb } from '../../infra/db';
import { safeJsonParse } from '../../infra/http';
import { settleAffiliateRewardForOrder } from '../account/affiliate.service';
import { settleRecursiveOrderProfits } from '../agent/settlement.service';
import { buildLocalOrderDelivery } from '../fulfillment/fulfillment.service';
import { findClaimedCardsByOrderNoRepo } from '../payment/payment.fulfill.repo';
import { findProductById } from '../payment/payment.order.repo';
import { findBlockingUpstreamAttemptRepo } from '../upstream/upstream.orders.repo';
import { pollSingleUpstreamOrder } from '../upstream/upstream.poll.service';
import {
  expiredBalanceOrderGuard,
  listExpiredBalanceOrders,
  postBalanceOrderStock,
  readBalanceOrderStock,
} from './orders.balance-recovery.repo';
import { finalizeProcessingOrderCas, findActiveAgentByUserIdForOrder } from './orders.repo';
import { requestImmediateOrderAbort } from './orders.wallet.repo';

async function recoverBalanceOrder(env: Env, db: AppDatabase, order: OrderRow) {
  const { orderNo, quantity, productId, contactEmail } = order;
  const guard = expiredBalanceOrderGuard(db, orderNo);
  const upstream = await findBlockingUpstreamAttemptRepo(db, orderNo);
  if (upstream) {
    const result = await finalizeProcessingOrderCas(
      db,
      orderNo,
      {
        status: 'upstream_pending',
        fulfillmentSource: 'upstream',
        upstreamSourceId: upstream.sourceId,
        upstreamOrderNo: upstream.upstreamOrderNo,
        upstreamCostTotal: upstream.upstreamCost,
        upstreamStatus: 'pending',
        upstreamError: upstream.errorMessage,
      },
      { guard, clearStock: true }
    );
    // 继续核对原采购号，避免再采购或在状态不明时退款。
    if (result.updated && upstream.status === 'succeeded') await pollSingleUpstreamOrder(env, upstream.id);
    return;
  }

  const [checkpoint, cards, product] = await Promise.all([
    readBalanceOrderStock(db, orderNo),
    findClaimedCardsByOrderNoRepo(db, orderNo),
    findProductById(db, productId),
  ]);
  const channel = order.channel === 'reseller_api' ? 'reseller_api' : 'web';
  const delivery = { orderNo, quantity, productId, contactEmail, channel } as const;
  let lines: string[];
  if (checkpoint && checkpoint.mode !== 'cards') {
    lines = buildLocalOrderDelivery(delivery, checkpoint.mode, checkpoint.endSeat);
  } else if (cards.length === quantity) {
    lines = await Promise.all(
      cards.map((card) => readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE))
    );
    if (
      !checkpoint &&
      product &&
      (await postBalanceOrderStock(db, orderNo, {
        productId,
        quantity,
        mode: 'cards',
        guard,
      })) === null
    )
      return;
  } else {
    if (!checkpoint) await requestImmediateOrderAbort(db, orderNo, undefined, guard);
    return;
  }

  let commissionAmount = 0;
  if (order.agentId && product) {
    const specs = safeJsonParse<ProductSpec[]>(product.specsJson, []);
    const spec = specs.find((item) => item.id === order.specId);
    const buyerAgent =
      channel === 'web' && order.userId ? await findActiveAgentByUserIdForOrder(db, order.userId) : null;
    const wholesaleAgent = buyerAgent?.parentAgentId === order.agentId ? buyerAgent : null;
    const posted = await settleRecursiveOrderProfits({
      env,
      orderNo,
      sellingAgentId: wholesaleAgent?.id ?? order.agentId,
      baseMainTotal: Number(spec?.price ?? product.basePrice) * quantity,
      totalAmount: order.totalAmount,
      mode: channel === 'reseller_api' || wholesaleAgent ? 'b2b_api' : 'retail',
      guard,
    });
    commissionAmount = posted.totalSettledToChain;
  }
  const result = await finalizeProcessingOrderCas(
    db,
    orderNo,
    {
      status: channel === 'web' && product?.deliveryType === 'manual' ? 'paid' : 'delivered',
      deliveredPayload: await sealDeliveryPayload(env, orderNo, lines.join('\n')),
      commissionAmount,
    },
    { guard, clearStock: true }
  );
  if (result.updated) await settleAffiliateRewardForOrder(env, orderNo);
}

/** 补偿超时的余额订单，先核实已有的采购和库存，再推进原订单。 */
export async function recoverExpiredBalanceOrders(env: Env) {
  const db = createDb(env.DB);
  const expired = await listExpiredBalanceOrders(db);
  for (const { order } of expired) {
    try {
      await recoverBalanceOrder(env, db, order);
    } catch {
      console.warn('余额订单恢复未成功，下一轮将重试', { orderNo: order.orderNo });
    }
  }
}
