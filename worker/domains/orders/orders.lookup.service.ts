import type { LookupOrdersInput } from '@shared/index';
import type { Env, TenantContext } from '../../env';
import { createDb } from '../../infra/db';
import { Errors } from '../../infra/errors';
import { verifyTurnstileIfConfigured } from '../../infra/security';
import { getAuthUser } from '../auth/auth.service';
import { sanitizeOrderForUser } from './order-snapshot.repo';
import { lockedOrder, mayReadOrder } from './orders.access';
import { listUserOrdersOnSite, lookupOrdersOnSite, type OrderWithProductWarranty } from './orders.repo';

function presentOrder(
  env: Env,
  { order, prodWarrantyType, prodWarrantyDays, prodWarrantySummary }: OrderWithProductWarranty
) {
  return sanitizeOrderForUser(env, order, {
    warranty_type: order.warrantyType || prodWarrantyType || 'full_period',
    warranty_days: order.warrantyDays ?? prodWarrantyDays ?? 30,
    warranty_summary: order.warrantySummary || prodWarrantySummary || '',
  });
}

export async function listMemberOrdersPage(env: Env, userId: number, siteId: number | null, cursor?: number) {
  const rows = await listUserOrdersOnSite(createDb(env.DB), userId, siteId, cursor);
  const page = rows.slice(0, 50);
  return {
    orders: await Promise.all(page.map((row) => presentOrder(env, row))),
    next_cursor: rows.length > page.length ? page[page.length - 1].order.id : null,
  };
}

export async function lookupRetailOrders(
  env: Env,
  req: Request,
  tenant: TenantContext,
  input: LookupOrdersInput
) {
  const user = await getAuthUser(req, env, tenant);
  const db = createDb(env.DB);
  const siteId = tenant.isSubAgent ? tenant.agentId : null;

  if (!input.q) {
    if (!user) return { orders: [], next_cursor: null };
    return listMemberOrdersPage(env, user.id, siteId, input.cursor);
  }

  if (!user) {
    const challenge = await verifyTurnstileIfConfigured(
      req,
      env,
      'order_lookup',
      input['cf-turnstile-response'] || input.turnstile_token
    );
    if (!challenge.ok) throw Errors.forbidden(challenge.error);
  }

  const publicNo = /^AHQ-[a-f0-9]{32}$/i.test(input.q) ? `AHQ-${input.q.slice(4).toLowerCase()}` : null;
  if ((!publicNo && !user) || input.q.includes('@')) return { orders: [] };
  const [row] = await lookupOrdersOnSite(db, publicNo || input.q, siteId, user?.id);
  if (!row) return { orders: [] };
  const authorized = await mayReadOrder(row.order, user, {
    authorized: Boolean(publicNo),
    password: input.password,
  });
  return { orders: [authorized ? await presentOrder(env, row) : lockedOrder] };
}
