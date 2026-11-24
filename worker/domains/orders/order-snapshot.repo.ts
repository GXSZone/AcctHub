import { evaluateOrderWarranty, type OrderWarrantyStatus } from '@shared/index';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type OrderRow,
  orders,
  products,
  productUpstreamBindings,
  upstreamSources,
} from '../../db/schema/index';
import type { Env } from '../../env';
import { readDeliveryPayload } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { buyerOrderNumber } from './orders.access';

export interface TicketOrderUpstreamInfo {
  fulfillment_source: string;
  upstream_source_id: number | null;
  upstream_source_name: string;
  upstream_order_no: string;
  upstream_cost_total: number;
  upstream_status: string;
  upstream_error: string;
  net_profit: number;
  has_bindings: boolean;
}

export interface TicketOrderSnapshot {
  order_no: string;
  product_id: number;
  product_title: string;
  spec_id?: string;
  spec_name: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  status: string;
  payment_method: string;
  channel: string;
  tenant_slug: string | null;
  contact_email: string;
  created_at: string;
  delivered_payload?: string;
  warranty: OrderWarrantyStatus;
  upstream_info?: TicketOrderUpstreamInfo | null;
}

/** 将 Drizzle OrderRow 转为面向买家的脱敏订单对象（剥离成本、货源 ID、查单密码等敏感列） */
export async function sanitizeOrderForUser(
  env: Env,
  row: OrderRow,
  effectiveWarranty?: {
    warranty_type?: unknown;
    warranty_days?: unknown;
    warranty_summary?: unknown;
  }
) {
  const warrantyType = effectiveWarranty?.warranty_type ?? row.warrantyType;
  const warranty = evaluateOrderWarranty(warrantyType === 'first_login' ? row.deliveredAt : row.createdAt, {
    warranty_type: effectiveWarranty?.warranty_type ?? row.warrantyType,
    warranty_days: effectiveWarranty?.warranty_days ?? row.warrantyDays,
    warranty_summary: effectiveWarranty?.warranty_summary ?? row.warrantySummary,
  });

  return {
    id: row.id,
    order_no: buyerOrderNumber(row),
    public_order_no: row.publicOrderNo,
    user_id: row.userId,
    agent_id: row.agentId,
    tenant_slug: row.tenantSlug,
    contact_email: row.contactEmail,
    product_id: row.productId,
    product_title: row.productTitle,
    spec_id: row.specId,
    spec_name: row.specName,
    quantity: row.quantity,
    unit_price: row.unitPrice,
    total_amount: row.totalAmount,
    discount_amount: row.discountAmount,
    coupon_code: row.couponCode,
    coupon_discount: row.couponDiscount,
    promo_used_amount: Number(row.promoUsedAmount || 0),
    commission_amount: row.commissionAmount,
    payment_method: row.paymentMethod,
    channel: row.channel,
    status: row.status,
    custom_inputs_json: row.customInputsJson,
    delivered_payload:
      row.status === 'delivered' ? await readDeliveryPayload(env, row.orderNo, row.deliveredPayload) : '',
    payment_intent_no: row.paymentIntentNo,
    payment_expires_at: row.paymentExpiresAt,
    created_at: row.createdAt,
    locked: false as const,
    warranty,
  };
}

