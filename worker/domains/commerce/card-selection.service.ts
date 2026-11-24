import type { SelectableCardPublicDto } from '@shared/contracts/extensions.contract';
import { roundCurrency } from '@shared/domain/money';
import { and, asc, eq, ne, type SQL } from 'drizzle-orm';
import { type ProductRow, productCards } from '../../db/schema/index';
import type { Env, TenantContext } from '../../env';
import { INVENTORY_CREDENTIAL_SCOPE, readStoredCredential } from '../../infra/credential-storage';
import { type AppDatabase, createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { claimSingleCardAtomic, incrementProductSalesCount } from '../fulfillment/fulfillment.repo';
import { findActiveProductByIdOrSlug } from '../storefront/storefront.repo';

/** 前台查询支持卡密预选商品的公开标签列表（严禁返回 card_content 密文/明文） */
export async function listSelectableCardsPublic(
  env: Env,
  tenant: TenantContext,
  idOrSlug: string,
  specId = ''
): Promise<{ allow_card_selection: boolean; default_select_fee: number; cards: SelectableCardPublicDto[] }> {
  const db = createDb(env.DB);
  const ownerAgentId = tenant.isSubAgent && tenant.agentId ? tenant.agentId : 0;
  const includePrivate = Boolean(ownerAgentId > 0 && tenant.capabilities?.allow_private_products);
  const prod = await findActiveProductByIdOrSlug(db, idOrSlug, ownerAgentId, includePrivate);
  if (!prod || Number(prod.allowCardSelection || 0) !== 1) {
    return { allow_card_selection: false, default_select_fee: 0, cards: [] };
  }

  const conds = [
    eq(productCards.productId, prod.id),
    eq(productCards.ownerAgentId, prod.ownerAgentId),
    eq(productCards.status, 'available'),
    ne(productCards.publicLabel, ''),
  ];
  if (specId.trim()) {
    conds.push(eq(productCards.specId, specId.trim()));
  }

  const rows = await db
    .select({
      id: productCards.id,
      publicLabel: productCards.publicLabel,
      selectFee: productCards.selectFee,
    })
    .from(productCards)
    .where(and(...conds))
    .orderBy(asc(productCards.id))
    .limit(100);

  const defaultFee = Math.max(0, roundCurrency(Number(prod.cardSelectFee || 0)));
  return {
    allow_card_selection: true,
    default_select_fee: defaultFee,
    cards: rows.map((r) => ({
      id: r.id,
      public_label: r.publicLabel,
      select_fee: Number(r.selectFee) > 0 ? roundCurrency(Number(r.selectFee)) : defaultFee,
    })),
  };
}

/** 下单前校验用户预选的卡密是否合法可用，并返回选号加价金额 */
export async function validateSelectedCardForCheckout(
  db: AppDatabase,
  params: {
    product: ProductRow;
    specId: string;
    qty: number;
    selectedCardId?: number;
  }
): Promise<{ selectedCardId: number | null; selectFee: number; publicLabel: string }> {
  if (!params.selectedCardId) {
    return { selectedCardId: null, selectFee: 0, publicLabel: '' };
  }
  if (Number(params.product.allowCardSelection || 0) !== 1) {
    throw Errors.validation('该商品未开启卡密预选功能');
  }
  if (params.qty !== 1) {
    throw Errors.validation('指定预选卡密每次仅支持购买 1 件');
  }
  const [card] = await db
    .select({
      id: productCards.id,
      productId: productCards.productId,
      ownerAgentId: productCards.ownerAgentId,
      specId: productCards.specId,
      status: productCards.status,
      publicLabel: productCards.publicLabel,
      selectFee: productCards.selectFee,
    })
    .from(productCards)
    .where(eq(productCards.id, params.selectedCardId))
    .limit(1);

  if (
    !card ||
    card.productId !== params.product.id ||
    card.ownerAgentId !== params.product.ownerAgentId ||
    card.specId !== params.specId ||
    card.status !== 'available'
  ) {
    throw Errors.conflict('您预选的卡密刚刚已被其他买家拍下或已失效，请重新挑选');
  }

  const defaultFee = Math.max(0, roundCurrency(Number(params.product.cardSelectFee || 0)));
  const fee = Number(card.selectFee) > 0 ? roundCurrency(Number(card.selectFee)) : defaultFee;
  return {
    selectedCardId: card.id,
    selectFee: fee,
    publicLabel: card.publicLabel,
  };
}

/** CAS 原子锁定并交付买家预选的特定卡密 */
export async function fulfillSelectedCardAtomically(
  env: Env,
  db: AppDatabase,
  params: {
    orderNo: string;
    productId: number;
    selectedCardId: number;
    guard?: SQL;
  }
) {
  const [card] = await db
    .select({
      id: productCards.id,
      cardContent: productCards.cardContent,
      isLoop: productCards.isLoop,
      publicLabel: productCards.publicLabel,
    })
    .from(productCards)
    .where(and(eq(productCards.id, params.selectedCardId), eq(productCards.status, 'available')))
    .limit(1);

  if (!card) {
    return {
      ok: false as const,
      conflictError: '您预选的卡密刚刚已被其他买家抢先拍下，已自动取消扣款',
      deliveredLines: [] as string[],
      orderStatus: 'fulfillment_failed' as const,
      fulfillmentSource: 'local' as const,
      upstreamSourceId: null,
      upstreamOrderNo: '',
      upstreamCostTotal: 0,
      upstreamStatus: 'none' as const,
      upstreamError: 'selected card unavailable',
    };
  }

  const cred = await readStoredCredential(env, card.cardContent, INVENTORY_CREDENTIAL_SCOPE);
  if (Number(card.isLoop || 0) !== 1) {
    const claimed = await claimSingleCardAtomic(db, card.id, params.orderNo, params.guard);
    if (!claimed) {
      return {
        ok: false as const,
        conflictError: '您预选的卡密刚刚已被其他买家抢先拍下，已自动取消扣款',
        deliveredLines: [] as string[],
        orderStatus: 'fulfillment_failed' as const,
        fulfillmentSource: 'local' as const,
        upstreamSourceId: null,
        upstreamOrderNo: '',
        upstreamCostTotal: 0,
        upstreamStatus: 'none' as const,
        upstreamError: 'selected card race lost',
      };
    }
  }

  await incrementProductSalesCount(db, params.productId, 1, params.guard);
  return {
    ok: true as const,
    deliveredLines: [card.publicLabel ? `[${card.publicLabel}] ${cred}` : cred],
    orderStatus: 'delivered' as const,
    fulfillmentSource: 'local' as const,
    upstreamSourceId: null,
    upstreamOrderNo: '',
    upstreamCostTotal: 0,
    upstreamStatus: 'none' as const,
    upstreamError: '',
  };
}
