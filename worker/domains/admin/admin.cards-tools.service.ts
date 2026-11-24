import { and, desc, eq, inArray } from 'drizzle-orm';
import { orders, productCards, products } from '../../db/schema/index';
import type { Env } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';

/** 按卡密明文片段反查归属商品与订单（售后防骗核心工具） */
export async function lookupAdminCardsByContent(env: Env, query: string) {
  const needle = query.trim().toLowerCase();
  if (needle.length < 3) throw Errors.validation('请至少输入 3 个字符进行卡密反查');
  const db = createDb(env.DB);
  const [cardRows, prodRows] = await Promise.all([
    db.select().from(productCards).orderBy(desc(productCards.id)).limit(1000),
    db.select({ id: products.id, title: products.title }).from(products),
  ]);
  const prodMap = new Map(prodRows.map((p) => [p.id, p.title]));
  const matches: Array<{
    card_id: number;
    product_id: number;
    product_title: string;
    spec_id: string;
    status: string;
    is_loop: number;
    order_no: string | null;
    sold_at: string | null;
    card_content: string;
    contact_email?: string;
    buyer_ip?: string;
    order_status?: string;
  }> = [];

  const matchedOrderNos = new Set<string>();
  for (const row of cardRows) {
    const plain = await readStoredCredential(env, row.cardContent, INVENTORY_CREDENTIAL_SCOPE);
    if (plain.toLowerCase().includes(needle)) {
      if (row.orderNo) matchedOrderNos.add(row.orderNo);
      matches.push({
        card_id: row.id,
        product_id: row.productId,
        product_title: prodMap.get(row.productId) || `#${row.productId}`,
        spec_id: row.specId,
        status: row.status,
        is_loop: Number(row.isLoop || 0),
        order_no: row.orderNo,
        sold_at: row.soldAt,
        card_content: plain,
      });
      if (matches.length >= 30) break;
    }
  }

  if (matchedOrderNos.size > 0) {
    const orderRows = await db
      .select({
        orderNo: orders.orderNo,
        contactEmail: orders.contactEmail,
        buyerIp: orders.buyerIp,
        status: orders.status,
      })
      .from(orders)
      .where(inArray(orders.orderNo, [...matchedOrderNos]));
    const orderMap = new Map(orderRows.map((o) => [o.orderNo, o]));
    for (const m of matches) {
      if (m.order_no && orderMap.has(m.order_no)) {
        const o = orderMap.get(m.order_no);
        m.contact_email = o?.contactEmail;
        m.buyer_ip = o?.buyerIp || '';
        m.order_status = o?.status;
      }
    }
  }

  return { matches };
}

/** 一键导出商品未售可用卡密纯文本 TXT */
export async function exportAvailableProductCardsTxt(env: Env, productId: number, specId?: string) {
  const db = createDb(env.DB);
  const conds = [eq(productCards.productId, productId), eq(productCards.status, 'available')];
  if (specId?.trim()) conds.push(eq(productCards.specId, specId.trim()));
  const rows = await db
    .select({ cardContent: productCards.cardContent })
    .from(productCards)
    .where(and(...conds))
    .orderBy(desc(productCards.id))
    .limit(5000);
  const lines = await Promise.all(
    rows.map((r) => readStoredCredential(env, r.cardContent, INVENTORY_CREDENTIAL_SCOPE))
  );
  return {
    filename: `product-${productId}${specId ? `-${specId}` : ''}-available-cards.txt`,
    content: lines.join('\n'),
    count: lines.length,
  };
}
