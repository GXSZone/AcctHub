import type { Env } from '../../env';
import { generateBizNo } from '../../infra/crypto';
import { createDb } from '../../infra/db';
import { processOrderRefund } from '../refund/refund.service';
import {
  hasCompleteUpstreamUnits,
  isSupplierProcurementEnabled,
  placeUpstreamOrder,
} from './upstream.order.adapter';
import {
  findBindingWithSourceByIdRepo,
  insertUpstreamOrderRepo,
  updateUpstreamOrderRepo,
} from './upstream.orders.repo';
import { completeRestockPurchaseRepo } from './upstream.recovery.repo';

/** 预拉囤货模式：从上游批量采购卡密并直接入库本地 product_cards */
export async function pullUpstreamCardsToLocalStock(
  env: Env,
  params: { bindingId: number; quantity: number; originUrl: string }
): Promise<{ imported: number; upstreamOrderNo: string; cost: number; cards: string[]; status: string }> {
  const qty = Math.min(50, Math.max(1, Math.floor(params.quantity)));
  const db = createDb(env.DB);
  const found = await findBindingWithSourceByIdRepo(db, params.bindingId);
  if (!found) throw new Error('上游 SKU 路由绑定不存在');

  const { binding: b, source } = found;
  if (source.adapter_type === 'mock_sandbox') throw new Error('模拟货源不能预拉可售库存');
  if (!isSupplierProcurementEnabled(env, source)) throw new Error('该上游货源尚未启用新采购');
  const batchRef = generateBizNo('PULL');
  const upOrderId = await insertUpstreamOrderRepo(db, {
    localOrderNo: '',
    attemptNo: 1,
    idempotencyOutTradeNo: batchRef,
    sourceId: source.id,
    sourceName: source.name,
    bindingId: b.id,
    productId: b.productId,
    specId: b.specId,
    upstreamItemId: b.upstreamItemId,
    upstreamSpecId: b.upstreamSpecId || '',
    quantity: qty,
    upstreamCost: Number((Number(b.cachedCost || 0) * qty).toFixed(2)),
    status: 'pending',
    purpose: 'restock_pull',
  });

  const res = await placeUpstreamOrder(env, source, {
    upstreamItemId: b.upstreamItemId,
    upstreamSpecId: b.upstreamSpecId || undefined,
    quantity: qty,
    outTradeNo: batchRef,
    webhookUrl: `${params.originUrl.replace(/\/$/, '')}/api/webhooks/upstream/${source.id}`,
    unitCostHint: Number(b.cachedCost || 0),
  });

  if (res.status !== 'succeeded' || !hasCompleteUpstreamUnits(res.cards, qty)) {
    await updateUpstreamOrderRepo(env, upOrderId, {
      status: res.status === 'succeeded' ? 'pending' : res.status,
      upstreamOrderNo: res.upstreamOrderNo,
      errorMessage: res.errorMessage,
      rawResponseJson: JSON.stringify(res.rawResponse),
    });
    throw new Error(res.errorMessage || `预拉囤货未立即出卡（状态：${res.status}）`);
  }

  const completed = await completeRestockPurchaseRepo(env, {
    purchaseId: upOrderId,
    productId: b.productId,
    specId: b.specId,
    cards: res.cards,
    upstreamOrderNo: res.upstreamOrderNo,
    actualCost: res.actualCost,
    rawResponseJson: JSON.stringify(res.rawResponse),
  });
  if (completed.status === 'orphan') throw new Error(completed.note || '采购单已停止入库，请检查采购台账');

  return {
    imported: completed.imported,
    upstreamOrderNo: res.upstreamOrderNo,
    cost: res.actualCost,
    cards: res.cards,
    status: 'succeeded',
  };
}

export { procureAfterSaleReplacementForTicket } from './upstream.replacement.service';

/** 异常单钱包动作与标准退款共用同一事件。 */
export async function refundFailedOrderToUserBalance(
  env: Env,
  orderNo: string,
  walletCompensation = false
): Promise<{ refundedToWallet: boolean; amount: number }> {
  const result = await processOrderRefund(
    env,
    orderNo,
    { route: walletCompensation ? 'wallet_compensation' : 'wallet' },
    true
  );
  return { refundedToWallet: result.refund.amountCny > 0, amount: result.refund.amountCny };
}