/** 使用纯 Drizzle ORM 批量按订单号加载工单关联的订单与质保快照 */
async function loadOrderSnapshotsByOrderNos(
  env: Env,
  orderNos: string[],
  includePayload = false,
  includeUpstream = false
): Promise<Map<string, TicketOrderSnapshot>> {
  const result = new Map<string, TicketOrderSnapshot>();
  const unique = Array.from(new Set(orderNos.map((s) => s.trim()).filter(Boolean)));
  if (unique.length === 0) return result;

  const db = createDb(env.DB);
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const rows = await db
      .select({
        order: orders,
        prodWarrantyType: products.warrantyType,
        prodWarrantyDays: products.warrantyDays,
        prodWarrantySummary: products.warrantySummary,
        upstreamSourceName: upstreamSources.name,
      })
      .from(orders)
      .leftJoin(products, eq(products.id, orders.productId))
      .leftJoin(upstreamSources, eq(upstreamSources.id, orders.upstreamSourceId))
      .where(inArray(orders.orderNo, chunk));

    const productIds = Array.from(new Set(rows.map((r) => r.order.productId)));
    const bindingCountMap = new Map<number, number>();
    if (includeUpstream && productIds.length > 0) {
      const bindRows = await db
        .select({
          productId: productUpstreamBindings.productId,
          c: sql<number>`count(*)`,
        })
        .from(productUpstreamBindings)
        .where(
          and(
            inArray(productUpstreamBindings.productId, productIds),
            eq(productUpstreamBindings.isEnabled, 1)
          )
        )
        .groupBy(productUpstreamBindings.productId);
      for (const b of bindRows) bindingCountMap.set(Number(b.productId), Number(b.c));
    }

    for (const r of rows) {
      const o = r.order;
      const warranty = evaluateOrderWarranty(o.warrantyType === 'first_login' ? o.deliveredAt : o.createdAt, {
        warranty_type: o.warrantyType || r.prodWarrantyType || 'full_period',
        warranty_days: o.warrantyDays ?? r.prodWarrantyDays ?? 30,
        warranty_summary: o.warrantySummary || r.prodWarrantySummary || '',
      });
      const totalAmount = Number(o.totalAmount || 0);
      const commissionAmount = Number(o.commissionAmount || 0);
      const upCost = Number(o.upstreamCostTotal || 0);
      const upInfo: TicketOrderUpstreamInfo | null = includeUpstream
        ? {
            fulfillment_source: o.fulfillmentSource || 'local',
            upstream_source_id: o.upstreamSourceId ?? null,
            upstream_source_name: r.upstreamSourceName || '',
            upstream_order_no: o.upstreamOrderNo || '',
            upstream_cost_total: upCost,
            upstream_status: o.upstreamStatus || 'none',
            upstream_error: o.upstreamError || '',
            net_profit: Number((totalAmount - commissionAmount - upCost).toFixed(2)),
            has_bindings: (bindingCountMap.get(o.productId) ?? 0) > 0,
          }
        : null;

      result.set(o.orderNo, {
        order_no: o.orderNo,
        product_id: o.productId,
        product_title: o.productTitle,
        spec_id: o.specId || 'default',
        spec_name: o.specName || '',
        quantity: o.quantity,
        unit_price: o.unitPrice,
        total_amount: totalAmount,
        status: o.status,
        payment_method: o.paymentMethod,
        channel: o.channel,
        tenant_slug: o.tenantSlug ?? null,
        contact_email: o.contactEmail,
        created_at: o.createdAt,
        ...(includePayload && o.status === 'delivered'
          ? { delivered_payload: await readDeliveryPayload(env, o.orderNo, o.deliveredPayload || '') }
          : {}),
        ...(includeUpstream ? { upstream_info: upInfo } : {}),
        warranty,
      });
    }
  }

  return result;
}

/** 批量将订单质保快照挂载至工单列表 */
export async function attachOrderInfoToTickets<T extends Record<string, unknown>>(
  env: Env,
  tickets: T[],
  includePayload = false,
  includeUpstream = false
): Promise<Array<T & { order_info: TicketOrderSnapshot | null }>> {
  const orderNos = tickets.map((t) => String(t.order_no || '').trim()).filter(Boolean);
  const map = await loadOrderSnapshotsByOrderNos(env, orderNos, includePayload, includeUpstream);
  return tickets.map((t) => {
    const orderNo = String(t.order_no || '').trim();
    return {
      ...t,
      order_info: orderNo ? (map.get(orderNo) ?? null) : null,
    };
  });
}
