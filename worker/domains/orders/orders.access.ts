import type { OrderRow } from '../../db/schema/index';
import type { AuthUser } from '../../db/types';
import { verifyPassword } from '../../infra/crypto';

/** 仅在调用方已按站点筛选订单后使用。 */
export function isOrderOwner(order: OrderRow, user: AuthUser | null) {
  return Boolean(user && (order.userId === user.id || user.role === 'admin'));
}

/** 查单号授权和收银台会话授权共用同一订单归属边界。 */
export async function mayReadOrder(
  order: OrderRow,
  user: AuthUser | null,
  guest: { authorized: boolean; password?: string; checkoutSession?: boolean }
): Promise<boolean> {
  if (isOrderOwner(order, user)) return true;
  if (order.userId !== null || !guest.authorized || !order.publicOrderNo) return false;
  if (guest.checkoutSession || !order.queryPasswordHash) return true;
  return Boolean(guest.password && (await verifyPassword(guest.password, order.queryPasswordHash)));
}

export const lockedOrder = { locked: true } as const;

export function buyerOrderNumber(order: Pick<OrderRow, 'userId' | 'orderNo' | 'publicOrderNo'>): string {
  return order.userId === null && order.publicOrderNo ? order.publicOrderNo : order.orderNo;
}
