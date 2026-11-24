import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { commonModalsZhCN } from '../i18n/namespaces/common-modals/zh-CN';
import { hasDeliveredOrder, isOrderAwaitingDelivery } from '../queries/payment.queries';
import type { OrderRecord, PaymentIntentInfo } from '../types';
import { AsyncCashierModal } from './AsyncCashierModal';

const { payment } = vi.hoisted(() => ({ payment: vi.fn() }));
vi.mock('../queries/payment.queries', async (load) => ({
  ...(await load<typeof import('../queries/payment.queries')>()),
  usePaymentIntentQuery: payment,
}));
vi.mock('../i18n/namespaces/common-modals', () => ({
  useCommonModalsI18n: () => commonModalsZhCN,
}));

it('[B51] 收银台分别呈现已付款待交付、交付失败和可领取凭证的订单', () => {
  const paid = {
    intent_no: 'PAY-SANDBOX-FIXTURE',
    biz_type: 'order',
    provider: 'epay',
    currency: 'CNY',
    amount_cny: 30,
    pay_amount: 30,
    status: 'paid',
    fulfill_status: 'processing',
  } as PaymentIntentInfo;
  const render = (intent: PaymentIntentInfo, order: Partial<OrderRecord>) => {
    payment.mockReturnValue({ data: { intent, order } });
    return renderToStaticMarkup(<AsyncCashierModal intent={intent} onClose={vi.fn()} onPaid={vi.fn()} />);
  };
  const pending = { status: 'upstream_pending', delivered_payload: '' } as OrderRecord;
  expect(isOrderAwaitingDelivery(paid, pending)).toBe(true);
  expect(render(paid, pending)).toContain(commonModalsZhCN.cshAwaitingDeliveryBanner);
  expect(render(paid, pending)).not.toContain(commonModalsZhCN.cshTitlePaid);
  expect(render({ ...paid, fulfill_status: 'failed' }, pending)).toContain(
    commonModalsZhCN.cshDeliveryFailedBanner
  );
  for (const status of ['fulfillment_failed', 'refunded']) {
    const terminal = { ...pending, status };
    const intent = { ...paid, fulfill_status: 'done' } as const;
    expect(isOrderAwaitingDelivery(intent, terminal)).toBe(false);
    const markup = render(intent, terminal);
    expect(markup).toContain(commonModalsZhCN.cshDeliveryFailedBanner);
    expect(markup).not.toContain(commonModalsZhCN.cshPaidBanner);
  }

  const noCredential = { ...pending, status: 'delivered' };
  expect(hasDeliveredOrder(noCredential)).toBe(false);
  expect(hasDeliveredOrder({ ...noCredential, delivered_payload: 'fixture', locked: true })).toBe(false);
  const delivered = { ...noCredential, delivered_payload: 'fixture' };
  expect(hasDeliveredOrder(delivered)).toBe(true);
  expect(isOrderAwaitingDelivery(paid, delivered)).toBe(false);
  expect(render(paid, delivered)).toContain(commonModalsZhCN.cshTitlePaid);
});
