import { storefrontProductParamSchema } from '@shared/index';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from '../../env';
import { parseRouteParams } from '../../middleware/validate.middleware';
import { listSelectableCardsPublic } from './card-selection.service';
import {
  getPublicGroupBuyByCode,
  listProductOpenGroupBuys,
  runScheduledGroupBuyMaintenance,
} from './group-buy.service';
import { runScheduledRenewalReminders } from './renewal.service';

export const commerceStorefrontRoutes = new Hono<AppBindings>();
export const commerceAdminRoutes = new Hono<AppBindings>();

const codeParamSchema = z.object({ code: z.string().trim().min(4).max(32) });

commerceStorefrontRoutes.get('/products/:idOrSlug/group-buys', async (c) => {
  c.header('Cache-Control', 'no-store');
  const { idOrSlug } = parseRouteParams(c, storefrontProductParamSchema);
  return c.json(await listProductOpenGroupBuys(c.env, c.get('tenant'), idOrSlug));
});

commerceStorefrontRoutes.get('/products/:idOrSlug/selectable-cards', async (c) => {
  c.header('Cache-Control', 'no-store');
  const { idOrSlug } = parseRouteParams(c, storefrontProductParamSchema);
  const specId = (c.req.query('spec_id') || '').trim();
  return c.json(await listSelectableCardsPublic(c.env, c.get('tenant'), idOrSlug, specId));
});

commerceStorefrontRoutes.get('/group-buys/:code', async (c) => {
  c.header('Cache-Control', 'no-store');
  const { code } = parseRouteParams(c, codeParamSchema);
  return c.json(await getPublicGroupBuyByCode(c.env, c.get('tenant'), code));
});

/** 总控手动触发拼团超时退款与订阅到期续费提醒巡检 */
commerceAdminRoutes.post('/run-maintenance', async (c) => {
  const [groupBuy, renewal] = await Promise.all([
    runScheduledGroupBuyMaintenance(c.env),
    runScheduledRenewalReminders(c.env),
  ]);
  return c.json({ ok: true, group_buy: groupBuy, renewal });
});
