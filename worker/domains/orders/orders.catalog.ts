import type { ProductSpec } from '../../db/types';
import type { AppDatabase } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { safeJsonParse } from '../../infra/http';
import { findActiveProductForOrder, findAgentOrderOverride } from './orders.repo';

export async function loadRetailOrderProduct(
  db: AppDatabase,
  siteId: number | null,
  input: { product_id: number; spec_id?: string; custom_inputs?: Record<string, string> }
) {
  const product = await findActiveProductForOrder(db, input.product_id);
  if (!product) throw Errors.notFound('商品不存在或已下架');

  // 严格租户隔离：分站私有商品仅允许在归属分站域名下售卖，主站与他站一律不可见不可买
  if (product.ownerAgentId > 0 && product.ownerAgentId !== (siteId ?? 0)) {
    throw Errors.notFound('商品不存在或已下架');
  }

  let effectiveProductTitle = product.title;
  if (siteId) {
    const override = await findAgentOrderOverride(db, siteId, input.product_id);
    if (override?.isListed === 0) throw Errors.notFound('该商品在当前店铺已下架');
    if (override?.customTitle?.trim()) effectiveProductTitle = override.customTitle.trim();
  }

  const specs = safeJsonParse<ProductSpec[]>(product.specsJson || '[]', []);
  const selectedSpec = specs.find((spec) => spec.id === input.spec_id) ??
    specs[0] ?? { id: 'default', name: '标准版', price: Number(product.basePrice) };

  const fields = safeJsonParse<Array<{ key: string; label: string; required?: boolean }>>(
    product.customFieldsJson || '[]',
    []
  );
  for (const field of fields) {
    if (field.required && !input.custom_inputs?.[field.key]?.trim()) {
      throw Errors.validation(`请填写必填信息：${field.label}`);
    }
  }
  return { product, specs, selectedSpec, effectiveProductTitle };
}
