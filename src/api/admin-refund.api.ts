import { apiRequest } from './http';

export type RefundMode = 'manual' | 'automatic';
export type RefundRoute = 'original_payment' | 'wallet' | 'wallet_compensation';
export type RefundStatus =
  | 'ready'
  | 'manual_required'
  | 'submitting'
  | 'pending'
  | 'unknown'
  | 'failed'
  | 'succeeded';
export interface RefundEvent {
  mode: RefundMode;
  route: RefundRoute;
  status: RefundStatus;
  provider: string;
  originalPayment: string;
  currency: string;
  amount: number;
  amountCny: number;
  proofReference: string | null;
}
export interface RefundView {
  refund: RefundEvent | null;
  mode: RefundMode;
  route: RefundRoute;
}
export interface RefundCommand {
  action: 'request' | 'query' | 'confirm';
  route?: RefundRoute;
  evidence?: { originalPayment: string; amount: number; currency: string; reference: string };
}

export const adminRefundApi = {
  getRefundPolicy: () => apiRequest<{ mode: RefundMode }>('/api/admin/refund-policy', {}, { admin: true }),

  saveRefundPolicy: (mode: RefundMode) =>
    apiRequest<{ mode: RefundMode }>(
      '/api/admin/refund-policy',
      { method: 'PUT', body: JSON.stringify({ mode }) },
      { admin: true }
    ),

  getOrderRefund: (orderNo: string) =>
    apiRequest<RefundView>(`/api/admin/orders/${encodeURIComponent(orderNo)}/refund`, {}, { admin: true }),

  refundOrder: (orderNo: string, command: RefundCommand) =>
    apiRequest<{ ok: boolean; order_no: string; refund: RefundEvent }>(
      `/api/admin/orders/${encodeURIComponent(orderNo)}/refund`,
      { method: 'POST', body: JSON.stringify(command) },
      { admin: true }
    ),
};
